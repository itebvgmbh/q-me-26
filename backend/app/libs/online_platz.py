"""
Ist ein Platz frei? Für Buchen und Verschieben aus dem Browser über das Backend (app/apis/nummer: Termin ohne Konto,
Platz ändern). Dieselbe Berechnung wie die freien Zeiten (app/apis/available_timeslots) und wie _noch_frei beim
Telefon-Assistenten (app/apis/telefon). Gleichzeitige Buchungen fängt danach die Belegung in der Transaktion ab
(app/libs/schedule.py).
"""
from datetime import datetime, time
from typing import Optional, Tuple

from app.apis.available_timeslots import load_timeslot_inputs, timeslots_for_day
from app.libs.schedule import BERLIN, aware

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
