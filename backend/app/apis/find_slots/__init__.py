from typing import List
from datetime import datetime, timedelta
from fastapi import APIRouter
from firebase_admin import firestore
from pydantic import BaseModel

# Import modules
from app.apis.firebase_utils import get_firestore_db
from app.apis.models import TimeSlot, AvailableTimeslotsRequest
from app.apis.available_timeslots import get_available_timeslots
from app.apis.utils import convert_timestamp_to_datetime

# Define router
router = APIRouter()

class AppointmentIdsRequest(BaseModel):
    appointment_ids: List[str]

@router.post("/find-new-slots")
async def find_new_slots(request: AppointmentIdsRequest) -> dict:
    """Find new available earlier slots for appointments"""
    await find_new_slots_for_appointments(request.appointment_ids)
    return {"status": "success", "message": f"Process started for {len(request.appointment_ids)} appointments"}

async def find_new_slots_for_appointments(appointment_ids: List[str]) -> None:
    """
    Find new available earlier slots for appointments.
    This function is called after an earlier slot has been accepted to update other notifications.
    """
    try:
        db = get_firestore_db()
        print(f"Finding new available slots for {len(appointment_ids)} appointments")
        
        # Stats for logging
        slots_found = 0
        notifications_created = 0
        
        # For each appointment ID, find potential earlier slots
        for appointment_id in appointment_ids:
            # Get the appointment details
            appointment_ref = db.collection('appointments').document(appointment_id)
            appointment_doc = appointment_ref.get()
            
            if not appointment_doc.exists:
                print(f"Appointment {appointment_id} not found")
                continue
                
            # Get appointment data
            appointment = appointment_doc.to_dict()
            appointment['id'] = appointment_id
            
            # Check if this appointment is still scheduled and has the option enabled
            if appointment.get('status') != 'scheduled' or appointment.get('checkEarlierOptions') != True:
                print(f"Appointment {appointment_id} is not eligible for earlier slots")
                continue

            # Skip if the appointment is less than 2 hours from now to avoid constant rescheduling
            start_time = convert_timestamp_to_datetime(appointment['startTime'])
            if start_time < datetime.now() + timedelta(hours=2):
                print(f"Skipping appointment {appointment_id}: too close to current time")
                continue

            # Get the service details
            service_id = appointment.get('serviceId')
            shop_id = appointment.get('shopId')
            staff_id = appointment.get('staffId')
            customer_id = appointment.get('customerId')

            if not all([service_id, shop_id, staff_id, customer_id]):
                print(f"Skipping appointment {appointment_id}: missing required fields")
                continue

            # Get service duration to identify a valid earlier slot
            service_ref = db.collection('services').document(service_id)
            service_doc = service_ref.get()
            if not service_doc.exists:
                print(f"Service {service_id} not found for appointment {appointment_id}")
                continue

            service = service_doc.to_dict()

            # Get available timeslots from now until the appointment date
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
            print(f"DEBUG: Looking for earlier slots between {buffer_time} and {start_time} for appointment {appointment_id}")

            # First check for cancelled appointments that could be offered as earlier slots
            cancelled_appt_query = db.collection('appointments')
            cancelled_appt_query = cancelled_appt_query.where(filter=firestore.FieldFilter('shopId', '==', shop_id))
            cancelled_appt_query = cancelled_appt_query.where(filter=firestore.FieldFilter('staffId', '==', staff_id))
            cancelled_appt_query = cancelled_appt_query.where(filter=firestore.FieldFilter('status', '==', 'cancelled'))
            
            # We don't need to query by service as we can filter those after fetching
            cancelled_appointments = []
            for doc in cancelled_appt_query.stream():
                cancelled_appt = doc.to_dict()
                cancelled_appt['id'] = doc.id
                cancelled_appointments.append(cancelled_appt)
                
            print(f"Found {len(cancelled_appointments)} cancelled appointments for shop/staff")
            
            # Find cancelled appointments that could be used as earlier slots
            for cancelled_appt in cancelled_appointments:
                cancelled_start = convert_timestamp_to_datetime(cancelled_appt['startTime'])
                cancelled_end = convert_timestamp_to_datetime(cancelled_appt['endTime'])
                
                # Only consider cancelled appointments that are in the future (after buffer) 
                # and before the current appointment
                if cancelled_start > buffer_time and cancelled_start < start_time:
                    # Make sure the service duration is compatible
                    cancelled_service_id = cancelled_appt.get('serviceId')
                    if cancelled_service_id:
                        cancelled_service_ref = db.collection('services').document(cancelled_service_id)
                        cancelled_service_doc = cancelled_service_ref.get()
                        if cancelled_service_doc.exists:
                            cancelled_service = cancelled_service_doc.to_dict()
                            original_duration = service.get('duration', 30)
                            cancelled_duration = cancelled_service.get('duration', 30)
                            
                            print(f"Comparing durations: Original={original_duration}min, Cancelled={cancelled_duration}min")
                            
                            # This cancelled appointment can be used as an earlier slot
                            slot_info = TimeSlot(
                                start_time=cancelled_start,
                                end_time=cancelled_end,
                                is_available=True
                            )
                            
                            print(f"Found cancelled appointment for earlier slot: {cancelled_start} to {cancelled_end}")
                            earliest_available_slot = slot_info
                            break
            
            # If no suitable cancelled appointment was found, check for regular available slots
            if not earliest_available_slot:
                for check_date in check_days:
                    request = AvailableTimeslotsRequest(
                        shop_id=shop_id,
                        service_id=service_id,
                        staff_id=staff_id,
                        date=check_date
                    )

                    # Use the existing API to get available slots
                    response = get_available_timeslots(request, None)

                    # Add a buffer to avoid creating slots too close to the current time
                    buffer_time = now + timedelta(minutes=60)

                    # Filter for available slots between now+buffer and the appointment time
                    available_slots = [
                        slot for slot in response.timeslots 
                        if slot.is_available and 
                        slot.start_time > buffer_time and 
                        slot.start_time < start_time
                    ]

                    print(f"Found {len(available_slots)} available earlier slots for appointment {appointment_id} on {check_date.date()}")

                    # Sort by start_time to find the earliest available slot
                    available_slots.sort(key=lambda slot: slot.start_time)

                    if available_slots:
                        slot_info = available_slots[0]
                        print(f"Selected earliest slot: {slot_info.start_time} for appointment {appointment_id}")
                        earliest_available_slot = slot_info
                        break

            # If an earlier slot is found, create a notification
            if earliest_available_slot:
                slots_found += 1

                # Check if we already have a notification for this appointment
                existing_notification_query = db.collection('earlier_slot_notifications')
                existing_notification_query = existing_notification_query.where('appointmentId', '==', appointment_id)

                existing_notifications = list(existing_notification_query.stream())

                if not existing_notifications:  # No existing notification for this slot
                    # Get the correct customer ID from the appointment
                    customer_id = None
                    
                    # Try to get customerId from the appointment first
                    if 'customerId' in appointment:
                        customer_doc_id = appointment['customerId']
                        try:
                            customer_doc = db.collection('customers').document(customer_doc_id).get()
                            if customer_doc.exists:
                                customer_data = customer_doc.to_dict()
                                # Look for authUid or uid in the customer document
                                if 'authUid' in customer_data:
                                    customer_id = customer_data['authUid']
                                elif 'uid' in customer_data:
                                    customer_id = customer_data['uid']
                                elif 'userId' in customer_data:
                                    customer_id = customer_data['userId']
                        except Exception as e:
                            print(f"Error getting customer document: {e}")

                    # Fallbacks if no customer ID was found
                    if not customer_id and 'userId' in appointment:
                        customer_id = appointment['userId']
                        print(f"Using userId directly from appointment: {customer_id}")
                    elif not customer_id and 'customerUid' in appointment:
                        customer_id = appointment['customerUid']
                        print(f"Using customerUid directly from appointment: {customer_id}")
                    elif not customer_id and 'customer_id' in appointment:
                        customer_id = appointment['customer_id']
                        print(f"Using customer_id from appointment: {customer_id}")
                    
                    # Prüfen, ob wir jetzt eine valide customer_id haben oder nicht
                    if not customer_id or customer_id == "unknown_user":
                        # Wenn wir immer noch keine valide ID haben, versuchen wir es mit weiteren Möglichkeiten
                        print(f"Trying additional methods to find user ID for appointment {appointment_id}")
                        
                        # Check if the appointment has a user object with ID
                        if 'user' in appointment and isinstance(appointment['user'], dict) and 'id' in appointment['user']:
                            customer_id = appointment['user']['id']
                            print(f"Found userId in appointment.user.id: {customer_id}")
                        
                        # Try to find user by email if available in appointment
                        elif 'customerEmail' in appointment and appointment['customerEmail']:
                            # Search for users with the same email address
                            users_query = db.collection('users')
                            users_query = users_query.where('email', '==', appointment['customerEmail'])
                            matching_users = list(users_query.stream())
                            
                            if matching_users:
                                user_data = matching_users[0].to_dict()
                                customer_id = matching_users[0].id
                                print(f"Found user with matching email, using ID: {customer_id}")
                        
                        # Try to check customer name field if it might contain an email
                        elif 'customerName' in appointment and appointment['customerName'] and '@' in appointment['customerName']:
                            try:
                                # Assume the customerName might be an email address
                                potential_email = appointment['customerName']
                                print(f"Trying to find user with email from customerName: {potential_email}")
                                
                                users_query = db.collection('users')
                                users_query = users_query.where('email', '==', potential_email)
                                matching_users = list(users_query.stream())
                                
                                if matching_users:
                                    user_data = matching_users[0].to_dict()
                                    customer_id = matching_users[0].id
                                    print(f"Found user with matching email from customerName, using ID: {customer_id}")
                            except Exception as e:
                                print(f"Error checking customerName as email: {e}")
                                # Continue with other methods
                    
                    # Only use unknown_user as absolute last resort
                    if not customer_id:
                        customer_id = "unknown_user"
                        print(f"No customer ID could be found after all attempts, using fallback: {customer_id}")

                    # Create a notification in the database
                    notification_ref = db.collection('earlier_slot_notifications').document()

                    # Convert datetime objects to ISO format for storage
                    earlier_start_iso = earliest_available_slot.start_time.isoformat() if isinstance(earliest_available_slot.start_time, datetime) else earliest_available_slot.start_time
                    earlier_end_iso = earliest_available_slot.end_time.isoformat() if isinstance(earliest_available_slot.end_time, datetime) else earliest_available_slot.end_time

                    notification_data = {
                        'appointmentId': appointment_id,
                        'userId': customer_id,
                        'shopId': shop_id,
                        'staffId': staff_id,
                        'serviceId': service_id,
                        'originalStartTime': appointment['startTime'],
                        'originalEndTime': appointment['endTime'],
                        'earlierStartTime': earlier_start_iso,
                        'earlierEndTime': earlier_end_iso,
                        'createdAt': firestore.SERVER_TIMESTAMP,
                        'isRead': False,
                        'isAccepted': False
                    }
                    
                    # Log the notification data being created
                    print(f"Creating notification with data: {notification_data}")
                    
                    # If this is an unknown_user notification, log it with more details for debugging
                    if customer_id == "unknown_user":
                        print(f"WARNING: Creating unknown_user notification for appointment {appointment_id}")
                        print(f"Appointment data: {appointment}")

                    notification_ref.set(notification_data)
                    notifications_created += 1
                    print(f"Created new notification for appointment {appointment_id} with earlier slot at {earliest_available_slot.start_time}")
                    
                    # If this was an unknown_user notification, try to update it with correct user ID
                    # by checking the appointment more thoroughly
                    if customer_id == "unknown_user":
                        # Get the appointment again to make sure we have fresh data
                        try:
                            print(f"Attempting to find correct user ID for unknown_user notification")
                            appointment_ref = db.collection('appointments').document(appointment_id)
                            appointment_doc = appointment_ref.get()
                            if appointment_doc.exists:
                                current_appointment = appointment_doc.to_dict()
                                
                                # Try to get userRef if available
                                if 'userRef' in current_appointment and current_appointment['userRef']:
                                    user_id = current_appointment['userRef'].id
                                    print(f"Found userRef ID: {user_id}")
                                    
                                    # Update the notification with the correct user ID
                                    notification_ref.update({
                                        'userId': user_id
                                    })
                                    print(f"Updated notification with correct user ID: {user_id}")
                                elif 'customerId' in current_appointment and current_appointment['customerId']:
                                    # Directly check users collection instead of customers collection
                                    try:
                                        customer_id_to_check = current_appointment['customerId']
                                        print(f"Checking if customerId {customer_id_to_check} exists directly in users collection")
                                        
                                        user_doc = db.collection('users').document(customer_id_to_check).get()
                                        if user_doc.exists:
                                            # This customer ID is actually a valid user ID
                                            notification_ref.update({
                                                'userId': customer_id_to_check
                                            })
                                            print(f"Updated notification with customerId as userId: {customer_id_to_check}")
                                    except Exception as customer_check_err:
                                        print(f"Error checking customerId in users collection: {customer_check_err}")
                        except Exception as e:
                            print(f"Error trying to update unknown_user notification: {e}")
                            # Don't fail the whole process if this update fails
                        
                        # Final fallback - check all appointments for this customer to look for user ID patterns
                        try:
                            # Look for other appointments by the same customer that might have a valid user ID
                            other_appts_query = db.collection('appointments')
                            other_appts_query = other_appts_query.where('shopId', '==', shop_id)
                            
                            # If we have a customer name, try to find other appointments with the same name
                            if 'customerName' in appointment and appointment['customerName']:
                                customer_name = appointment['customerName']
                                print(f"Searching for other appointments with customer name: {customer_name}")
                                other_appts_query = other_appts_query.where('customerName', '==', customer_name)
                                
                                other_appointments = list(other_appts_query.stream())
                                for other_appt_doc in other_appointments:
                                    other_appt = other_appt_doc.to_dict()
                                    if other_appt.get('customerId') and other_appt.get('customerId') != 'unknown_user':
                                        potential_user_id = other_appt['customerId']
                                        # Verify this ID exists in users collection
                                        user_check = db.collection('users').document(potential_user_id).get()
                                        if user_check.exists:
                                            print(f"Found userId {potential_user_id} in another appointment for same customer")
                                            notification_ref.update({
                                                'userId': potential_user_id
                                            })
                                            print(f"Updated notification with userId from another appointment: {potential_user_id}")
                                            break
                        except Exception as fallback_err:
                            print(f"Error in fallback user ID search: {fallback_err}")
                            # Just log and continue

        print(f"Find new slots complete: Found {slots_found} slots, created {notifications_created} notifications")
    
    except Exception as e:
        print(f"Error finding new slots for appointments: {e}")
        # Just log the error but don't raise it, as this is a background task