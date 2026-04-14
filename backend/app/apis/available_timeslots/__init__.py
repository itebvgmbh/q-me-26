from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import Dict, Optional
from datetime import datetime, time
from firebase_admin import firestore
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
from app.apis.appointment_helpers import update_appointment

router = APIRouter()

# In externe Module ausgelagert

@router.post("/available-timeslots", tags=["open"])
def get_available_timeslots(request: AvailableTimeslotsRequest, background_tasks: BackgroundTasks) -> AvailableTimeslotsResponse:
    """
    Calculate available timeslots for a specific date, considering:
    - Shop business hours
    - Staff working hours
    - Existing appointments
    - Break times
    - Service duration
    
    If force_refresh is True, the cache will be invalidated first.
    """
    """
    Calculate available timeslots for a specific date, considering:
    - Shop business hours
    - Staff working hours
    - Existing appointments
    - Break times
    - Service duration
    """
    # Start time measurement
    perf_start_time = time_module.time()
    
    # Handle force_refresh requests - immediately invalidate the cache if requested
    if hasattr(request, 'force_refresh') and request.force_refresh:
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{current_time}] FORCE REFRESH: Requested for shop {request.shop_id} on date {request.date.isoformat()}, staff={request.staff_id or 'any'}")
        
        # Enhanced cache invalidation approach:
        # 1. First invalidate shop-wide cache to ensure all general data is refreshed
        invalidate_shop_date_cache(request.shop_id, request.date.isoformat())
        
        # 2. If staff_id is provided, also invalidate staff-specific cache
        if request.staff_id:
            print(f"[{current_time}] FORCE REFRESH: Invalidating staff-specific cache for staff {request.staff_id}")
            invalidate_shop_date_cache(request.shop_id, request.date.isoformat(), request.staff_id)
        
        # 3. Handle direct invalidation request with special service_id
        if request.service_id == "force_refresh":
            print(f"[{current_time}] DIRECT CACHE INVALIDATION: Request completed - returning empty response")
            return AvailableTimeslotsResponse(timeslots=[])
        
        # For normal service requests with force_refresh, continue with fresh calculation
        print(f"[{current_time}] FORCE REFRESH: Continuing with fresh timeslot calculation")
    
    # Cache-Schlüssel generieren
    cache_key = get_cache_key({
        'shop_id': request.shop_id,
        'staff_id': request.staff_id,
        'service_id': request.service_id,
        'date': request.date.isoformat()
    })
    
    # Skip cache and force recalculation if force_refresh is True
    cached_result = None
    if not (hasattr(request, 'force_refresh') and request.force_refresh):
        # Versuche, Ergebnis aus dem Cache zu laden
        cached_result = get_from_cache(cache_key)
        # Log cache status with timestamp for better traceability
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        if cached_result:
            print(f"[{current_time}] CACHE STATUS: Hit for shop={request.shop_id}, date={request.date.isoformat()}, staff={request.staff_id or 'any'}")
        else:
            print(f"[{current_time}] CACHE STATUS: Miss for shop={request.shop_id}, date={request.date.isoformat()}, staff={request.staff_id or 'any'}")
    
    # Improved: Add additional logging and cleanup for better debugging
    if cached_result:
        print(f"Using cached result for shop {request.shop_id}, date {request.date}, staff {request.staff_id or 'any'}")
        # Log the age of the cache entry for monitoring
        if 'timestamp' in cached_result:
            cache_age = time_module.time() - cached_result['timestamp']
            print(f"Cache entry age: {cache_age:.2f} seconds ({cache_age/60:.2f} minutes)")
            print(f"Cache entry created at: {cached_result.get('created_at', 'unknown time')}")
        
        # Add debug info about cache metadata if available
        if 'metadata' in cached_result:
            meta = cached_result.get('metadata', {})
            req_meta = meta.get('request', {})
            print(f"Cache metadata: shop_id={req_meta.get('shop_id')}, date={req_meta.get('date')}, staff_id={req_meta.get('staff_id') or 'any'}")
        
        # Erstelle AvailableTimeslotsResponse aus Cache-Daten
        timeslots = []
        cache_data = cached_result.get('data', {})
        for slot_data in cache_data.get('timeslots', []):
            timeslots.append(TimeSlot(
                start_time=datetime.fromisoformat(slot_data['start_time']),
                end_time=datetime.fromisoformat(slot_data['end_time']),
                is_available=slot_data['is_available']
            ))
        return AvailableTimeslotsResponse(timeslots=timeslots)
    
    print(f"Cache miss - Calculating available timeslots for {request.date}")

    try:
        db = get_firestore_db()
        
        # Starte mit parallelen Datenbankabfragen

        # 1. Get service details asynchronously with thread pool
        def get_service():
            service_ref = db.collection('services').document(request.service_id)
            service_doc = service_ref.get()
            
            if not service_doc.exists:
                print(f"Service with ID {request.service_id} not found - using default values")
                # Create dummy service for testing
                return {
                    'duration': 30,  # 30 minutes as default
                    'setupTime': 0,  # No setup time
                    'id': request.service_id
                }
            
            service = service_doc.to_dict()
            if not service:
                return {
                    'duration': 30,
                    'setupTime': 0,
                    'id': request.service_id
                }
                
            return service
        
        # Führe Datenbankabfragen parallel aus mit ThreadPoolExecutor
        with concurrent.futures.ThreadPoolExecutor() as executor:
            # Starte Service-Abfrage
            future_service = executor.submit(get_service)
            
            # 2. Get shop or staff details asynchronously
            def get_working_hours():
                if request.staff_id:
                    staff_ref = db.collection('staff').document(request.staff_id)
                    staff_doc = staff_ref.get()
                    if not staff_doc.exists:
                        print(f"Staff with ID {request.staff_id} not found - using default values")
                        staff = {
                            'shopId': request.shop_id,
                            'workingHours': [
                                {'dayOfWeek': 1, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
                                {'dayOfWeek': 2, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
                                {'dayOfWeek': 3, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
                                {'dayOfWeek': 4, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
                                {'dayOfWeek': 5, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': True},
                                {'dayOfWeek': 6, 'startTime': '10:00', 'endTime': '16:00', 'isWorking': False},
                                {'dayOfWeek': 0, 'startTime': '00:00', 'endTime': '00:00', 'isWorking': False}
                            ]
                        }
                    else:
                        staff = staff_doc.to_dict()
                        if not staff:
                            print(f"Staff record empty for {request.staff_id} - using default values")
                            staff = {'shopId': request.shop_id, 'workingHours': []}
                    # Holen Sie die Shop-Öffnungszeiten, um sicherzustellen, dass Mitarbeiter-Slots nur innerhalb der Shop-Öffnungszeiten liegen
                    shop_ref = db.collection('shops').document(request.shop_id)
                    shop_doc = shop_ref.get()
                    shop_hours = []
                    
                    # Get requested day info outside the if block to make it globally available
                    requested_date = request.date.date()
                    requested_day = request.date.weekday()
                    # Convert to 0-6 format where 0 is Sunday (to match Firebase convention)
                    day_of_week = (requested_day + 1) % 7  # Firebase uses 0=Sunday, Python uses 0=Monday
                    
                    if shop_doc.exists:
                        shop = shop_doc.to_dict()
                        if shop:
                            
                            # Check if shop has the new businessHoursByDay structure
                            business_hours_by_day = shop.get('businessHoursByDay', [])
                            
                            if business_hours_by_day:
                                print(f"Using new businessHoursByDay structure for shop hours constraint {request.shop_id}")
                                # Find the entry for the requested day
                                day_entry = next((hours for hours in business_hours_by_day 
                                                if hours.get('dayOfWeek') == day_of_week), None)
                                
                                if day_entry and day_entry.get('isOpen', False):
                                    # Shop is open on this day, use specific hours
                                    shop_hours = [{
                                        'dayOfWeek': day_of_week,
                                        'startTime': day_entry.get('openTime', '09:00'),
                                        'endTime': day_entry.get('closeTime', '17:00'),
                                        'isWorking': True
                                    }]
                                else:
                                    # Shop is closed on this day
                                    print(f"Shop {request.shop_id} is closed on day {day_of_week}")
                                    shop_hours = [{
                                        'dayOfWeek': day_of_week,
                                        'startTime': '00:00',
                                        'endTime': '00:00',
                                        'isWorking': False
                                    }]
                            else:
                                # Fallback to legacy format
                                print(f"Using legacy businessHours format for shop constraint {request.shop_id}")
                                business_hours_str = shop.get('businessHours', "9:00-17:00")
                                # Parse business hours string (assuming format like "9:00-17:00")
                                try:
                                    start_time_str, end_time_str = business_hours_str.split('-')
                                except ValueError:
                                    # Fallback to default hours if the format is incorrect
                                    print(f"Invalid business hours format: {business_hours_str}, using defaults")
                                    start_time_str, end_time_str = "9:00", "17:00"

                                shop_hours = [{
                                    'dayOfWeek': day_of_week,
                                    'startTime': start_time_str.strip(),
                                    'endTime': end_time_str.strip(),
                                    'isWorking': True
                                }]
                    
                    # Mitarbeiter-Zeitfenster mit Shop-Öffnungszeiten kombinieren (Schnittmenge)
                    staff_hours = staff.get('workingHours', [])
                    
                    # Wenn der Shop an diesem Tag geschlossen ist, sind auch keine Mitarbeiter-Zeitfenster verfügbar
                    if not shop_hours or not shop_hours[0].get('isWorking', True):
                        print(f"Shop {request.shop_id} is closed on the requested day, no slots available")
                        return [{
                            'dayOfWeek': day_of_week,
                            'startTime': '00:00',
                            'endTime': '00:00',
                            'isWorking': False
                        }]
                    
                    # Prüfen Sie, ob der Mitarbeiter an diesem Tag arbeitet
                    staff_day_schedule = next((hours for hours in staff_hours if hours.get('dayOfWeek') == day_of_week and hours.get('isWorking', True)), None)
                    
                    if not staff_day_schedule:
                        print(f"Staff {request.staff_id} is not working on day {day_of_week}, no slots available")
                        return [{
                            'dayOfWeek': day_of_week,
                            'startTime': '00:00',
                            'endTime': '00:00',
                            'isWorking': False
                        }]
                    
                    # Kombinieren Sie die Arbeitszeiten des Mitarbeiters mit den Shop-Öffnungszeiten
                    shop_start_time = shop_hours[0]['startTime']
                    shop_end_time = shop_hours[0]['endTime']
                    staff_start_time = staff_day_schedule['startTime']
                    staff_end_time = staff_day_schedule['endTime']
                    
                    # Konvertieren Sie die Zeitstrings in Minuten für einfachen Vergleich
                    def time_to_minutes(time_str):
                        hours, minutes = map(int, time_str.split(':'))
                        return hours * 60 + minutes
                    
                    shop_start_minutes = time_to_minutes(shop_start_time)
                    shop_end_minutes = time_to_minutes(shop_end_time)
                    staff_start_minutes = time_to_minutes(staff_start_time)
                    staff_end_minutes = time_to_minutes(staff_end_time)
                    
                    # Berechnen Sie die Schnittmenge der Zeitfenster
                    combined_start_minutes = max(shop_start_minutes, staff_start_minutes)
                    combined_end_minutes = min(shop_end_minutes, staff_end_minutes)
                    
                    # Wenn die Schnittmenge leer ist, gibt es keine verfügbaren Zeitfenster
                    if combined_start_minutes >= combined_end_minutes:
                        print(f"No overlap between shop hours and staff hours for day {day_of_week}")
                        return [{
                            'dayOfWeek': day_of_week,
                            'startTime': '00:00',
                            'endTime': '00:00',
                            'isWorking': False
                        }]
                    
                    # Konvertieren Sie zurück in Zeitstrings
                    combined_start_time = f"{combined_start_minutes // 60:02d}:{combined_start_minutes % 60:02d}"
                    combined_end_time = f"{combined_end_minutes // 60:02d}:{combined_end_minutes % 60:02d}"
                    
                    print(f"Combined working hours for staff {request.staff_id} on day {day_of_week}: {combined_start_time}-{combined_end_time}")
                    
                    # Erstellen Sie einen neuen Zeitplan mit der Schnittmenge
                    return [{
                        'dayOfWeek': day_of_week,
                        'startTime': combined_start_time,
                        'endTime': combined_end_time,
                        'isWorking': True
                    }]
                else:
                    # If no staff is specified, use shop business hours
                    shop_ref = db.collection('shops').document(request.shop_id)
                    shop_doc = shop_ref.get()
                    if not shop_doc.exists:
                        print(f"Shop with ID {request.shop_id} not found - using default values")
                        shop = {'businessHours': "9:00-17:00"}
                    else:
                        shop = shop_doc.to_dict()
                        if not shop:
                            print(f"Shop record empty for {request.shop_id} - using default values")
                            shop = {'businessHours': "9:00-17:00"}
                    
                    # Get requested day info
                    requested_date = request.date.date()
                    requested_day = request.date.weekday()
                    # Convert to 0-6 format where 0 is Sunday (to match Firebase convention)
                    day_of_week = (requested_day + 1) % 7  # Firebase uses 0=Sunday, Python uses 0=Monday
                    
                    # Check if shop has the new businessHoursByDay structure
                    business_hours_by_day = shop.get('businessHoursByDay', [])
                    
                    if business_hours_by_day:
                        print(f"Using new businessHoursByDay structure for shop {request.shop_id}")
                        # Find the entry for the requested day
                        day_entry = next((hours for hours in business_hours_by_day 
                                         if hours.get('dayOfWeek') == day_of_week), None)
                        
                        if day_entry and day_entry.get('isOpen', False):
                            # Shop is open on this day, use specific hours
                            return [{
                                'dayOfWeek': day_of_week,
                                'startTime': day_entry.get('openTime', '09:00'),
                                'endTime': day_entry.get('closeTime', '17:00'),
                                'isWorking': True
                            }]
                        else:
                            # Shop is closed on this day
                            print(f"Shop {request.shop_id} is closed on day {day_of_week}")
                            return [{
                                'dayOfWeek': day_of_week,
                                'startTime': '00:00',
                                'endTime': '00:00',
                                'isWorking': False
                            }]
                    else:
                        # Fallback to legacy format
                        print(f"Using legacy businessHours format for shop {request.shop_id}")
                        business_hours_str = shop.get('businessHours', "9:00-17:00")
                        # Parse business hours string (assuming format like "9:00-17:00")
                        try:
                            start_time_str, end_time_str = business_hours_str.split('-')
                        except ValueError:
                            # Fallback to default hours if the format is incorrect
                            print(f"Invalid business hours format: {business_hours_str}, using defaults")
                            start_time_str, end_time_str = "9:00", "17:00"

                        return [{
                            'dayOfWeek': day_of_week,
                            'startTime': start_time_str.strip(),
                            'endTime': end_time_str.strip(),
                            'isWorking': True
                        }]
            
            # Starte Working Hours Abfrage
            future_working_hours = executor.submit(get_working_hours)
            
            # 3. Start appointments query asynchronously
            def get_appointments():
                appointments_query = db.collection('appointments')
                # Verwende positionelle Argumente für Filter
                appointments_query = appointments_query.where('shopId', '==', request.shop_id)

                # Filter by staff if specified
                if request.staff_id:
                    appointments_query = appointments_query.where('staffId', '==', request.staff_id)

                try:
                    # Basic query without date filtering to avoid compound index requirements
                    appointments_docs = appointments_query.stream()
                    appointments = []
                    for doc in appointments_docs:
                        appt = doc.to_dict()
                        appt['id'] = doc.id  # Add ID for later deduplication
                        appointments.append(appt)
                    return appointments
                except Exception as e:
                    print(f"Error retrieving appointments: {str(e)} - using empty list")
                    return []
                    
            # Starte Appointments Abfrage
            future_appointments = executor.submit(get_appointments)
            
            # 4. Start breaks query asynchronously if staff is specified
            def get_breaks():
                if not request.staff_id:
                    return []
                    
                # Ergebnisobjekt mit normalen und wiederkehrenden Pausen
                result = {
                    'regular_breaks': [],
                    'recurring_breaks': []
                }
                    
                # 4.1 Normale Pausen abfragen (für spezifische Kalendertage)
                requested_date_str = request.date.strftime('%Y-%m-%d')
                breaks_query = db.collection('breaks')
                breaks_query = breaks_query.where('staffId', '==', request.staff_id)

                try:
                    # Get all breaks for this staff and filter by date in memory
                    all_breaks = [doc.to_dict() for doc in breaks_query.stream()]
                    
                    # Filter breaks that match our date
                    filtered_breaks = []
                    for break_item in all_breaks:
                        # Check if date field exists and matches
                        break_date = break_item.get('date')
                        if break_date and hasattr(break_date, 'strftime'):
                            # If it's a datetime object
                            if break_date.strftime('%Y-%m-%d') == requested_date_str:
                                filtered_breaks.append(break_item)
                        elif isinstance(break_date, dict) and 'seconds' in break_date:
                            # If it's a Firestore timestamp dict
                            break_datetime = datetime.fromtimestamp(break_date['seconds'])
                            if break_datetime.strftime('%Y-%m-%d') == requested_date_str:
                                filtered_breaks.append(break_item)
                    
                    result['regular_breaks'] = filtered_breaks
                except Exception as e:
                    print(f"Error retrieving regular breaks: {str(e)} - using empty list")
                    
                # 4.2 Wiederkehrende Pausen für den Wochentag abrufen
                try:
                    # Ermittle den Wochentag (0=Sonntag, 1=Montag, ...)
                    requested_day = request.date.weekday()
                    day_of_week = (requested_day + 1) % 7  # Konvertierung zu Firebase-Konvention (0=Sonntag)
                    
                    # Abfrage der wiederkehrenden Pausen für diesen Mitarbeiter und Wochentag
                    recurring_breaks_query = db.collection('recurring-breaks')
                    recurring_breaks_query = recurring_breaks_query.where('staffId', '==', request.staff_id)
                    recurring_breaks_query = recurring_breaks_query.where('dayOfWeek', '==', day_of_week)
                    recurring_breaks_query = recurring_breaks_query.where('active', '==', True)
                    
                    recurring_breaks = [doc.to_dict() for doc in recurring_breaks_query.stream()]
                    print(f"Found {len(recurring_breaks)} recurring breaks for day {day_of_week}")
                    
                    result['recurring_breaks'] = recurring_breaks
                except Exception as e:
                    print(f"Error retrieving recurring breaks: {str(e)} - using empty list")
                    
                return result
                    
            # Starte Breaks Abfrage
            future_breaks = executor.submit(get_breaks)
            
            # Warte auf Abschluss aller Abfragen
            service = future_service.result()
            working_hours = future_working_hours.result()
            appointments = future_appointments.result()
            breaks = future_breaks.result()
            
        # Extrahiere benötigte Service-Details
        service_duration = service.get('duration', 30)  # Default to 30 minutes if not specified
        service_setup_time = service.get('setupTime', 0)  # Default to 0 minutes if not specified
        print(f"Service details: duration={service_duration}, setupTime={service_setup_time}")
        
        # Use working_hours from the parallel query

        # Bereits in der parallelen Abfrage enthalten

        # 3. Check if the requested day is a working day
        requested_date = request.date.date()
        requested_day = request.date.weekday()
        day_of_week = (requested_day + 1) % 7  # Firebase uses 0=Sunday, Python uses 0=Monday

        day_schedule = next((hours for hours in working_hours if hours.get('dayOfWeek') == day_of_week and hours.get('isWorking', True)), None)

        if not day_schedule:
            print(f"No working hours found for day {day_of_week}")
            return AvailableTimeslotsResponse(timeslots=[])

        # 4. Get working hour boundaries for the day
        start_hour, start_minute = map(int, day_schedule['startTime'].split(':'))
        end_hour, end_minute = map(int, day_schedule['endTime'].split(':'))

        day_start = datetime.combine(requested_date, time(start_hour, start_minute))
        day_end = datetime.combine(requested_date, time(end_hour, end_minute))

        # Appointments bereits in der parallelen Abfrage geladen
        # Get appointments that overlap with the day
        day_start_ts = day_start
        day_end_ts = day_end

        # Filter appointments in memory
        filtered_appointments = []
        print(f"Total appointments found for shop/staff before filtering: {len(appointments)}")
        for appt in appointments:
            # Skip cancelled appointments - they shouldn't block timeslots
            # This is correct behavior for regular timeslot calculation
            if appt.get('status') == 'cancelled':
                print(f"Skipping cancelled appointment {appt.get('id')}")
                continue
                
            # Need to handle different timestamp formats
            start_time = None
            end_time = None

            # Extract start and end times based on format
            if isinstance(appt.get('startTime'), dict) and 'seconds' in appt.get('startTime', {}):
                start_seconds = appt['startTime']['seconds']
                end_seconds = appt['endTime']['seconds']
                start_time = datetime.fromtimestamp(start_seconds)
                end_time = datetime.fromtimestamp(end_seconds)
                print(f"Appointment using dict format: {appt['id']}, start={start_time}, end={end_time}")
            elif hasattr(appt.get('startTime'), 'seconds'):
                start_time = datetime.fromtimestamp(appt['startTime'].seconds)
                end_time = datetime.fromtimestamp(appt['endTime'].seconds)
                print(f"Appointment using object format: {appt['id']}, start={start_time}, end={end_time}")
            # Handle DatetimeWithNanoseconds and datetime objects directly
            elif isinstance(appt.get('startTime'), (datetime, object)) and isinstance(appt.get('endTime'), (datetime, object)):
                try:
                    start_time = appt['startTime']
                    end_time = appt['endTime']
                    # Convert from UTC to local time if timestamps have timezone info
                    if hasattr(start_time, 'tzinfo') and start_time.tzinfo is not None:
                        start_time = start_time.astimezone().replace(tzinfo=None)
                    if hasattr(end_time, 'tzinfo') and end_time.tzinfo is not None:
                        end_time = end_time.astimezone().replace(tzinfo=None)
                    print(f"Appointment using datetime format: {appt['id']}, start={start_time}, end={end_time}")
                except Exception as datetime_err:
                    print(f"Error handling datetime object: {datetime_err}, using convert_timestamp_to_datetime instead")
                    # Fallback to our general converter
                    start_time = convert_timestamp_to_datetime(appt['startTime'])
                    end_time = convert_timestamp_to_datetime(appt['endTime'])
                    if hasattr(start_time, 'tzinfo') and start_time.tzinfo is not None:
                        start_time = start_time.astimezone().replace(tzinfo=None)
                    if hasattr(end_time, 'tzinfo') and end_time.tzinfo is not None:
                        end_time = end_time.astimezone().replace(tzinfo=None)
            # Handle string timestamps (ISO format)
            elif isinstance(appt.get('startTime'), str) and isinstance(appt.get('endTime'), str):
                try:
                    start_str = appt['startTime'].rstrip('Z')
                    end_str = appt['endTime'].rstrip('Z')
                    
                    # Entferne Zeitzoneninformationen für konsistentes Parsing, wir konvertieren als Fallback unten
                    if '+' in start_str:
                        start_str = start_str.split('+')[0]
                    if '+' in end_str:
                        end_str = end_str.split('+')[0]
                    
                    if 'T' in start_str:
                        start_time = datetime.fromisoformat(start_str)
                    else:
                        start_time = datetime.fromisoformat(start_str.replace(' ', 'T'))
                        
                    if 'T' in end_str:
                        end_time = datetime.fromisoformat(end_str)
                    else:
                        end_time = datetime.fromisoformat(end_str.replace(' ', 'T'))
                        
                    print(f"Appointment using ISO string format: {appt['id']}, start={start_time}, end={end_time}")
                except ValueError as e:
                    print(f"Error parsing timestamp strings: {e}")
                    # Fallback to our general converter
                    start_time = convert_timestamp_to_datetime(appt['startTime'])
                    end_time = convert_timestamp_to_datetime(appt['endTime'])
                    if hasattr(start_time, 'tzinfo') and start_time.tzinfo is not None:
                        start_time = start_time.astimezone().replace(tzinfo=None)
                    if hasattr(end_time, 'tzinfo') and end_time.tzinfo is not None:
                        end_time = end_time.astimezone().replace(tzinfo=None)
                    print(f"After fallback conversion: start={start_time}, end={end_time}")
            else:
                print(f"Warning: Unrecognized timestamp format for appointment {appt.get('id')}: {type(appt.get('startTime'))}")
                print(f"Appointment data: {appt}")

            # General fix: catch-all timezone conversion if some branch missed it
            if hasattr(start_time, 'tzinfo') and start_time.tzinfo is not None:
                start_time = start_time.astimezone().replace(tzinfo=None)
            if hasattr(end_time, 'tzinfo') and end_time.tzinfo is not None:
                end_time = end_time.astimezone().replace(tzinfo=None)

            # Skip appointments without valid timestamps
            if not start_time or not end_time:
                print(f"Skipping appointment {appt.get('id')} due to invalid timestamps")
                continue

            # Check if appointment overlaps with our day
            day_overlap = False
            try:
                # Stelle sicher, dass alle Zeittypen für den Vergleich gleich sind
                if not isinstance(start_time, datetime) or not isinstance(end_time, datetime) or \
                   not isinstance(day_start_ts, datetime) or not isinstance(day_end_ts, datetime):
                    print(f"Type mismatch in day overlap check:")
                    print(f"  start_time: {type(start_time)} = {start_time}")
                    print(f"  end_time: {type(end_time)} = {end_time}")
                    print(f"  day_start_ts: {type(day_start_ts)} = {day_start_ts}")
                    print(f"  day_end_ts: {type(day_end_ts)} = {day_end_ts}")
                    
                    # Versuche, alle Werte in datetime-Objekte zu konvertieren
                    if not isinstance(start_time, datetime):
                        start_time = convert_timestamp_to_datetime(start_time)
                        print(f"  Converted start_time to: {type(start_time)} = {start_time}")
                    if not isinstance(end_time, datetime):
                        end_time = convert_timestamp_to_datetime(end_time)
                        print(f"  Converted end_time to: {type(end_time)} = {end_time}")
                    if not isinstance(day_start_ts, datetime):
                        day_start_ts = convert_timestamp_to_datetime(day_start_ts)
                        print(f"  Converted day_start_ts to: {type(day_start_ts)} = {day_start_ts}")
                    if not isinstance(day_end_ts, datetime):
                        day_end_ts = convert_timestamp_to_datetime(day_end_ts)
                        print(f"  Converted day_end_ts to: {type(day_end_ts)} = {day_end_ts}")
                    
                    # Überprüfe nochmals, ob alle Werte datetime-Objekte sind
                    if not all(isinstance(ts, datetime) for ts in [start_time, end_time, day_start_ts, day_end_ts]):
                        print("  Failed to convert all timestamps to datetime objects. Skipping overlap check.")
                        raise ValueError("Timestamp conversion failed")
                    
                # Führe die eigentlichen Vergleiche durch
                if start_time >= day_start_ts and start_time < day_end_ts:
                    day_overlap = True
                    print(f"Appointment {appt.get('id')} starts during the day")
                elif end_time > day_start_ts and end_time <= day_end_ts:
                    day_overlap = True
                    print(f"Appointment {appt.get('id')} ends during the day")
                elif start_time < day_start_ts and end_time > day_end_ts:
                    day_overlap = True
                    print(f"Appointment {appt.get('id')} completely overlaps the day")
            except Exception as e:
                print(f"Error during day overlap check: {str(e)}")
                day_overlap = False

            if day_overlap:
                appt_copy = appt.copy()
                appt_copy['startTime'] = start_time
                appt_copy['endTime'] = end_time
                filtered_appointments.append(appt_copy)
            else:
                print(f"Appointment {appt.get('id')} does not overlap with day: {day_start_ts} to {day_end_ts}")

        appointments = filtered_appointments

        # Breaks bereits in der parallelen Abfrage geladen

        # 7. Calculate available timeslots
        
        # Vorbereitung der Pausen für den Zeitslot-Algorithmus
        if isinstance(breaks, dict):
            # Neues Format mit regulären und wiederkehrenden Pausen
            print(f"Using new breaks format with regular and recurring breaks.")
            regular_breaks = breaks.get('regular_breaks', [])
            recurring_breaks = breaks.get('recurring_breaks', [])
            
            print(f"Found {len(regular_breaks)} regular breaks and {len(recurring_breaks)} recurring breaks")
        else:
            # Altes Format (nur reguläre Pausen)
            print(f"Using old breaks format (list only).")
            regular_breaks = breaks
            recurring_breaks = []
            
        # Kombiniere die beiden Pausentypen für den Algorithmus
        prepared_breaks = {
            'regular_breaks': regular_breaks,
            'recurring_breaks': recurring_breaks
        }
            
        available_slots = calculate_available_timeslots(
            day_start, 
            day_end, 
            appointments, 
            prepared_breaks, 
            service_duration,
            service_setup_time
        )

        result = AvailableTimeslotsResponse(timeslots=available_slots)
        
        # End time measurement and log performance
        perf_end_time = time_module.time()
        execution_time = perf_end_time - perf_start_time
        print(f"Timeslot calculation completed in {execution_time:.2f} seconds for {len(available_slots)} slots")
        
        # Speichere das Ergebnis im Cache (ohne den Hauptthread zu blockieren)
        # Konvertiere datetime-Objekte zu ISO-Strings für JSON-Serialisierbarkeit
        cache_data = {
            'timeslots': [{
                'start_time': slot.start_time.isoformat(),
                'end_time': slot.end_time.isoformat(),
                'is_available': slot.is_available
            } for slot in available_slots]
        }
        
        # Speichere auch die Request-Parameter als Metadaten für gezielte Cache-Invalidierung
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
            'cache_version': '2.0'  # Version tracking for format changes
        }
        
        # Log cache saving with timestamp for better traceability
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{current_time}] CACHE SAVE: Storing {len(available_slots)} slots for shop={request.shop_id}, date={request.date.isoformat()}, staff={request.staff_id or 'any'}")
        
        # Asynchron im Hintergrund in den Cache schreiben
        background_tasks.add_task(save_to_cache, cache_key, cache_data, metadata)
        
        return result

    except Exception as e:
        # End time measurement even on error
        perf_end_time = time_module.time()
        execution_time = perf_end_time - perf_start_time
        print(f"Error calculating available timeslots after {execution_time:.2f} seconds: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error calculating available timeslots: {str(e)}") from e

# In app.apis.available_timeslots.calculators ausgelagert
