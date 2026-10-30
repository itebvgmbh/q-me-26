"""
Freie Plätze für Buchen, Nummer ziehen und Verschieben über das Backend (app/apis/nummer aus dem Browser,
app/apis/telefon für den Telefon-Assistenten). Dieselbe Berechnung wie die freien Zeiten
(app/apis/available_timeslots); Nummern kommen heute hinter die Schlange (app/libs/queue_notify.py, wie
buildDayContext mit projectAt in booking-rules.ts). Gleichzeitige Buchungen fängt danach die Belegung in der
Transaktion ab (app/libs/schedule.py).
"""
from datetime import datetime, time, timedelta
from typing import List, Optional, Tuple

from app.apis.available_timeslots import load_timeslot_inputs, timeslots_for_day
from app.libs.plans import PLANS, effective_plan
from app.libs.queue_notify import project_lane
from app.libs.schedule import BERLIN, aware

# Person, Beginn, Ende (Ortszeit ohne Zeitzone)
Frei = Tuple[str, datetime, datetime]


class MonatVoll(Exception):
    """Gratis-Tarif: Die Kunden dieses Monats sind erreicht."""


def jetzt() -> datetime:
    """Jetzt als Ortszeit ohne Zeitzone – so rechnet available_timeslots"""
    return datetime.now(BERLIN).replace(tzinfo=None)

MAX_VORLAUF_MINUTEN = 24 * 60


def ortszeit(dt: datetime) -> datetime:
    """Deutsche Ortszeit ohne Zeitzone – so rechnet available_timeslots"""
    return aware(dt).astimezone(BERLIN).replace(tzinfo=None)


def vorlauf_minuten(shop: dict) -> int:
    """Vorlaufzeit für Online-Termine (shops.timeSlotBuffer in Millisekunden) – wie onlineLeadMinutes (booking-rules.ts)"""
    try:
        ms = float(shop.get("timeSlotBuffer") or 0)
    except (TypeError, ValueError):
        return 0
    return min(MAX_VORLAUF_MINUTEN, round(ms / 60000)) if ms > 0 else 0


def person_fuer_leistung(db, shop_id: str, staff_id: str, service_id: str) -> bool:
    """Gehört die Person zum Laden, ist sie aktiv und bietet sie die Leistung an (ohne Zuordnung: alle)?"""
    snap = db.collection("staff").document(staff_id).get()
    staff = (snap.to_dict() or {}) if snap.exists else None
    if not staff or staff.get("shopId") != shop_id or staff.get("isActive") is False:
        return False
    angeboten = staff.get("serviceIds") or []
    return not angeboten or service_id in angeboten


def leistung_im_laden(db, shop_id: str, service_id: str) -> bool:
    snap = db.collection("services").document(service_id).get()
    service = (snap.to_dict() or {}) if snap.exists else None
    return bool(service and service.get("shopId") == shop_id and not service.get("archived"))


def freier_platz(db, shop_id: str, service_id: str, staff_id: str, start: datetime) -> Optional[Tuple[datetime, datetime]]:
    """Frisch gerechnet: Ist der Platz nach den Regeln frei (Öffnungs-, Arbeitszeiten, Pausen, Termine)?
    Dann (Beginn, Ende) mit Zeitzone, sonst None."""
    local = ortszeit(start)
    inputs = load_timeslot_inputs(db, shop_id, staff_id, [service_id], local.date(), local.date())
    for slot in timeslots_for_day(inputs, service_id, datetime.combine(local.date(), time())) or []:
        if slot.is_available and slot.start_time == local:
            return aware(slot.start_time), aware(slot.end_time)
    return None


def monatsgrenze(db, shop_id: str, shop: dict, now: datetime) -> None:
    """Gratis-Tarif: höchstens so viele Kunden im Monat (Nummern und Termine ohne abgesagte) – wie useMonthlyUsage
    (frontend/src/utils/plan-usage.ts), dort gibt es dann online keine Nummern mehr. Sonst MonatVoll."""
    grenze = PLANS[effective_plan(shop)]["max_customers_per_month"]
    if grenze is None:
        return
    start = datetime(now.year, now.month, 1, tzinfo=BERLIN)
    end = datetime(now.year + (now.month == 12), now.month % 12 + 1, 1, tzinfo=BERLIN)
    query = (db.collection("appointments").where("shopId", "==", shop_id).where("startTime", ">=", start)
             .where("startTime", "<", end).limit(2000))
    if sum(1 for snap in query.stream() if (snap.to_dict() or {}).get("status") != "cancelled") >= grenze:
        raise MonatVoll()


def hinter_der_schlange(free: list, appointments: list, now: datetime) -> list:
    """Heute zählt der Stand am Tresen: Hängt die Person hinterher, kommt eine neue Nummer hinter die Wartenden statt
    auf eine Zeit, die schon überholt ist – wie buildDayContext mit projectAt (booking-rules.ts)."""
    lane = [a for a in appointments if isinstance(a.get("startTime"), datetime)
            and aware(a["startTime"]).astimezone(BERLIN).date() == now.date()]
    windows = list(project_lane(lane, aware(now)).values())
    return [s for s in free if not any(aware(s.start_time) < w1 and w0 < aware(s.end_time) for w0, w1 in windows)]


def naechste_plaetze(db, shop_id: str, shop: dict, service_id: str, staff_ids: List[str], now: datetime,
                     ab: Optional[datetime], anzahl: int, tage: int, nummer: bool) -> List[Frei]:
    """Die nächsten freien Plätze je Person (bis anzahl Stück) ab ab (sonst jetzt), höchstens tage Tage, zusammen nach
    Beginn sortiert (gleiche Zeit: Reihenfolge von staff_ids). Termine mit der Vorlaufzeit für Online-Termine, Nummern
    ohne Vorlauf und heute hinter der Schlange. Zeiten als Ortszeit ohne Zeitzone, wie now."""
    vorlauf = 0 if nummer else vorlauf_minuten(shop)
    earliest = max(ab or now, now + timedelta(minutes=vorlauf))
    first_day = earliest.date()
    last_day = first_day + timedelta(days=tage - 1)
    found: List[Tuple[int, Frei]] = []
    for index, staff_id in enumerate(staff_ids):
        inputs = load_timeslot_inputs(db, shop_id, staff_id, [service_id], first_day, last_day)
        mine: List[Frei] = []
        day = first_day
        while day <= last_day and len(mine) < anzahl:
            slots = timeslots_for_day(inputs, service_id, datetime.combine(day, time())) or []
            free = [s for s in slots if s.is_available and s.start_time > now and s.start_time >= earliest]
            if nummer and day == now.date():
                free = hinter_der_schlange(free, inputs.appointments, now)
            mine += [(staff_id, s.start_time, s.end_time) for s in free[: anzahl - len(mine)]]
            day += timedelta(days=1)
        found += [(index, f) for f in mine]
    return [f for _, f in sorted(found, key=lambda x: (x[1][1], x[0]))]
