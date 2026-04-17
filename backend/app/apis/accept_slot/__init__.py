from typing import Dict, List
from datetime import datetime
from fastapi import BackgroundTasks, HTTPException, APIRouter, Depends, Query
from app.auth import AuthorizedUser
from google.cloud import firestore

from app.apis.appointment_helpers import update_appointment
from app.apis.firebase_utils import get_firestore_db
from app.apis.utils import convert_timestamp_to_datetime
from app.apis.find_slots import find_new_slots_for_appointments
from app.apis.cache import invalidate_shop_date_cache

# Create the router
router = APIRouter()

async def accept_earlier_slot_impl(notification_id: str, background_tasks: BackgroundTasks = None, user_id: str = None) -> Dict[str, str]:
    """Implementation of accepting an earlier slot.
    
    Args:
        notification_id: The ID of the notification to accept
        background_tasks: Optional background tasks for async operations
        user_id: The ID of the authenticated user, used for authorization
        
    Returns:
        Dict with status information
    """
    """
    Accept an earlier slot notification and update the appointment.
    Also deletes all other pending earlier slot suggestions for the same staff member
    and triggers the process to find new available slots.
    """
    # Log start of operation with timestamp for better traceability
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{current_time}] ACCEPT EARLIER SLOT: Starting for notification {notification_id} by user {user_id}")
    try:
        db = get_firestore_db()

        # Get the notification
        notification_ref = db.collection('earlier_slot_notifications').document(notification_id)
        notification_doc = notification_ref.get()

        if not notification_doc.exists:
            print(f"Notification {notification_id} not found")
            return {"status": "error", "message": f"Notification {notification_id} not found"}

        notification = notification_doc.to_dict()
        notification['id'] = notification_id

        # Get the appointment
        appointment_id = notification.get('appointmentId')
        appointment_ref = db.collection('appointments').document(appointment_id)
        appointment_doc = appointment_ref.get()

        if not appointment_doc.exists:
            print(f"Appointment {appointment_id} not found")
            return {"status": "error", "message": f"Appointment {appointment_id} not found"}

        # Get the current appointment data to properly handle the update
        current_appointment = appointment_doc.to_dict()
        
        # Check if notification has unknown_user ID and update it if necessary
        notification_user_id = notification.get('userId')
        if notification_user_id == 'unknown_user' and user_id:
            print(f"Notification {notification_id} has unknown_user ID, updating to {user_id}")
            try:
                # Update the notification with the correct user ID
                notification_ref.update({
                    'userId': user_id
                })
                print(f"Updated notification {notification_id} with correct user ID: {user_id}")
                # Update our local copy of the notification
                notification['userId'] = user_id
            except Exception as update_err:
                print(f"Error updating notification user ID: {update_err}")
                # Continue with normal flow, this is just a correction
        
        # Enhanced authorization check with better logging
        customer_id = current_appointment.get('customerId') or current_appointment.get('userId')
        
        # Try to get user ID from user object if it exists
        if not customer_id and 'user' in current_appointment and isinstance(current_appointment['user'], dict):
            customer_id = current_appointment['user'].get('id')
        
        # Add more detailed logging for troubleshooting
        print(f"Authorization check - Customer ID from appointment: {customer_id}")
        print(f"Authorization check - Authenticated user ID: {user_id}")
        
        # More robust authorization check with specific error messages
        if user_id and customer_id and user_id != customer_id:
            print(f"AUTHORIZATION FAILED: User {user_id} not authorized to modify appointment for customer {customer_id}")
            return {"status": "error", "message": "You are not authorized to modify this appointment", "code": "unauthorized"}
        
        if not user_id:
            print("WARNING: No authenticated user ID provided")
        
        if not customer_id:
            print("WARNING: No customer ID found in appointment")
        
        # Store IDs for later reference and cache invalidation
        appointment_id = appointment_doc.id
        shop_id = current_appointment.get('shopId')
        staff_id = current_appointment.get('staffId')
        
        # Get shop_id and staff_id from notification, with fallback to the current appointment
        if not shop_id:
            shop_id = notification.get('shopId', current_appointment.get('shopId'))
        if not staff_id:
            staff_id = notification.get('staffId', current_appointment.get('staffId'))
        
        # Ensure staff_id is a string for consistent comparison
        if staff_id is not None:
            staff_id = str(staff_id)
        
        # Get the earlier times from the notification
        earlier_start = notification.get('earlierStartTime')
        earlier_end = notification.get('earlierEndTime')
        
        # Convert start/end times to datetime objects for consistency
        # Google Cloud Firestore can directly handle Python datetime objects
        try:
            # Convert string ISO timestamps to datetime objects if needed
            def ensure_datetime(time_value):
                if isinstance(time_value, str):
                    try:
                        # Try to parse ISO format (2025-03-28T10:33:00)
                        return datetime.fromisoformat(time_value.replace('Z', '+00:00'))
                    except ValueError as e:
                        print(f"Error converting timestamp string: {e}")
                        return datetime.now()  # Fallback
                elif hasattr(time_value, 'toDate'):
                    # Handle Firebase Timestamp objects
                    return time_value.toDate()
                elif isinstance(time_value, datetime):
                    return time_value
                else:
                    print(f"Unknown timestamp type: {type(time_value)}, value: {time_value}")
                    return datetime.now()  # Fallback
            
            import zoneinfo
            local_tz = zoneinfo.ZoneInfo('Europe/Berlin')
            
            # Convert to Python datetime objects
            earlier_start_datetime = ensure_datetime(earlier_start)
            earlier_end_datetime = ensure_datetime(earlier_end)
            
            # Ensure they are timezone aware before giving them to Firestore
            # Firestore assumes naive datetimes are UTC, but these are local times
            if earlier_start_datetime.tzinfo is None:
                earlier_start_datetime = earlier_start_datetime.replace(tzinfo=local_tz)
            if earlier_end_datetime.tzinfo is None:
                earlier_end_datetime = earlier_end_datetime.replace(tzinfo=local_tz)
                
            # Debug: Log the type and value of timestamps
            print(f"Original startTime type: {type(earlier_start)}, value: {earlier_start}")
            print(f"Converted startTime type: {type(earlier_start_datetime)}, value: {earlier_start_datetime}")
            print(f"Original endTime type: {type(earlier_end)}, value: {earlier_end}")
            print(f"Converted endTime type: {type(earlier_end_datetime)}, value: {earlier_end_datetime}")
            
            # Debug: Log the current appointment timestamps
            current_start = current_appointment.get('startTime')
            print(f"Current appointment startTime type: {type(current_start)}, value: {current_start}")
            
            # Build the update with mandatory SERVER_TIMESTAMP for updatedAt
            appointment_update = {
                'startTime': earlier_start_datetime,
                'endTime': earlier_end_datetime,
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'status': 'scheduled',  # Always ensure the status is scheduled
                'staffId': staff_id     # Ensure consistent staffId format
            }
        except Exception as e:
            print(f"Warning: Error processing timestamp conversion: {e}")
            # Fallback to original values if conversion fails
            appointment_update = {
                'startTime': earlier_start,
                'endTime': earlier_end,
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'status': 'scheduled',
                'staffId': staff_id
            }
        
        print(f"Updating appointment {appointment_id} with new times using central update function")
        # Extract the original date string for both original and new dates for accurate cache invalidation
        original_start_date = None
        if 'startTime' in current_appointment:
            try:
                orig_start = current_appointment.get('startTime')
                if hasattr(orig_start, 'toDate'):
                    orig_start = orig_start.toDate()
                if isinstance(orig_start, datetime):
                    original_start_date = orig_start.date().isoformat()
                elif isinstance(orig_start, str) and 'T' in orig_start:
                    original_start_date = orig_start.split('T')[0]
                print(f"Original appointment date extracted: {original_start_date}")
            except Exception as e:
                print(f"Could not extract original date: {e}")
        
        # Get the new date for cache invalidation as well
        new_start_date = None
        try:
            if isinstance(earlier_start_datetime, datetime):
                new_start_date = earlier_start_datetime.date().isoformat()
                print(f"New appointment date extracted: {new_start_date}")
        except Exception as e:
            print(f"Could not extract new date: {e}")
            
        # Use the centralized appointment update function with enhanced error handling
        # Pass both date strings to ensure proper cache invalidation for both dates
        try:
            update_result = await update_appointment(appointment_id, appointment_update, background_tasks, 
                                   original_date=original_start_date, new_date=new_start_date)
            
            # Check if update was successful
            if update_result.get('status') != 'success':
                print(f"Appointment update failed: {update_result}")
                return update_result
                
            print(f"Successfully updated appointment {appointment_id} using central update function")
            
            # Force an additional explicit cache invalidation for both dates to ensure consistency
            try:
                if shop_id and original_start_date:
                    print(f"Explicit cache invalidation for original date: {original_start_date}")
                    invalidate_shop_date_cache(shop_id, original_start_date, staff_id)
                
                if shop_id and new_start_date and new_start_date != original_start_date:
                    print(f"Explicit cache invalidation for new date: {new_start_date}")
                    invalidate_shop_date_cache(shop_id, new_start_date, staff_id)
            except Exception as cache_error:
                print(f"Warning: Additional cache invalidation failed but appointment was updated: {cache_error}")
                # Continue execution, as this is just an extra precaution
            
        except Exception as e:
            print(f"Error updating appointment: {e}")
            return {"status": "error", "message": f"Error updating appointment: {str(e)}"}
        
        # Log before and after times for debugging
        if current_appointment and 'startTime' in current_appointment:
            original_start = current_appointment.get('startTime')
            if hasattr(original_start, 'toDate'):
                original_start = original_start.toDate()
            new_start = earlier_start
            if hasattr(new_start, 'toDate'):
                new_start = new_start.toDate()
            print(f"Changed appointment time from {original_start} to {new_start}")
            
        # Mark the notification as accepted
        notification_ref.update({
            'isAccepted': True,
            'isRead': True
        })

        # Get staff ID from the notification to identify all other pending notifications
        staff_id = staff_id or notification.get('staffId')
        if not staff_id:
            print(f"Warning: Staff ID not found in notification {notification_id}")
            return {"status": "success", "message": "Earlier slot accepted successfully, but staff ID not found"}
        
        # Safely convert the time fields to datetime for comparison
        def safely_convert_timestamp(timestamp_value):
            if timestamp_value is None:
                return datetime.now()  # Default fallback
                
            if isinstance(timestamp_value, datetime):
                return timestamp_value
                
            try:
                return convert_timestamp_to_datetime(timestamp_value)
            except Exception as e:
                print(f"Error converting timestamp: {e}")
                if isinstance(timestamp_value, str):
                    try:
                        return datetime.fromisoformat(timestamp_value.replace('Z', '+00:00'))
                    except ValueError:
                        pass
                return datetime.now()  # Fallback
        
        # Store time range of the accepted slot
        accepted_start_time = safely_convert_timestamp(earlier_start)
        accepted_end_time = safely_convert_timestamp(earlier_end)
        
        print(f"Accepted earlier slot time range: {accepted_start_time} to {accepted_end_time}")
        print(f"Looking for overlapping notifications for staff member {staff_id}")
        
        # Find all other pending notifications for the same staff member
        staff_notifications_query = db.collection('earlier_slot_notifications')
        staff_notifications_query = staff_notifications_query.where('staffId', '==', staff_id)
        staff_notifications_query = staff_notifications_query.where('isAccepted', '==', False)
        
        notification_ids_to_delete = []
        appointment_ids_to_check = []
        
        # Collect notifications to delete and their appointment IDs
        for doc in staff_notifications_query.stream():
            other_notification = doc.to_dict()
            other_notification['id'] = doc.id
            
            # Skip the notification that was just accepted
            if other_notification['id'] == notification_id:
                continue
                
            print(f"Checking notification {other_notification['id']} for overlap")
            
            # Safely convert timestamps for comparison
            other_start_time = safely_convert_timestamp(other_notification.get('earlierStartTime'))
            other_end_time = safely_convert_timestamp(other_notification.get('earlierEndTime'))
            
            print(f"  Other slot time range: {other_start_time} to {other_end_time}")
            
            # Check if there's an overlap between the accepted slot and this notification
            overlaps = (other_start_time < accepted_end_time and other_end_time > accepted_start_time)
            
            # Delete any pending notifications for the same staff member to avoid potential conflicts
            # This prevents double-booking situations
            if overlaps:
                print(f"  Notification {doc.id} overlaps with accepted slot, deleting")
                notification_ids_to_delete.append(doc.id)
                
                # Add appointment ID to the list of appointments to check for new slots
                appt_id = other_notification.get('appointmentId')
                if appt_id and appt_id not in appointment_ids_to_check:
                    appointment_ids_to_check.append(appt_id)
                    
                # Delete the notification
                doc.reference.delete()
            else:
                print(f"  Notification {doc.id} does not overlap with accepted slot, keeping")
        
        # Cache invalidation is now handled automatically by the updateAppointment function
        # No need for manual invalidation here, which makes the code simpler and more consistent
        
        # Trigger check for new slots for affected appointments
        if appointment_ids_to_check:
            print(f"Triggering check for new available slots for {len(appointment_ids_to_check)} affected appointments")
            if background_tasks:
                background_tasks.add_task(find_new_slots_for_appointments, appointment_ids_to_check)
            else:
                # If no background_tasks are provided, run synchronously
                await find_new_slots_for_appointments(appointment_ids_to_check)
        
        # Log completion of operation with timestamp
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{current_time}] ACCEPT EARLIER SLOT: Completed for notification {notification_id}")
        print(f"  - Appointment {appointment_id} updated")
        print(f"  - {len(notification_ids_to_delete)} overlapping notifications deleted")
        print(f"  - {len(appointment_ids_to_check)} appointments scheduled for new slot check")
        
        return {
            "status": "success", 
            "message": "Earlier slot accepted successfully",
            "deleted_notifications": str(len(notification_ids_to_delete)),
            "appointments_to_check": str(len(appointment_ids_to_check))
        }

    except Exception as e:
        print(f"Error accepting earlier slot: {str(e)}")
        return {"status": "error", "message": f"Error accepting earlier slot: {str(e)}"}

@router.post("/accept-earlier-slot/{notification_id}")
async def accept_earlier_slot(
    notification_id: str, 
    background_tasks: BackgroundTasks,
    user: AuthorizedUser
) -> Dict[str, str]:
    """Accept an earlier slot notification and update the appointment."""
    try:
        # Log authentication information for troubleshooting
        print(f"Processing accept-earlier-slot request with notification_id={notification_id} and user_id={user.sub}")
        
        # Call the implementation function with the authenticated user's ID
        result = await accept_earlier_slot_impl(notification_id, background_tasks, user.sub)
        
        # Log result for debugging
        print(f"accept_earlier_slot_impl returned: {result}")
        return result
        
    except Exception as e:
        print(f"Uncaught error in accept_earlier_slot endpoint: {e}")
        # Ensure we always return a proper JSON response
        return {"status": "error", "message": f"Error accepting earlier slot: {str(e)}"}