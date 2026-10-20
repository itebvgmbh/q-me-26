"""
Belegung je Person und Tag – Gegenstück zu frontend/src/utils/firestore/schedule.ts.

Ein Platz darf nur einmal vergeben werden. Jede Buchung, Verschiebung, Absage (App) und Annahme
("Früher dran", hier) liest in ihrer Transaktion schedules/{staffId}_{YYYY-MM-DD} und schreibt es fort.
Zwei gleichzeitige Änderungen am selben Dokument lässt Firestore nicht beide durch: Die zweite läuft
neu an und sieht den Platz belegt.

slots = {Termin-ID: {start, end}} für alle nicht abgesagten Termine der Person an dem Tag (deutsche Zeit).
Die Einträge sind nur Sperre und Hinweis, die Wahrheit bleibt der Termin: Überschneidet sich ein Eintrag,
wird der Termin in der Transaktion gelesen; ist er abgesagt, gelöscht oder verschoben, fliegt der Eintrag raus.
"""
import zoneinfo
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional

from google.cloud import firestore

SCHEDULES = "schedules"
BERLIN = zoneinfo.ZoneInfo("Europe/Berlin")


def aware(dt: datetime) -> datetime:
    """Naive Zeiten sind deutsche Ortszeit (so speichern die Angebote sie)."""
    return dt.replace(tzinfo=BERLIN) if dt.tzinfo is None else dt


def day_key(dt: datetime) -> str:
    return aware(dt).astimezone(BERLIN).date().isoformat()


@dataclass
class Placement:
    staff_id: str
    start: datetime
    end: datetime

    def days(self) -> List[str]:
        return sorted({day_key(self.start), day_key(self.end - timedelta(microseconds=1))})

    def overlaps(self, other: "Placement") -> bool:
        return self.staff_id == other.staff_id and aware(self.start) < aware(other.end) and aware(other.start) < aware(self.end)


def placement_of(appointment: Optional[dict]) -> Optional[Placement]:
    """Zeit, die ein Termin belegt, oder None (abgesagt, ohne Person, ohne Zeiten, vor der Zeit fertig).

    Dieselbe Regel wie occupiedWindow (frontend/src/utils/queue-lane.ts) und occupied_window
    (app/apis/available_timeslots): Wer dran ist, ab Aufruf so lange wie geplant; wer fertig ist, nur bis "Fertig".
    """
    if not appointment or appointment.get("status") == "cancelled" or not appointment.get("staffId"):
        return None
    start, end = appointment.get("startTime"), appointment.get("endTime")
    if not isinstance(start, datetime) or not isinstance(end, datetime) or aware(end) <= aware(start):
        return None
    start, end = aware(start), aware(end)
    staff_id = str(appointment["staffId"])
    called = appointment.get("lastCalledAt") or appointment.get("calledAt")
    called = aware(called) if isinstance(called, datetime) else None
    status = appointment.get("status")
    if status == "in-progress":
        begin = called or start
        return Placement(staff_id, begin, begin + (end - start))
    if status == "completed":
        done = appointment.get("completedAt")
        if not isinstance(done, datetime):
            return Placement(staff_id, start, end)  # Altbestand ohne Zeitpunkt
        begin = min(start, called or start)
        return Placement(staff_id, begin, aware(done)) if aware(done) > begin else None
    return Placement(staff_id, start, end)


@dataclass
class PlacementChange:
    conflict: Optional[str]
    write: Callable[[], None] = field(repr=False)


def read_placement(transaction, db, appointment_id: str, shop_id: str,
                   occupy: Optional[Placement] = None, release: Optional[Placement] = None) -> PlacementChange:
    """
    Liest in der Transaktion die Belegung für alten (release) und neuen Platz (occupy) und prüft den neuen.
    Alle Lesevorgänge passieren hier; geschrieben wird erst mit .write() (Firestore: erst lesen, dann schreiben).
    """
    docs: Dict[str, tuple] = {}
    for p in (occupy, release):
        if p:
            for day in p.days():
                doc_id = f"{p.staff_id}_{day}"
                docs[doc_id] = (db.collection(SCHEDULES).document(doc_id), p.staff_id, day)
    current: Dict[str, dict] = {}
    for doc_id, (ref, _, _) in docs.items():
        snap = ref.get(transaction=transaction)
        current[doc_id] = dict(((snap.to_dict() or {}).get("slots") or {}) if snap.exists else {})

    occupy_days = set(occupy.days()) if occupy else set()
    suspects: List[str] = []
    if occupy:
        for doc_id, (_, staff_id, day) in docs.items():
            if staff_id != occupy.staff_id or day not in occupy_days:
                continue
            for other_id, entry in current[doc_id].items():
                start, end = (entry or {}).get("start"), (entry or {}).get("end")
                if other_id == appointment_id or other_id in suspects or not isinstance(start, datetime) or not isinstance(end, datetime):
                    continue
                if occupy.overlaps(Placement(staff_id, start, end)):
                    suspects.append(other_id)

    conflict: Optional[str] = None
    fixes: Dict[str, Optional[Placement]] = {}
    for other_id in suspects:
        snap = db.collection("appointments").document(other_id).get(transaction=transaction)
        actual = placement_of(snap.to_dict()) if snap.exists else None
        if actual and occupy and actual.overlaps(occupy) and conflict is None:
            conflict = (f"Da ist schon ein Termin ({actual.start.astimezone(BERLIN):%H:%M}–"
                        f"{actual.end.astimezone(BERLIN):%H:%M}).")
        fixes[other_id] = actual

    def write() -> None:
        for doc_id, (ref, staff_id, day) in docs.items():
            slots = dict(current[doc_id])
            for other_id, actual in fixes.items():
                if other_id not in slots:
                    continue
                if actual and actual.staff_id == staff_id and day in actual.days():
                    slots[other_id] = {"start": actual.start, "end": actual.end}
                else:
                    slots.pop(other_id, None)
            slots.pop(appointment_id, None)
            if occupy and occupy.staff_id == staff_id and day in occupy_days:
                slots[appointment_id] = {"start": occupy.start, "end": occupy.end}
            transaction.set(ref, {"shopId": shop_id, "staffId": staff_id, "day": day, "slots": slots,
                                  "updatedAt": firestore.SERVER_TIMESTAMP})

    return PlacementChange(conflict, write)


SHOP_DAYS = "shop_days"  # Tagesnummern je Laden (frontend: shopDayRef in schedule.ts)


def delete_past_days(db, now: Optional[datetime] = None, keep_days: int = 7, batch_size: int = 300) -> int:
    """Belegung und Tagesnummern vergangener Tage löschen – danach braucht sie niemand mehr. Gibt die Zahl zurück."""
    cutoff = day_key((now or datetime.now(BERLIN)) - timedelta(days=keep_days))
    deleted = 0
    for collection in (SCHEDULES, SHOP_DAYS):
        while True:
            docs = list(db.collection(collection).where("day", "<", cutoff).limit(batch_size).stream())
            for doc in docs:
                doc.reference.delete()
            deleted += len(docs)
            if len(docs) < batch_size:
                break
    return deleted
