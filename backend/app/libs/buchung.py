"""
Termin oder Nummer im Backend anlegen – Gegenstück zur Transaktion in createAppointment
(frontend/src/utils/firestore/appointments.ts), Änderungen an beiden Stellen.

Für Wege ohne Browser (Telefon-Assistent, app/apis/telefon). In einer Transaktion:
  1. Platz belegen (Belegung je Person und Tag, app/libs/schedule.py): der erste noch freie aus den Kandidaten,
  2. Tagesnummer ziehen (shop_days/{shopId}_{Tag}), wenn der Termin eine braucht (ohne Konto oder Nummer),
  3. Termin speichern, dazu seine öffentliche Kurzfassung (app/libs/public_appointments.py).
Bucht im selben Moment die Online-Buchung oder der Tresen denselben Platz, kommt nur einer durch.
Ob ein Kandidat nach den Regeln (Öffnungs- und Arbeitszeiten, Pausen) überhaupt geht, prüft der Aufrufer vorher.

Absagen (cancel_appointment) wie /nummer/absagen: Status, Belegung und Kurzfassung in einer Transaktion.
"""
import random
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, List, Optional

from google.cloud import firestore

from app.libs.public_appointments import write_public
from app.libs.schedule import BERLIN, SHOP_DAYS, Placement, aware, day_key, placement_of, read_placement

# Gleichzeitige Buchungen derselben Person laufen nacheinander; im Ansturm braucht die letzte mehrere Anläufe
# (wie TRANSACTION_OPTIONS im Frontend)
TRANSACTION_ATTEMPTS = 12


class PlatzWeg(Exception):
    """Keiner der Plätze ist mehr frei. Text wie im Frontend: 'Da ist schon ein Termin (10:00–10:30).'"""


def pick_reference_code(used: set, rng=None) -> str:
    """Zufällige freie Nummer: erst 10–99, wird es eng (60 vergeben), dreistellig – wie pickReferenceCode (schedule.ts)"""
    rng = rng or random
    low, high = (10, 99) if len(used) < 60 else (100, 999)
    for _ in range(50):
        code = str(rng.randint(low, high))
        if code not in used:
            return code
    for n in range(100, 10000):
        if str(n) not in used:
            return str(n)
    return str(int(datetime.now().timestamp() * 1000) % 100000)


def reference_codes_of_day(db, shop_id: str, day: date) -> List[str]:
    """Nummern, die an diesem Tag im Laden schon an Termine vergeben sind (auch abgesagte). Zählt für Nummern
    von vor den Tagesnummern in shop_days, wie referenceCodesOfDay im Frontend."""
    start = datetime.combine(day, time(), tzinfo=BERLIN)
    end = datetime.combine(day + timedelta(days=1), time(), tzinfo=BERLIN)
    query = db.collection("appointments").where("shopId", "==", shop_id).where("startTime", ">=", start).where("startTime", "<", end)
    return [code for code in ((snap.to_dict() or {}).get("referenceCode") for snap in query.stream()) if code]


def create_appointment(db, data: dict, candidates: List[Placement], needs_code: bool) -> dict:
    """
    Legt den Termin auf den ersten Platz aus candidates, der beim Speichern noch frei ist (alle am selben Tag,
    die Tagesnummer hängt am Tag). data ohne staffId, startTime, endTime. Gibt den gespeicherten Termin mit id
    zurück; ist keiner der Plätze mehr frei, PlatzWeg.
    """
    if not candidates:
        raise PlatzWeg("Kein Platz angegeben.")
    shop_id = data["shopId"]
    code_day = aware(candidates[0].start)
    ref = db.collection("appointments").document()
    earlier = reference_codes_of_day(db, shop_id, code_day.astimezone(BERLIN).date()) if needs_code else []
    transaction = db.transaction(max_attempts=TRANSACTION_ATTEMPTS)

    @firestore.transactional
    def run(tx) -> dict:
        chosen, change, conflict = None, None, None
        for place in candidates:
            change = read_placement(tx, db, ref.id, shop_id, occupy=place)
            if not change.conflict:
                chosen = place
                break
            conflict = conflict or change.conflict
        if chosen is None:
            raise PlatzWeg(conflict or "Der Platz ist gerade weggegangen.")
        numbers_ref = db.collection(SHOP_DAYS).document(f"{shop_id}_{day_key(code_day)}") if needs_code else None
        numbers = numbers_ref.get(transaction=tx) if numbers_ref else None
        codes = list(((numbers.to_dict() or {}).get("codes") or []) if numbers is not None and numbers.exists else [])
        code = pick_reference_code(set(earlier) | set(codes)) if needs_code else None
        now = datetime.now(timezone.utc)
        created = {**data, "id": ref.id, "staffId": chosen.staff_id, "startTime": aware(chosen.start), "endTime": aware(chosen.end),
                   "createdAt": now, "updatedAt": now}
        if code:
            created["referenceCode"] = code
        tx.set(ref, created)
        write_public(tx, db, ref.id, created)
        change.write()
        if numbers_ref is not None:
            tx.set(numbers_ref, {"shopId": shop_id, "day": day_key(code_day), "codes": codes + [code], "updatedAt": now})
        return created

    return run(transaction)


def cancel_appointment(db, appointment_id: str, check: Callable[[Optional[dict]], None]) -> dict:
    """
    Termin absagen: Status abgesagt, Platz in der Belegung frei, Kurzfassung mit. check(Termin oder None) läuft in
    der Transaktion vorher und wirft, wenn es nicht geht. Gibt den Termin vor der Absage zurück.
    """
    ref = db.collection("appointments").document(appointment_id)

    @firestore.transactional
    def run(tx) -> dict:
        snap = ref.get(transaction=tx)
        appt = (snap.to_dict() or {}) if snap.exists else None
        check(appt)
        release = placement_of(appt)
        change = read_placement(tx, db, appointment_id, appt.get("shopId", ""), release=release) if release else None
        update = {"status": "cancelled", "updatedAt": datetime.now(timezone.utc)}
        tx.update(ref, update)
        write_public(tx, db, appointment_id, {**appt, **update})
        if change:
            change.write()
        return appt

    return run(db.transaction(max_attempts=TRANSACTION_ATTEMPTS))
