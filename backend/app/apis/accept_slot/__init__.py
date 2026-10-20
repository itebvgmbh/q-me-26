"""
"Früher dran" annehmen: Termin auf den angebotenen früheren Platz verschieben.

Ein Platz darf nur einmal vergeben werden (Lasttest 20.10.2026, dev/e2e/lasttest.cjs):
  - Verschoben wird in einer Transaktion mit der Belegung je Person und Tag (app/libs/schedule.py).
    Bucht der Tresen im selben Moment denselben Platz, kommt nur einer durch.
  - Die Annahme läuft unter derselben Sperre wie die Angebotsprüfung (check_slots._check_lock). Vorher
    konnte eine Prüfung mit veraltetem Stand ein Angebot löschen, das gerade angenommen wurde.
  - Nur Termine mit Status "scheduled": Ein abgesagter Termin wird nicht wieder aufgenommen
    (vorher setzte die Annahme den Status immer auf "scheduled").
  - Dasselbe Angebot zweimal (zwei Geräte): Die zweite Annahme meldet Erfolg und ändert nichts.
  - Der Endpunkt ist synchron (def) und läuft im Threadpool; als async def mit blockierenden
    Firestore-Aufrufen hielt er den einzigen uvicorn-Prozess an.
"""
from datetime import datetime
from typing import Dict, Optional

from fastapi import APIRouter, BackgroundTasks
from google.cloud import firestore

from app.auth import AuthorizedUser
from app.apis.cache import invalidate_shop_date_cache
from app.apis.check_slots import _check_lock, trigger_check_in_background
from app.apis.firebase_utils import get_firestore_db
from app.libs.schedule import BERLIN, Placement, aware, day_key, placement_of, read_placement

router = APIRouter()

ALREADY_ACCEPTED = "Schon angenommen – dein Termin ist bereits auf dem früheren Platz."


class _Refused(Exception):
    """Annahme geht nicht; message ist für den Kunden."""

    def __init__(self, message: str, code: Optional[str] = None, drop_offer: bool = False):
        super().__init__(message)
        self.message, self.code, self.drop_offer = message, code, drop_offer


def _slot_still_free(shop_id, staff_id, service_id, start) -> bool:
    """Prüft mit derselben Berechnung wie das Angebot, ob der Platz jetzt noch frei ist."""
    import zoneinfo
    from app.apis.available_timeslots import get_available_timeslots
    from app.apis.models import AvailableTimeslotsRequest

    try:
        if not (shop_id and staff_id and service_id) or not isinstance(start, datetime):
            return False
        local = start.astimezone(zoneinfo.ZoneInfo("Europe/Berlin")).replace(tzinfo=None) if start.tzinfo else start
        request = AvailableTimeslotsRequest(
            shop_id=shop_id,
            staff_id=staff_id,
            service_id=service_id,
            date=local.replace(hour=0, minute=0, second=0, microsecond=0),
            force_refresh=True,
        )
        result = get_available_timeslots(request, BackgroundTasks())
        for slot in result.timeslots:
            slot_start = slot.start_time.replace(tzinfo=None) if slot.start_time.tzinfo else slot.start_time
            if slot.is_available and slot_start == local:
                return True
        return False
    except Exception as e:
        print(f"Could not re-check earlier slot, refusing to move appointment: {e}")
        return False


def _offer_time(value) -> Optional[datetime]:
    """Angebote speichern deutsche Ortszeit ohne Zeitzone ("2026-10-21T08:00:00")."""
    if isinstance(value, datetime):
        return aware(value)
    if isinstance(value, str):
        try:
            return aware(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            return None
    return None


def _same_time(a: Optional[datetime], b: Optional[datetime]) -> bool:
    return isinstance(a, datetime) and isinstance(b, datetime) and aware(a) == aware(b)


def accept_earlier_slot_impl(notification_id: str, user_id: Optional[str] = None) -> Dict[str, str]:
    """Angebot annehmen. Antwort {"status": "success"|"error", "message": ...} (message auf Deutsch)."""
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] ACCEPT EARLIER SLOT: {notification_id} by {user_id}")
    db = get_firestore_db()
    try:
        # Nie gleichzeitig mit einer Angebotsprüfung oder einer anderen Annahme
        with _check_lock:
            result = _accept(db, notification_id, user_id)
    except _Refused as refused:
        print(f"Earlier slot {notification_id} refused: {refused.message}")
        return {"status": "error", "message": refused.message, **({"code": refused.code} if refused.code else {})}
    except Exception as e:
        print(f"Error accepting earlier slot {notification_id}: {e}")
        return {"status": "error", "message": "Das hat nicht geklappt. Versuch es gleich noch einmal."}

    moved = result.pop("_moved", None)
    if moved:
        shop_id, staff_id, days = moved
        for day in days:
            try:
                invalidate_shop_date_cache(shop_id, day)
            except Exception as e:
                print(f"Cache invalidation after accept failed (appointment is moved): {e}")
        # Der alte Platz ist jetzt frei: sofort neu verteilen (Kaskade), siehe check_slots
        trigger_check_in_background(shop_id, staff_id)
    return result


def _accept(db, notification_id: str, user_id: Optional[str]) -> Dict:
    notification_ref = db.collection("earlier_slot_notifications").document(notification_id)
    notification_doc = notification_ref.get()
    if not notification_doc.exists:
        raise _Refused("Dieses Angebot gibt es nicht mehr.")
    notification = notification_doc.to_dict() or {}

    appointment_id = notification.get("appointmentId")
    appointment_ref = db.collection("appointments").document(appointment_id) if appointment_id else None
    appointment_doc = appointment_ref.get() if appointment_ref else None
    if not appointment_doc or not appointment_doc.exists:
        raise _Refused("Den Termin zu diesem Angebot gibt es nicht mehr.")
    appointment = appointment_doc.to_dict() or {}

    # Nur der Kunde selbst
    customer_id = appointment.get("customerId") or appointment.get("userId")
    if not user_id or customer_id != user_id:
        print(f"AUTHORIZATION FAILED: user {user_id} for appointment of customer {customer_id}")
        raise _Refused("Das ist nicht dein Termin.", code="unauthorized")

    earlier_start = _offer_time(notification.get("earlierStartTime"))
    earlier_end = _offer_time(notification.get("earlierEndTime"))
    if not earlier_start or not earlier_end or earlier_end <= earlier_start:
        raise _Refused("Dieses Angebot ist ungültig.")

    # Schon angenommen (zweites Gerät, doppelter Tipp): Erfolg melden, nichts ändern
    if notification.get("isAccepted"):
        if _same_time(appointment.get("startTime"), earlier_start):
            return {"status": "success", "message": ALREADY_ACCEPTED}
        raise _Refused("Dieses Angebot ist schon erledigt.")
    if notification.get("status") == "expired":
        raise _Refused("Das Angebot ist abgelaufen.")
    if appointment.get("status") != "scheduled":
        raise _Refused("Dein Termin ist nicht mehr offen (abgesagt oder schon dran).", code="not_scheduled")
    if earlier_start <= datetime.now(BERLIN):
        raise _Refused("Der frühere Platz ist schon vorbei.", drop_offer=True)

    shop_id = appointment.get("shopId") or notification.get("shopId")
    staff_id = str(appointment.get("staffId") or notification.get("staffId") or "")
    if not shop_id or not staff_id:
        raise _Refused("Zu diesem Termin fehlt die Person.")

    # Pausen, Arbeits- und Öffnungszeiten und ältere Termine (ohne Eintrag in der Belegung): dieselbe
    # Berechnung wie beim Angebot. Gleichzeitige Buchungen fängt erst die Transaktion unten ab.
    if not _slot_still_free(shop_id, staff_id, appointment.get("serviceId"), earlier_start):
        _drop_offer(notification_ref)
        raise _Refused("Der frühere Platz ist inzwischen vergeben.", code="taken")

    occupy = Placement(staff_id, earlier_start, earlier_end)
    transaction = db.transaction()

    @firestore.transactional
    def move(tx) -> str:
        appt_snap = appointment_ref.get(transaction=tx)
        note_snap = notification_ref.get(transaction=tx)
        if not note_snap.exists:
            raise _Refused("Dieses Angebot gibt es nicht mehr.")
        if not appt_snap.exists:
            raise _Refused("Den Termin zu diesem Angebot gibt es nicht mehr.")
        current = appt_snap.to_dict() or {}
        if (note_snap.to_dict() or {}).get("isAccepted"):
            if _same_time(current.get("startTime"), earlier_start):
                return "already"
            raise _Refused("Dieses Angebot ist schon erledigt.")
        if current.get("status") != "scheduled":
            raise _Refused("Dein Termin ist nicht mehr offen (abgesagt oder schon dran).", code="not_scheduled")
        change = read_placement(tx, db, appointment_id, shop_id, occupy=occupy, release=placement_of(current))
        if change.conflict:
            raise _Refused("Der frühere Platz ist inzwischen vergeben.", code="taken", drop_offer=True)
        tx.update(appointment_ref, {
            "startTime": earlier_start,
            "endTime": earlier_end,
            "staffId": staff_id,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        tx.update(notification_ref, {"isAccepted": True, "isRead": True, "acceptedAt": firestore.SERVER_TIMESTAMP})
        change.write()
        return "moved"

    try:
        outcome = move(transaction)
    except _Refused as refused:
        if refused.drop_offer:
            _drop_offer(notification_ref)
        raise
    if outcome == "already":
        return {"status": "success", "message": ALREADY_ACCEPTED}

    old_start = appointment.get("startTime")
    print(f"Appointment {appointment_id} moved from {old_start} to {earlier_start} (offer {notification_id})")
    _drop_overlapping_offers(db, notification_id, staff_id, earlier_start, earlier_end)

    days = {day_key(earlier_start)}
    if isinstance(old_start, datetime):
        days.add(day_key(old_start))
    return {"status": "success", "message": "Du hast den früheren Platz.", "_moved": (shop_id, staff_id, sorted(days))}


def _drop_offer(notification_ref) -> None:
    """Platz ist weg: Angebot entfernen (wie die Prüfung es mit Angeboten tut, deren Platz weg ist)."""
    try:
        notification_ref.delete()
    except Exception as e:
        print(f"Could not delete offer {notification_ref.id}: {e}")


def _drop_overlapping_offers(db, notification_id: str, staff_id: str, start: datetime, end: datetime) -> None:
    """Andere offene Angebote für denselben Platz sind jetzt tot; die Prüfung danach verteilt neu."""
    query = db.collection("earlier_slot_notifications").where("staffId", "==", staff_id).where("isAccepted", "==", False)
    for doc in query.stream():
        if doc.id == notification_id:
            continue
        other = doc.to_dict() or {}
        other_start = _offer_time(other.get("earlierStartTime"))
        other_end = _offer_time(other.get("earlierEndTime"))
        if other_start and other_end and other_start < end and start < other_end:
            print(f"  Offer {doc.id} overlaps the accepted slot, deleting")
            doc.reference.delete()


@router.post("/accept-earlier-slot/{notification_id}")
def accept_earlier_slot(notification_id: str, user: AuthorizedUser) -> Dict[str, str]:
    """Accept an earlier slot notification and move the appointment."""
    return accept_earlier_slot_impl(notification_id, user.sub)
