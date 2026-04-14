from fastapi import APIRouter, BackgroundTasks, HTTPException
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from firebase_admin import firestore
import time as time_module

# Import modules
from app.apis.firebase_utils import get_firestore_db
from app.apis.models import TimeSlot, AvailableTimeslotsRequest, CheckEarlierSlotsResponse
from app.apis.available_timeslots import get_available_timeslots
from app.apis.utils import convert_timestamp_to_datetime
from app.apis.cleanup import cleanup_past_timeslot_suggestions

router = APIRouter()

@router.post("/check-earlier-slots-v2")
async def check_earlier_slots_v2(background_tasks: BackgroundTasks) -> CheckEarlierSlotsResponse:
    """
    Check for earlier available slots for appointments where the customer has opted in.
    This would typically be called by a scheduled job.
    """
    # Start time measurement
    perf_start_time = time_module.time()

    try:
        # First, clean up any outdated suggestions
        deleted_count = await cleanup_past_timeslot_suggestions()
        print(f"Cleaned up {deleted_count} past timeslot suggestions")
        
        db = get_firestore_db()

        # 1. Get all appointments with checkEarlierOptions = True
        appointments_query = db.collection('appointments')
        appointments_query = appointments_query.where('checkEarlierOptions', '==', True)
        appointments_query = appointments_query.where('status', '==', 'scheduled')  # Only active appointments

        appointments = []
        for doc in appointments_query.stream():
            appt = doc.to_dict()
            appt['id'] = doc.id
            appointments.append(appt)

        print(f"Found {len(appointments)} appointments with checkEarlierOptions=True")

        # Statistics for return
        notifications_created = 0
        appointments_with_earlier_slots = 0

        # 2. For each appointment, check if there are earlier slots available
        for appointment in appointments:
            # Skip if the appointment is less than 2 hours from now
            # to prevent constant rescheduling of imminent appointments
            start_time = convert_timestamp_to_datetime(appointment['startTime'])
            if start_time < datetime.now() + timedelta(hours=2):
                print(f"Skipping appointment {appointment['id']}: too close to current time")
                continue

            # Get the service details
            service_id = appointment.get('serviceId')
            shop_id = appointment.get('shopId')
            staff_id = appointment.get('staffId')
            customer_id = appointment.get('customerId')

            if not all([service_id, shop_id, staff_id, customer_id]):
                print(f"Skipping appointment {appointment['id']}: missing required fields")
                continue

            # Get service duration to identify a valid earlier slot
            service_ref = db.collection('services').document(service_id)
            service_doc = service_ref.get()
            if not service_doc.exists:
                print(f"Service {service_id} not found for appointment {appointment['id']}")
                continue

            service = service_doc.to_dict()

            # Get available timeslots for the current date (using the existing API)
            current_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

            # Check timeslots from now until the appointment date
            check_days = []
            temp_date = current_date
            while temp_date.date() < start_time.date():
                check_days.append(temp_date)
                temp_date = temp_date + timedelta(days=1)

            # Also include the appointment date itself for earlier hours
            check_days.append(start_time.replace(hour=0, minute=0, second=0, microsecond=0))

            # Find the earliest available slot that's earlier than the current appointment
            earliest_available_slot = None
            
            # We'll look for times between now+buffer and the original appointment
            now = datetime.now()
            buffer_time = now + timedelta(minutes=60)
            print(f"DEBUG: Looking for earlier slots between {buffer_time} and {start_time}")

            for check_date in check_days:
                    request = AvailableTimeslotsRequest(
                        shop_id=shop_id,
                        service_id=service_id,
                        staff_id=staff_id,
                        date=check_date
                    )

                    response = get_available_timeslots(request, background_tasks)

                    # Filter for available slots that are earlier than the current appointment
                    # but after the current time
                    now = datetime.now()

                    # Debug time values to check timezone issues
                    print(f"NOW: {now} | Appointment time: {start_time}")
                    print("Looking for slots between NOW + 60min and appointment time")

                    # Add a buffer of 60 minutes to avoid creating slots in the past due to timezone issues
                    # This ensures we never create a slot that's too close to the current time
                    buffer_time = now + timedelta(minutes=60)

                    # Improved filtering with additional checks:
                    # 1. Ensure the slot is available
                    # 2. Ensure the slot is WELL in the future (now + 60min buffer to account for timezone differences)
                    # 3. Ensure the slot is earlier than the current appointment
                    # 4. Ensure the slot is within staff working hours (already guaranteed by the available_timeslots function)
                    # 5. Ensure the slot doesn't overlap with other appointments (already guaranteed by the available_timeslots function)
                    available_slots = [
                        slot for slot in response.timeslots 
                        if slot.is_available and 
                        slot.start_time > buffer_time and 
                        slot.start_time < start_time
                    ]

                    # Debug the slots we found
                    for s in available_slots:
                        print(f"Available earlier slot: {s.start_time} to {s.end_time}")

                    print(f"Found {len(available_slots)} available earlier slots for appointment {appointment['id']} on {check_date.date()}")

                    # Sort by start_time to find the earliest available slot
                    available_slots.sort(key=lambda slot: slot.start_time)

                    if available_slots:
                        slot_info = available_slots[0]
                        print(f"Selected earliest slot: {slot_info.start_time.strftime('%H:%M')} - {slot_info.end_time.strftime('%H:%M')}"
                              f" for appointment {appointment['id']}")

                        # Store the earliest available slot for this day
                        earliest_available_slot = slot_info
                        break

            # If an earlier slot is found, create a notification
            if earliest_available_slot:
                appointments_with_earlier_slots += 1

                # Check if we already have a notification for this appointment
                existing_notification_query = db.collection('earlier_slot_notifications')
                existing_notification_query = existing_notification_query.where('appointmentId', '==', appointment['id'])

                existing_notifications = list(existing_notification_query.stream())

                if not existing_notifications:  # No existing notification for this slot
                    # Create a notification in the database
                    notification_ref = db.collection('earlier_slot_notifications').document()

                    # Create the notification with the selected slot details
                    # Note: We'll use SERVER_TIMESTAMP for timestamps to avoid import issues
                    # We need to add the actual date strings for the earlier slots, not SERVER_TIMESTAMP
                    # since those precise times are important for the user to see

                    # Get the correct customer ID from the appointment
                    customer_id = appointment.get('customerId') or appointment.get('userId') or appointment.get('customerUid')

                    if not customer_id or customer_id == "unknown_user":
                        # Try to resolve through embedded user object if available
                        if isinstance(appointment.get('user'), dict):
                            customer_id = appointment['user'].get('id')

                    if not customer_id:
                        customer_id = "unknown_user"
                        print(f"No customer ID could be found after all attempts, using fallback: {customer_id}")

                    print(f"Final customer ID for notification: {customer_id}")

                    notification_data = {
                        'appointmentId': appointment['id'],
                        'userId': customer_id,
                        'shopId': shop_id,
                        'staffId': staff_id,
                        'serviceId': service_id,
                        'originalStartTime': appointment['startTime'],
                        'originalEndTime': appointment['endTime'],
                        'earlierStartTime': earliest_available_slot.start_time.isoformat() if isinstance(earliest_available_slot.start_time, datetime) else earliest_available_slot.start_time,
                        'earlierEndTime': earliest_available_slot.end_time.isoformat() if isinstance(earliest_available_slot.end_time, datetime) else earliest_available_slot.end_time,
                        'createdAt': firestore.SERVER_TIMESTAMP,
                        'isRead': False,
                        'isAccepted': False
                    }
                    
                    # Log the notification data being created
                    print(f"Creating notification with data: {notification_data}")
                    
                    # If this is an unknown_user notification, log it with more details for debugging
                    if customer_id == "unknown_user":
                        print(f"WARNING: Creating unknown_user notification for appointment {appointment['id']}")
                        print(f"Appointment data: {appointment}")

                    notification_ref.set(notification_data)
                    notifications_created += 1
                    print(f"Created notification for appointment {appointment['id']} with earlier slot at {earliest_available_slot.start_time}")
        # End time measurement and log performance
        perf_end_time = time_module.time()
        execution_time = perf_end_time - perf_start_time
        print(f"Check for earlier slots completed in {execution_time:.2f} seconds")

        return CheckEarlierSlotsResponse(
            notifications_created=notifications_created,
            appointments_checked=len(appointments),
            appointments_with_earlier_slots=appointments_with_earlier_slots
        )

    except Exception as e:
        perf_end_time = time_module.time()
        execution_time = perf_end_time - perf_start_time
        print(f"Error checking for earlier slots after {execution_time:.2f} seconds: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error checking for earlier slots: {str(e)}") from e