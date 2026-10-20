"""
Freie Zeiten einer Person (oder des Ladens) an einem Tag – dieselbe Regel wie beim Buchen.

Zwei Schritte, damit "Früher dran" (app/apis/check_slots) viele Tage mit einer einzigen Abfrage rechnen kann:
  1. load_timeslot_inputs: Laden, Person, Leistungen, Pausen und die Termine des Zeitraums lesen.
  2. timeslots_for_day: daraus einen Tag rechnen, ohne Datenbank.

Vorher las jede Berechnung alle Termine der Person seit Anbeginn und filterte erst im Speicher – nach einem
Jahr rund 4 500 Lesevorgänge und über eine Sekunde je Berechnung. Jetzt nur noch die Termine des Zeitraums
(Index staffId + startTime bzw. shopId + startTime, wie loadStaffRange im Frontend).
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from dataclasses import dataclass
from typing import Dict, List, Optional
from datetime import date, datetime, time, timedelta
from app.apis.firebase_utils import get_firestore_db
import time as time_module  # Für Zeitmessung
import concurrent.futures

# Module importieren
from app.apis.models import (
    TimeSlot,
    AvailableTimeslotsRequest,
    AvailableTimeslotsResponse
)
from app.apis.cache import (
    get_cache_key,
    get_from_cache,
    save_to_cache,
    invalidate_shop_date_cache
)
from app.apis.calculators import calculate_available_timeslots
from app.apis.utils import convert_timestamp_to_datetime

router = APIRouter()

# Termine, die am Vorabend beginnen und über Mitternacht in den Tag reichen, liest die Abfrage mit
OVERNIGHT_LOOKBACK = timedelta(hours=6)

# Person ohne Eintrag in staff: Mo–Fr 9–17 Uhr (wie bisher)
DEFAULT_STAFF_HOURS = [
    {'dayOfWeek': 1, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
    {'dayOfWeek': 2, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
    {'dayOfWeek': 3, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
    {'dayOfWeek': 4, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
    {'dayOfWeek': 5, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
    {'dayOfWeek': 6, 'startTime': '10:00', 'endTime': '16:00', 'isWorking': False},
    {'dayOfWeek': 0, 'startTime': '00:00', 'endTime': '00:00', 'isWorking': False}
]


def occupied_window(appt: dict, start: datetime, end: datetime):
    """Welche Zeit ein Termin tatsächlich belegt (naive Ortszeit), None = nichts – wie occupiedWindow in
    frontend/src/utils/queue-lane.ts: Wer dran ist, ab Aufruf so lange wie geplant; wer fertig ist, nur bis
    "Fertig". Wer früher fertig ist, gibt den Rest frei – "Früher dran" kann ihn dann anbieten."""
    status = appt.get('status')
    called = convert_timestamp_to_datetime(appt.get('lastCalledAt') or appt.get('calledAt'))
    if status == 'in-progress':
        begin = called or start
        return begin, begin + (end - start)
    if status == 'completed':
        done = convert_timestamp_to_datetime(appt.get('completedAt'))
        if done is None:
            return start, end  # Altbestand ohne Zeitpunkt
        begin = min(start, called or start)
        return (begin, done) if done > begin else None
    return start, end


def shop_breaks_for_day(shop: Optional[dict], day_of_week: int) -> list:
    """Pausen des Ladens an einem Wochentag (businessHoursByDay[].breaks, z. B. mittags zu).

    Gelten für alle Personen; im Format der wiederkehrenden Pausen, damit der Rechner sie gleich behandelt.
    Wie im Frontend (booking-rules.ts, shopBreaksForDay): nur an offenen Tagen, unlesbare fallen weg.
    """
    entries = (shop or {}).get('businessHoursByDay') or []
    entry = next((d for d in entries if str(d.get('dayOfWeek')) == str(day_of_week)), None)
    if not entry or not entry.get('isOpen'):
        return []
    result = []
    for b in entry.get('breaks') or []:
        try:
            sh, sm = map(int, str(b.get('startTime', '')).split(':'))
            eh, em = map(int, str(b.get('endTime', '')).split(':'))
        except (ValueError, AttributeError):
            continue
        if eh * 60 + em > sh * 60 + sm:
            result.append({'startTime': f"{sh:02d}:{sm:02d}", 'endTime': f"{eh:02d}:{em:02d}", 'active': True, 'type': 'shop'})
    return result


# ---------------------------------------------------------------------------------------------
# 1. Lesen
# ---------------------------------------------------------------------------------------------

@dataclass
class TimeslotInputs:
    """Alles, was die freien Zeiten in einem Zeitraum bestimmt – einmal gelesen, für beliebig viele Tage."""
    shop_id: str
    staff_id: Optional[str]
    shop: Optional[dict]                  # None = Laden nicht gefunden
    staff: Optional[dict]                 # None = Person nicht gefunden (nur mit staff_id)
    services: Dict[str, Optional[dict]]   # None = Leistung nicht gefunden
    breaks: list                          # einzelne Pausen der Person, den Tag filtert timeslots_for_day
    recurring_breaks: list                # aktive wiederkehrende Pausen der Person, alle Wochentage
    appointments: list                    # Termine mit Beginn im Zeitraum (samt Vorlauf), mit 'id'


def _read_doc(db, collection: str, doc_id: str) -> Optional[dict]:
    doc = db.collection(collection).document(doc_id).get()
    return (doc.to_dict() or {}) if doc.exists else None


def _appointments_between(db, shop_id: str, staff_id: Optional[str], start: datetime, end: datetime) -> list:
    """Termine mit Beginn in [start, end) – nie alle seit Anbeginn. Fehler gehen durch: ohne Termine wäre alles frei."""
    query = db.collection('appointments')
    if staff_id:
        # Index staffId + startTime (wie loadStaffRange im Frontend), den Laden filtern wir hier
        query = query.where('staffId', '==', staff_id)
    else:
        query = query.where('shopId', '==', shop_id)
    query = query.where('startTime', '>=', start.astimezone()).where('startTime', '<', end.astimezone())
    result = []
    for doc in query.stream():
        appt = doc.to_dict() or {}
        if appt.get('shopId') != shop_id:
            continue
        appt['id'] = doc.id
        result.append(appt)
    return result


def load_timeslot_inputs(db, shop_id: str, staff_id: Optional[str], service_ids: List[str], first_day: date, last_day: date) -> TimeslotInputs:
    """Liest alles für die Tage first_day bis last_day (je einschließlich), alle Abfragen gleichzeitig."""
    range_start = datetime.combine(first_day, time()) - OVERNIGHT_LOOKBACK
    range_end = datetime.combine(last_day + timedelta(days=1), time())

    def staff_query(collection: str) -> list:
        return [doc.to_dict() or {} for doc in db.collection(collection).where('staffId', '==', staff_id).stream()]

    with concurrent.futures.ThreadPoolExecutor() as executor:
        shop = executor.submit(_read_doc, db, 'shops', shop_id)
        services = {sid: executor.submit(_read_doc, db, 'services', sid) for sid in dict.fromkeys(service_ids)}
        appointments = executor.submit(_appointments_between, db, shop_id, staff_id, range_start, range_end)
        staff = executor.submit(_read_doc, db, 'staff', staff_id) if staff_id else None
        breaks = executor.submit(staff_query, 'breaks') if staff_id else None
        recurring = executor.submit(staff_query, 'recurring-breaks') if staff_id else None
        return TimeslotInputs(
            shop_id=shop_id,
            staff_id=staff_id,
            shop=shop.result(),
            staff=staff.result() if staff else None,
            services={sid: f.result() for sid, f in services.items()},
            breaks=breaks.result() if breaks else [],
            recurring_breaks=[b for b in recurring.result() if b.get('active') is True] if recurring else [],
            appointments=appointments.result(),
        )


# ---------------------------------------------------------------------------------------------
# 2. Rechnen (ohne Datenbank)
# ---------------------------------------------------------------------------------------------

def _closed(day_of_week: int) -> list:
    return [{'dayOfWeek': day_of_week, 'startTime': '00:00', 'endTime': '00:00', 'isWorking': False}]


def _shop_hours(shop: dict, day_of_week: int) -> list:
    """Öffnungszeiten an einem Wochentag: businessHoursByDay, sonst das alte Textformat "9:00-17:00"."""
    business_hours_by_day = shop.get('businessHoursByDay', [])
    if business_hours_by_day:
        day_entry = next((hours for hours in business_hours_by_day if hours.get('dayOfWeek') == day_of_week), None)
        if day_entry and day_entry.get('isOpen', False):
            return [{
                'dayOfWeek': day_of_week,
                'startTime': day_entry.get('openTime', '09:00'),
                'endTime': day_entry.get('closeTime', '17:00'),
                'isWorking': True
            }]
        return _closed(day_of_week)
    business_hours_str = shop.get('businessHours') or "00:00-23:59"
    try:
        start_time_str, end_time_str = business_hours_str.split('-')
    except ValueError:
        start_time_str, end_time_str = "00:00", "23:59"  # wie Frontend: unlesbar = keine Einschränkung
    return [{'dayOfWeek': day_of_week, 'startTime': start_time_str.strip(), 'endTime': end_time_str.strip(), 'isWorking': True}]


def _working_hours(inputs: TimeslotInputs, day_of_week: int) -> list:
    """Arbeitszeit an einem Wochentag: Öffnungszeiten, mit Person die Schnittmenge mit ihren Arbeitszeiten."""
    if not inputs.staff_id:
        return _shop_hours(inputs.shop or {'businessHours': "9:00-17:00"}, day_of_week)

    staff = inputs.staff if inputs.staff is not None else {'workingHours': DEFAULT_STAFF_HOURS}
    # Ohne Laden keine Öffnungszeiten – dann auch keine Zeiten für die Person
    shop_hours = _shop_hours(inputs.shop, day_of_week) if inputs.shop else []
    if not shop_hours or not shop_hours[0].get('isWorking', True):
        return _closed(day_of_week)

    staff_day_schedule = next((hours for hours in staff.get('workingHours', []) if hours.get('dayOfWeek') == day_of_week and hours.get('isWorking', True)), None)
    if not staff_day_schedule:
        return _closed(day_of_week)

    def time_to_minutes(time_str):
        hours, minutes = map(int, time_str.split(':'))
        return hours * 60 + minutes

    combined_start_minutes = max(time_to_minutes(shop_hours[0]['startTime']), time_to_minutes(staff_day_schedule['startTime']))
    combined_end_minutes = min(time_to_minutes(shop_hours[0]['endTime']), time_to_minutes(staff_day_schedule['endTime']))
    if combined_start_minutes >= combined_end_minutes:
        return _closed(day_of_week)
    return [{
        'dayOfWeek': day_of_week,
        'startTime': f"{combined_start_minutes // 60:02d}:{combined_start_minutes % 60:02d}",
        'endTime': f"{combined_end_minutes // 60:02d}:{combined_end_minutes % 60:02d}",
        'isWorking': True
    }]


def _break_on_day(break_item: dict, date_str: str) -> bool:
    break_date = break_item.get('date')
    if break_date and hasattr(break_date, 'strftime'):
        return break_date.strftime('%Y-%m-%d') == date_str
    if isinstance(break_date, dict) and 'seconds' in break_date:
        return datetime.fromtimestamp(break_date['seconds']).strftime('%Y-%m-%d') == date_str
    return False


def timeslots_for_day(inputs: TimeslotInputs, service_id: str, day: datetime) -> Optional[List[TimeSlot]]:
    """Plätze (frei und belegt) für eine Leistung an einem Tag. None = an diesem Tag wird nicht gearbeitet."""
    service = inputs.services.get(service_id) or {'duration': 30, 'setupTime': 0}
    service_duration = service.get('duration', 30)
    service_setup_time = service.get('setupTime', 0)

    requested_date = day.date()
    day_of_week = (day.weekday() + 1) % 7  # Firebase: 0 = Sonntag, Python: 0 = Montag

    day_schedule = next((hours for hours in _working_hours(inputs, day_of_week) if hours.get('dayOfWeek') == day_of_week and hours.get('isWorking', True)), None)
    if not day_schedule:
        return None

    start_hour, start_minute = map(int, day_schedule['startTime'].split(':'))
    end_hour, end_minute = map(int, day_schedule['endTime'].split(':'))
    day_start = datetime.combine(requested_date, time(start_hour, start_minute))
    day_end = datetime.combine(requested_date, time(end_hour, end_minute))

    # Termine, die in die Arbeitszeit fallen; abgesagte belegen nichts
    appointments = []
    for appt in inputs.appointments:
        if appt.get('status') == 'cancelled':
            continue
        start_time = convert_timestamp_to_datetime(appt.get('startTime'))
        end_time = convert_timestamp_to_datetime(appt.get('endTime'))
        if not start_time or not end_time:
            continue
        # Tatsächlich belegte Zeit: früher fertig gibt den Rest frei
        window = occupied_window(appt, start_time, end_time)
        if window is None:
            continue
        start_time, end_time = window
        if start_time < day_end and end_time > day_start:
            appointments.append({**appt, 'startTime': start_time, 'endTime': end_time})

    # Pausen: einzelne an diesem Tag, wiederkehrende an diesem Wochentag, dazu die des Ladens (für alle)
    if inputs.staff_id:
        date_str = day.strftime('%Y-%m-%d')
        regular_breaks = [b for b in inputs.breaks if _break_on_day(b, date_str)]
        recurring_breaks = [b for b in inputs.recurring_breaks if b.get('dayOfWeek') == day_of_week]
    else:
        regular_breaks, recurring_breaks = [], []
    recurring_breaks = recurring_breaks + shop_breaks_for_day(inputs.shop, day_of_week)

    return calculate_available_timeslots(
        day_start,
        day_end,
        appointments,
        {'regular_breaks': regular_breaks, 'recurring_breaks': recurring_breaks},
        service_duration,
        service_setup_time
    )


# ---------------------------------------------------------------------------------------------
# Schnittstelle (Buchungsseite, accept_slot, Zwischenspeicher leeren)
# ---------------------------------------------------------------------------------------------

@router.post("/available-timeslots", tags=["open"])
def get_available_timeslots(request: AvailableTimeslotsRequest, background_tasks: BackgroundTasks) -> AvailableTimeslotsResponse:
    """
    Freie Zeiten an einem Tag: Öffnungs- und Arbeitszeiten, Termine, Pausen, Dauer der Leistung.

    force_refresh: Zwischenspeicher für Laden und Tag vorher leeren. Mit service_id "force_refresh" nur leeren
    (so meldet das Frontend nach dem Speichern eines Termins, dass sich der Tag geändert hat).
    """
    perf_start_time = time_module.time()
    label = f"{request.shop_id}/{request.staff_id or 'alle'} am {request.date.date()}"
    force_refresh = bool(getattr(request, 'force_refresh', False))

    if force_refresh:
        # Leert alle Einträge des Ladens an dem Tag, also auch die der Person
        invalidate_shop_date_cache(request.shop_id, request.date.isoformat(), verbose=False)
        if request.service_id == "force_refresh":
            print(f"Freie Zeiten {label}: Zwischenspeicher geleert")
            return AvailableTimeslotsResponse(timeslots=[])

    cache_key = get_cache_key({
        'shop_id': request.shop_id,
        'staff_id': request.staff_id,
        'service_id': request.service_id,
        'date': request.date.isoformat()
    })

    cached_result = None if force_refresh else get_from_cache(cache_key)
    if cached_result:
        cache_data = cached_result.get('data', {})
        timeslots = [
            TimeSlot(
                start_time=datetime.fromisoformat(slot_data['start_time']),
                end_time=datetime.fromisoformat(slot_data['end_time']),
                is_available=slot_data['is_available']
            )
            for slot_data in cache_data.get('timeslots', [])
        ]
        return AvailableTimeslotsResponse(timeslots=timeslots)

    try:
        day = request.date.date()
        inputs = load_timeslot_inputs(get_firestore_db(), request.shop_id, request.staff_id, [request.service_id], day, day)
        available_slots = timeslots_for_day(inputs, request.service_id, request.date)
        execution_time = time_module.time() - perf_start_time
        if available_slots is None:
            print(f"Freie Zeiten {label}: kein Arbeitstag, {len(inputs.appointments)} Termine gelesen, {execution_time:.2f} s")
            return AvailableTimeslotsResponse(timeslots=[])
        free = sum(1 for slot in available_slots if slot.is_available)
        print(f"Freie Zeiten {label}: {len(inputs.appointments)} Termine gelesen, {free} von {len(available_slots)} Plätzen frei, {execution_time:.2f} s")

        # Im Zwischenspeicher als ISO-Text, mit den Anfragedaten für gezieltes Leeren
        cache_data = {
            'timeslots': [{
                'start_time': slot.start_time.isoformat(),
                'end_time': slot.end_time.isoformat(),
                'is_available': slot.is_available
            } for slot in available_slots]
        }
        metadata = {
            'request': {
                'shop_id': request.shop_id,
                'staff_id': request.staff_id,
                'service_id': request.service_id,
                'date': request.date.isoformat()
            },
            'calc_time': execution_time,
            'slot_count': len(available_slots),
            'cache_type': 'timeslot',
            'cache_version': '3.0'
        }
        # Ohne Hintergrundaufgaben (Aufruf aus anderem Code) nicht speichern – die Anfrage ist gleich vorbei
        if background_tasks is not None:
            background_tasks.add_task(save_to_cache, cache_key, cache_data, metadata)

        return AvailableTimeslotsResponse(timeslots=available_slots)

    except Exception as e:
        execution_time = time_module.time() - perf_start_time
        print(f"Error calculating available timeslots after {execution_time:.2f} seconds: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error calculating available timeslots: {str(e)}") from e
