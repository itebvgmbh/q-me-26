"""
"Früher dran": frei gewordene Plätze Kunden anbieten, die einen früheren Termin wollen.

Ablauf einer Prüfung (alle 5 Minuten im Hintergrund, sofort nach einer Absage, Verschiebung oder Annahme):
  1. Kandidaten: wartende Termine mit "früher benachrichtigen" und Kundenkonto (sonst erreicht das
     Angebot niemanden), die noch mindestens OFFER_LEAD_MINUTES in der Zukunft liegen.
  2. Freie Plätze je Person, Leistung und Tag aus available_timeslots (dieselbe Regel wie beim Buchen).
     Termine, Pausen und Laden liest sie dafür einmal je Person für den ganzen Zeitraum, nicht je Tag.
  3. Verteilung in der Reihenfolge der Schlange: Wer den frühesten Termin hat, bekommt den frühesten
     passenden Platz zuerst angeboten – exklusiv für OFFER_HOLD_MINUTES. Derselbe Platz geht in dieser
     Zeit an niemand anderen. Nimmt die Person nicht an, verfällt das Angebot und der Platz geht an die
     nächste. Nimmt sie an, wird ihr alter Platz frei und die Prüfung läuft sofort erneut (Kaskade).
  4. Angebote, deren Platz inzwischen weg ist oder deren Termin sich erledigt hat, werden entfernt.

Vorher bekamen alle Kandidaten denselben Platz gleichzeitig angeboten (nur einer konnte annehmen, die
anderen sahen ein totes Angebot), pro Termin gab es nur ein einziges Angebot überhaupt, und Termine in
weniger als 2 Stunden sowie Plätze in weniger als 60 Minuten waren ausgeschlossen – Absagen am selben
Tag führten so nie zu einem Angebot.
"""
import os
import threading
import time as time_module
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, BackgroundTasks
from firebase_admin import firestore
from pydantic import BaseModel

from app.apis.firebase_utils import get_firestore_db
from app.apis.models import CheckEarlierSlotsResponse
from app.apis.available_timeslots import load_timeslot_inputs, timeslots_for_day
from app.apis.utils import convert_timestamp_to_datetime
from app.libs.plans import has_feature

from fastapi import Depends
from app.auth.access import require_admin

router = APIRouter()


def _env_minutes(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except ValueError:
        return default


# Ein angebotener Platz liegt mindestens so weit in der Zukunft (Zeit zum Reagieren und Hinkommen)
OFFER_LEAD_MINUTES = _env_minutes("QME_OFFER_LEAD_MINUTES", 15)
# So lange gehört ein Angebot exklusiv einer Person, danach ist die nächste dran
OFFER_HOLD_MINUTES = max(1, _env_minutes("QME_OFFER_HOLD_MINUTES", 15))
# So weit voraus wird gesucht (begrenzt die Lesevorgänge)
MAX_DAYS_AHEAD = 14

# Nie zwei Prüfungen gleichzeitig (Hintergrund-Takt, Absage, Annahme) – sonst doppelte Angebote
_check_lock = threading.Lock()


# ---------------------------------------------------------------------------------------------
# Verteilung (ohne Datenbank, damit sie sich prüfen lässt)
# ---------------------------------------------------------------------------------------------

@dataclass
class Candidate:
    appointment_id: str
    staff_id: str
    service_id: str
    start: datetime
    created: datetime
    # Plätze (Startzeiten), die diese Person schon einmal angeboten bekam und verfallen ließ
    declined: set = field(default_factory=set)


@dataclass
class Offer:
    notification_id: str
    appointment_id: str
    staff_id: str
    start: datetime
    end: datetime
    offered_at: Optional[datetime]


@dataclass
class Plan:
    keep: List[str] = field(default_factory=list)                     # Angebot bleibt
    expire: List[str] = field(default_factory=list)                   # Frist abgelaufen
    delete: List[str] = field(default_factory=list)                   # Platz weg / Termin erledigt
    create: List[Tuple[str, Tuple[datetime, datetime]]] = field(default_factory=list)  # (Termin, Platz)
    move: List[Tuple[str, Tuple[datetime, datetime]]] = field(default_factory=list)    # (Angebot, besserer Platz)


def _overlaps(a: Tuple[datetime, datetime], b: Tuple[datetime, datetime]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def plan_offers(
    candidates: List[Candidate],
    free_slots: Dict[Tuple[str, str], List[Tuple[datetime, datetime]]],
    offers: List[Offer],
    now: datetime,
    lead_minutes: int = OFFER_LEAD_MINUTES,
    hold_minutes: int = OFFER_HOLD_MINUTES,
) -> Plan:
    """
    Entscheidet, wer welchen Platz angeboten bekommt.
    free_slots: je (Person, Leistung) die freien Plätze (Start, Ende) – Angebote belegen sie nicht.
    offers: offene (nicht angenommene, nicht verfallene) Angebote.
    """
    plan = Plan()
    earliest = now + timedelta(minutes=lead_minutes)
    by_appt = {c.appointment_id: c for c in candidates}

    # 1. Offene Angebote prüfen: abgelaufen, ungültig oder weiterhin gültig
    active: Dict[str, Offer] = {}
    for offer in sorted(offers, key=lambda o: (o.offered_at or now)):
        cand = by_appt.get(offer.appointment_id)
        slot = (offer.start, offer.end)
        if cand is None or offer.appointment_id in active:
            plan.delete.append(offer.notification_id)  # Termin erledigt/abgesagt/kein Häkchen, oder doppelt
            continue
        if offer.offered_at and offer.offered_at + timedelta(minutes=hold_minutes) <= now:
            plan.expire.append(offer.notification_id)
            cand.declined.add(offer.start)
            continue
        still_free = slot in free_slots.get((cand.staff_id, cand.service_id), [])
        # Der Vorlauf gilt nur für neue Angebote; ein bestehendes gilt, bis der Platz beginnt
        if not still_free or offer.start <= now or offer.start >= cand.start:
            plan.delete.append(offer.notification_id)
            continue
        active[offer.appointment_id] = offer

    # 2. In der Reihenfolge der Schlange verteilen: frühester Termin zuerst
    reserved: Dict[str, List[Tuple[datetime, datetime]]] = {}
    for offer in active.values():
        reserved.setdefault(offer.staff_id, []).append((offer.start, offer.end))

    for cand in sorted(candidates, key=lambda c: (c.start, c.created)):
        mine = active.get(cand.appointment_id)
        taken = [r for r in reserved.get(cand.staff_id, []) if not (mine and r == (mine.start, mine.end))]
        options = [
            s for s in free_slots.get((cand.staff_id, cand.service_id), [])
            if earliest <= s[0] < cand.start
            and s[0] not in cand.declined
            and not any(_overlaps(s, r) for r in taken)
        ]
        best = min(options, key=lambda s: s[0]) if options else None
        if mine:
            if best and best[0] < mine.start:
                # Ein noch früherer Platz ist frei geworden: Angebot verbessern, alten Platz freigeben
                reserved[cand.staff_id] = taken + [best]
                plan.move.append((mine.notification_id, best))
            else:
                plan.keep.append(mine.notification_id)
        elif best:
            reserved.setdefault(cand.staff_id, []).append(best)
            plan.create.append((cand.appointment_id, best))
    return plan


# ---------------------------------------------------------------------------------------------
# Prüfung mit Datenbank
# ---------------------------------------------------------------------------------------------

def _aware(dt: datetime) -> datetime:
    """Naive Ortszeit -> mit Zeitzone, damit Firestore sie nicht als UTC speichert."""
    return dt.astimezone() if dt.tzinfo is None else dt


def _free_slots_for(db, shop_id: str, staff_id: str, latest: Dict[str, datetime], today: datetime) -> Tuple[Dict[str, List[Tuple[datetime, datetime]]], int]:
    """
    Freie Plätze einer Person je Leistung, von heute bis zum Tag des spätesten Kandidaten dieser Leistung.
    Eine Abfrage für den ganzen Zeitraum – vorher eine je Tag und Leistung, jede mit allen Terminen seit Anbeginn.
    Gibt auch die Zahl der gelesenen Termine zurück (fürs Log).
    """
    last_day = max(latest.values()).date()
    inputs = load_timeslot_inputs(db, shop_id, staff_id, list(latest), today.date(), last_day)
    result: Dict[str, List[Tuple[datetime, datetime]]] = {}
    for service_id, until in latest.items():
        slots: List[Tuple[datetime, datetime]] = []
        for i in range((until.date() - today.date()).days + 1):
            for slot in timeslots_for_day(inputs, service_id, today + timedelta(days=i)) or []:
                if slot.is_available:
                    start = convert_timestamp_to_datetime(slot.start_time)
                    end = convert_timestamp_to_datetime(slot.end_time)
                    if start and end:
                        slots.append((start, end))
        result[service_id] = slots
    return result, len(inputs.appointments)


def run_earlier_slot_check(shop_id: Optional[str] = None, staff_id: Optional[str] = None, now: Optional[datetime] = None) -> CheckEarlierSlotsResponse:
    """Eine Prüfung; mit shop_id/staff_id nur für diesen Laden bzw. diese Person (nach einer Absage)."""
    with _check_lock:
        return _run_check(shop_id, staff_id, now)


def _run_check(shop_id: Optional[str], staff_id: Optional[str], now: Optional[datetime]) -> CheckEarlierSlotsResponse:
    perf_start = time_module.time()
    db = get_firestore_db()
    now = now or datetime.now()
    earliest = now + timedelta(minutes=OFFER_LEAD_MINUTES)

    def scoped(query):
        """Nach einer Absage nur Laden bzw. Person lesen, nicht die Daten aller Läden."""
        if shop_id:
            query = query.where('shopId', '==', shop_id)
        if staff_id:
            query = query.where('staffId', '==', staff_id)
        return query

    # "Früher dran" gehört zu den Bezahltarifen (app/libs/plans.py); gelöschte Läden bleiben unberührt
    shop_allows: Dict[str, bool] = {}

    def allows_earlier(shop_id_: str) -> bool:
        if shop_id_ not in shop_allows:
            shop_doc = db.collection('shops').document(shop_id_).get()
            shop_allows[shop_id_] = not shop_doc.exists or has_feature(shop_doc.to_dict() or {}, 'frueherDran')
        return shop_allows[shop_id_]

    # Kandidaten
    candidates: List[Candidate] = []
    appt_data: Dict[str, dict] = {}
    query = scoped(db.collection('appointments').where('checkEarlierOptions', '==', True).where('status', '==', 'scheduled'))
    for doc in query.stream():
        data = doc.to_dict() or {}
        start = convert_timestamp_to_datetime(data.get('startTime'))
        if not start or start <= earliest or start > now + timedelta(days=MAX_DAYS_AHEAD):
            continue
        if not all(data.get(k) for k in ('shopId', 'staffId', 'serviceId', 'customerId')):
            continue  # ohne Kundenkonto kann niemand das Angebot sehen
        if not allows_earlier(data['shopId']):
            continue
        created = convert_timestamp_to_datetime(data.get('createdAt')) or start
        candidates.append(Candidate(doc.id, data['staffId'], data['serviceId'], start, created))
        appt_data[doc.id] = data

    # Offene Angebote (angenommene bleiben als Verlauf, verfallene merken abgelehnte Plätze)
    offers: List[Offer] = []
    expired_by_appt: Dict[str, set] = {}
    for doc in scoped(db.collection('earlier_slot_notifications').where('isAccepted', '==', False)).stream():
        data = doc.to_dict() or {}
        start = convert_timestamp_to_datetime(data.get('earlierStartTime'))
        end = convert_timestamp_to_datetime(data.get('earlierEndTime'))
        if data.get('status') == 'expired':
            if start:
                expired_by_appt.setdefault(data.get('appointmentId'), set()).add(start)
            if not start or start < now:
                doc.reference.delete()  # Platz liegt in der Vergangenheit: Verlauf nicht mehr nötig
            continue
        if not start or not end or start < now:
            doc.reference.delete()
            continue
        offered_at = convert_timestamp_to_datetime(data.get('offeredAt') or data.get('createdAt'))
        offers.append(Offer(doc.id, data.get('appointmentId'), data.get('staffId'), start, end, offered_at))
    for cand in candidates:
        cand.declined |= expired_by_appt.get(cand.appointment_id, set())

    # Freie Plätze je Person und Leistung, von heute bis zum spätesten Kandidaten – je Person eine Abfrage
    free_slots: Dict[Tuple[str, str], List[Tuple[datetime, datetime]]] = {}
    groups: Dict[Tuple[str, str], Dict[str, datetime]] = {}
    for cand in candidates:
        latest = groups.setdefault((appt_data[cand.appointment_id]['shopId'], cand.staff_id), {})
        latest[cand.service_id] = max(latest.get(cand.service_id, cand.start), cand.start)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    appointments_read = 0
    for (shop, staff), latest in groups.items():
        try:
            by_service, read = _free_slots_for(db, shop, staff, latest, today)
            appointments_read += read
        except Exception as e:
            print(f"Free slots for staff {staff} failed: {e}")
            by_service = {}
        for service in latest:
            free_slots[(staff, service)] = by_service.get(service, [])

    plan = plan_offers(candidates, free_slots, offers, now)

    # Umsetzen
    notifications = db.collection('earlier_slot_notifications')
    hold_until = _aware(now + timedelta(minutes=OFFER_HOLD_MINUTES))
    for notification_id in plan.delete:
        notifications.document(notification_id).delete()
    for notification_id in plan.expire:
        notifications.document(notification_id).update({'status': 'expired', 'expiredAt': firestore.SERVER_TIMESTAMP})
    for notification_id, (start, end) in plan.move:
        notifications.document(notification_id).update({
            'earlierStartTime': start.isoformat(),
            'earlierEndTime': end.isoformat(),
            'offeredAt': _aware(now),
            'expiresAt': hold_until,
            'isRead': False,
            'status': 'offered',
        })
    for appointment_id, (start, end) in plan.create:
        data = appt_data[appointment_id]
        notifications.document().set({
            'appointmentId': appointment_id,
            'userId': data['customerId'],
            'shopId': data['shopId'],
            'staffId': data['staffId'],
            'serviceId': data['serviceId'],
            'originalStartTime': data.get('startTime'),
            'originalEndTime': data.get('endTime'),
            # Ortszeit ohne Zeitzone – so liest accept_slot sie (Europe/Berlin)
            'earlierStartTime': start.isoformat(),
            'earlierEndTime': end.isoformat(),
            'createdAt': firestore.SERVER_TIMESTAMP,
            'offeredAt': _aware(now),
            'expiresAt': hold_until,
            'status': 'offered',
            'isRead': False,
            'isAccepted': False,
        })
        print(f"Offer for appointment {appointment_id}: {start:%d.%m. %H:%M} (exclusive until {hold_until:%H:%M})")

    if plan.create or plan.move:
        # Zum Fristende erneut prüfen, damit der Platz ohne Wartezeit an die nächste Person geht
        timer = threading.Timer(OFFER_HOLD_MINUTES * 60 + 5, trigger_check_in_background, args=(shop_id, staff_id))
        timer.daemon = True
        timer.start()

    print(
        f"Earlier slot check ({shop_id or 'alle'}/{staff_id or 'alle'}): {len(candidates)} candidates, "
        f"{len(plan.create)} new, {len(plan.move)} improved, {len(plan.keep)} kept, {len(plan.expire)} expired, "
        f"{len(plan.delete)} removed in {time_module.time() - perf_start:.2f}s ({appointments_read} appointments read for {len(groups)} staff)"
    )
    return CheckEarlierSlotsResponse(
        notifications_created=len(plan.create) + len(plan.move),
        appointments_checked=len(candidates),
        appointments_with_earlier_slots=len(plan.create) + len(plan.move) + len(plan.keep),
    )


def trigger_check_in_background(shop_id: Optional[str] = None, staff_id: Optional[str] = None) -> None:
    """Prüfung anstoßen, ohne auf sie zu warten (nach Absage oder Annahme)."""
    def work():
        try:
            run_earlier_slot_check(shop_id, staff_id)
        except Exception as e:
            print(f"Background earlier slot check failed: {e}")

    threading.Thread(target=work, daemon=True).start()


@router.post("/check-earlier-slots-v2", dependencies=[Depends(require_admin)])
async def check_earlier_slots_v2(background_tasks: BackgroundTasks) -> CheckEarlierSlotsResponse:
    """Alle Termine prüfen (Hintergrund-Takt und "Jetzt einmalig prüfen")."""
    return run_earlier_slot_check()


class SlotFreedRequest(BaseModel):
    shop_id: str
    staff_id: Optional[str] = None


@router.post("/slot-freed")
async def slot_freed(body: SlotFreedRequest) -> Dict[str, str]:
    """
    Ein Platz ist frei geworden (Absage, Verschiebung) oder jemand will früher dran sein:
    sofort prüfen statt bis zu 5 Minuten auf den nächsten Takt zu warten.
    """
    trigger_check_in_background(body.shop_id, body.staff_id)
    return {"status": "queued"}
