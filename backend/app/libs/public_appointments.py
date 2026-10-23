"""Öffentliche Kurzfassung der Termine: public_appointments/{Termin-ID} – Gegenstück zu
frontend/src/utils/firestore/public-appointments.ts.

Termine (appointments) lesen im Browser nur der Laden und das eigene Konto (firestore.rules); dort stehen Name,
Handynummer, E-Mail und Konto. Freie Plätze, Nummernseite und Wartezimmer-Bildschirm brauchen ohne Anmeldung nur
Zeit, Person, Status und Nummer – die stehen in der Kurzfassung (PUBLIC_FIELDS, dieselbe Liste in den Regeln), dazu
staffDay/shopDay ({Person}_{Tag}, {Laden}_{Tag}, Tag nach deutscher Zeit) für Abfragen ohne eigenen Index.

Wer einen Termin ändert, schreibt die Kurzfassung in derselben Transaktion mit (App: appointments.ts, hier:
write_public). Damit nichts auseinanderläuft – ältere Wege im Backend, Browserfenster mit altem Stand der App –,
gleicht start_public_sync laufend ab: einmal alle Termine (Vermerk meta/public_appointments), danach hält ein
Listener die Termine ab gestern im Blick und korrigiert jede abweichende Kurzfassung nach ein paar Sekunden.
"""

import threading
import time
from datetime import datetime, timedelta, timezone

from google.cloud import firestore

from app.libs.schedule import BERLIN, day_key

PUBLIC = "public_appointments"
APPOINTMENTS = "appointments"
PUBLIC_FIELDS = (
    "shopId",
    "staffId",
    "serviceId",
    "type",
    "status",
    "startTime",
    "endTime",
    "referenceCode",
    "isAnonymous",
    "calledAt",
    "lastCalledAt",
    "completedAt",
)
# So lange nach einer Änderung warten, bevor abgeglichen wird – die App schreibt beides selbst, meist ist nichts zu tun
SETTLE_SECONDS = 3
BACKFILL_MARKER = ("meta", "public_appointments")


def public_view(appt: dict | None) -> dict | None:
    """Kurzfassung eines Termins (None: Termin gibt es nicht)."""
    if appt is None:
        return None
    view = {f: appt[f] for f in PUBLIC_FIELDS if appt.get(f) is not None}
    start = appt.get("startTime")
    if isinstance(start, datetime):
        day = day_key(start)
        if appt.get("shopId"):
            view["shopDay"] = f"{appt['shopId']}_{day}"
        if appt.get("staffId"):
            view["staffDay"] = f"{appt['staffId']}_{day}"
    return view


def public_ref(db, appointment_id: str):
    return db.collection(PUBLIC).document(appointment_id)


def write_public(writer, db, appointment_id: str, appt: dict | None) -> None:
    """In Transaktion oder Batch des Termins mitschreiben (writer None: sofort). appt = Termin danach, None = gelöscht."""
    ref = public_ref(db, appointment_id)
    if writer is None:
        ref.delete() if appt is None else ref.set(public_view(appt))
    elif appt is None:
        writer.delete(ref)
    else:
        writer.set(ref, public_view(appt))


def _same(a: dict | None, b: dict | None) -> bool:
    if a is None or b is None:
        return a is b
    return a == b


def reconcile(db, appointment_id: str) -> str | None:
    """Kurzfassung eines Termins an den Termin angleichen, in einer Transaktion. Gibt zurück, was geändert wurde."""
    appt_ref = db.collection(APPOINTMENTS).document(appointment_id)
    ref = public_ref(db, appointment_id)

    @firestore.transactional
    def run(tx) -> str | None:
        appt = appt_ref.get(transaction=tx)
        current = ref.get(transaction=tx)
        wanted = public_view(appt.to_dict() or {}) if appt.exists else None
        have = (current.to_dict() or {}) if current.exists else None
        if _same(wanted, have):
            return None
        if wanted is None:
            tx.delete(ref)
            return "gelöscht"
        tx.set(ref, wanted)
        return "angelegt" if have is None else "angeglichen"

    return run(db.transaction())


def backfill_all(db, batch_size: int = 400) -> dict:
    """Alle Termine einmal abgleichen (beim ersten Start): fehlende oder abweichende Kurzfassungen schreiben,
    Kurzfassungen ohne Termin löschen."""
    have = {d.id: d.to_dict() or {} for d in db.collection(PUBLIC).stream()}
    batch, pending, written, removed = db.batch(), 0, 0, 0
    seen = set()
    for doc in db.collection(APPOINTMENTS).stream():
        seen.add(doc.id)
        wanted = public_view(doc.to_dict() or {})
        if not _same(wanted, have.get(doc.id)):
            batch.set(public_ref(db, doc.id), wanted)
            pending += 1
            written += 1
        if pending >= batch_size:
            batch.commit()
            batch, pending = db.batch(), 0
    for doc_id in have.keys() - seen:
        batch.delete(public_ref(db, doc_id))
        pending += 1
        removed += 1
        if pending >= batch_size:
            batch.commit()
            batch, pending = db.batch(), 0
    if pending:
        batch.commit()
    return {"geschrieben": written, "entfernt": removed}


class _Sync:
    """Listener auf die Termine ab gestern; Änderungen werden gesammelt und nach SETTLE_SECONDS abgeglichen."""

    def __init__(self, db):
        self.db = db
        self.pending: dict[str, float] = {}
        self.lock = threading.Lock()
        self.wakeup = threading.Event()
        self.watch = None

    def on_snapshot(self, _docs, changes, _read_time) -> None:
        due = time.monotonic() + SETTLE_SECONDS
        with self.lock:
            for change in changes:
                self.pending.setdefault(change.document.id, due)
        self.wakeup.set()

    def start_watch(self) -> None:
        since = datetime.now(BERLIN).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
        query = self.db.collection(APPOINTMENTS).where("startTime", ">=", since.astimezone(timezone.utc))
        self.watch = query.on_snapshot(self.on_snapshot)

    def loop(self) -> None:
        while True:
            self.wakeup.wait(SETTLE_SECONDS)
            self.wakeup.clear()
            now = time.monotonic()
            with self.lock:
                ready = [i for i, due in self.pending.items() if due <= now]
                for i in ready:
                    self.pending.pop(i, None)
            changed = 0
            for appointment_id in ready:
                try:
                    if reconcile(self.db, appointment_id):
                        changed += 1
                except Exception as e:
                    print(f"Kurzfassung {appointment_id} nicht abgeglichen: {e}")
            if changed:
                print(f"Kurzfassungen der Termine: {changed} angeglichen")


_started = False


def start_public_sync() -> bool:
    """Im Hintergrund: einmal alles abgleichen (falls noch nicht geschehen), danach laufend."""
    global _started
    if _started:
        return False
    _started = True

    def work() -> None:
        from app.apis.firebase_utils import get_firestore_db

        db = get_firestore_db()
        try:
            marker = db.collection(BACKFILL_MARKER[0]).document(BACKFILL_MARKER[1])
            if not marker.get().exists:
                result = backfill_all(db)
                marker.set({"backfilledAt": datetime.now(timezone.utc), **result})
                print(f"Kurzfassungen der Termine angelegt: {result}")
        except Exception as e:
            print(f"Kurzfassungen der Termine nicht angelegt: {e}")
        sync = _Sync(db)
        try:
            sync.start_watch()
        except Exception as e:
            print(f"Kurzfassungen der Termine: Listener nicht gestartet: {e}")
            return
        sync.loop()

    threading.Thread(target=work, name="public-appointments", daemon=True).start()
    return True
