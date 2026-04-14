from typing import Dict, Any, Optional, List
from datetime import datetime
from fastapi import BackgroundTasks, APIRouter
from google.cloud import firestore
import traceback

from app.apis.firebase_utils import get_firestore_db
from app.apis.cache import invalidate_shop_date_cache

# Empty router to satisfy the API module requirements
router = APIRouter()


def extract_date_from_timestamp(timestamp_value):
    """
    Extract a date object from various timestamp formats.
    
    Args:
        timestamp_value: A timestamp in any supported format
        
    Returns:
        A datetime.date object or None if extraction fails
    """
    if timestamp_value is None:
        return None
        
    try:
        # If it's already a datetime object
        if isinstance(timestamp_value, datetime):
            return timestamp_value.date()
            
        # If it's a Firestore timestamp
        if hasattr(timestamp_value, 'toDate'):
            return timestamp_value.toDate().date()
            
        # If it's an ISO format string
        if isinstance(timestamp_value, str):
            # Handle various string formats
            if 'T' in timestamp_value:
                # Handle ISO format with T separator
                try:
                    # Remove timezone info if present for consistent processing
                    if '+' in timestamp_value:
                        timestamp_value = timestamp_value.split('+')[0]
                    elif 'Z' in timestamp_value:
                        timestamp_value = timestamp_value.replace('Z', '')
                        
                    dt = datetime.fromisoformat(timestamp_value)
                    return dt.date()
                except ValueError as e:
                    print(f"ISO datetime parse error: {e}")
            else:
                # Try simple date format (YYYY-MM-DD)
                try:
                    from datetime import date
                    return date.fromisoformat(timestamp_value)
                except ValueError as e:
                    print(f"Date string parse error: {e}")
                
        # If it's a timestamp dictionary with seconds
        if isinstance(timestamp_value, dict) and 'seconds' in timestamp_value:
            return datetime.fromtimestamp(timestamp_value['seconds']).date()
            
        # Last resort - try direct conversion if it's an int or float
        if isinstance(timestamp_value, (int, float)):
            return datetime.fromtimestamp(timestamp_value).date()
    except Exception as e:
        print(f"Error extracting date from timestamp: {e}, type={type(timestamp_value)}")
    
    # If all extraction attempts failed, log the failure but don't crash
    print(f"WARNING: Failed to extract date from {timestamp_value} of type {type(timestamp_value)}")
    return None


async def update_appointment(appointment_id: str, update_data: Dict[str, Any], 
                           background_tasks: Optional[BackgroundTasks] = None,
                           original_date: Optional[str] = None,
                           new_date: Optional[str] = None) -> Dict[str, str]:
    """
    Update an appointment and automatically invalidate relevant caches
    
    Args:
        appointment_id: The ID of the appointment to update
        update_data: The data to update in the appointment
        background_tasks: Optional background tasks for async processing
        original_date: Optional date string of the original appointment
        new_date: Optional date string of the new appointment time
        
    Returns:
        Dict with status information
    """
    # Log operation start
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{current_time}] APPOINTMENT UPDATE: Starting for {appointment_id}")
    
    try:
        db = get_firestore_db()
        
        # Get the current appointment
        appointment_ref = db.collection('appointments').document(appointment_id)
        appointment_doc = appointment_ref.get()
        
        if not appointment_doc.exists:
            print(f"Appointment {appointment_id} not found")
            return {"status": "error", "message": f"Appointment {appointment_id} not found"}
        
        # Extract appointment data
        current_appointment = appointment_doc.to_dict()
        shop_id = current_appointment.get('shopId')
        staff_id = current_appointment.get('staffId')
        
        # Process dates for cache invalidation
        original_date_obj = None
        new_date_obj = None
        
        # Process original date
        if original_date:
            try:
                from datetime import date
                original_date_obj = date.fromisoformat(original_date)
            except Exception as e:
                print(f"Error parsing original date: {e}")
                original_date_obj = extract_date_from_timestamp(current_appointment.get('startTime'))
        else:
            original_date_obj = extract_date_from_timestamp(current_appointment.get('startTime'))
            
        # Process new date
        if new_date:
            try:
                from datetime import date
                new_date_obj = date.fromisoformat(new_date)
            except Exception as e:
                print(f"Error parsing new date: {e}")
                if 'startTime' in update_data:
                    new_date_obj = extract_date_from_timestamp(update_data['startTime'])
        elif 'startTime' in update_data:
            new_date_obj = extract_date_from_timestamp(update_data['startTime'])
        
        # Update in database
        try:
            appointment_ref.update(update_data)
            print(f"Successfully updated appointment {appointment_id}")
        except Exception as e:
            print(f"Error updating appointment: {e}")
            return {"status": "error", "message": f"Error updating appointment: {str(e)}"}
        
        # Handle cache invalidation
        if shop_id:
            # Invalidate original date cache
            if original_date_obj:
                try:
                    date_str = original_date_obj.isoformat()
                    print(f"Invalidating cache for original date: {date_str}")
                    invalidate_shop_date_cache(shop_id, date_str)
                    
                    if staff_id:
                        invalidate_shop_date_cache(shop_id, date_str, staff_id)
                except Exception as e:
                    print(f"Error invalidating original date cache: {e}")
            
            # Invalidate new date cache if different
            if new_date_obj and new_date_obj != original_date_obj:
                try:
                    date_str = new_date_obj.isoformat()
                    print(f"Invalidating cache for new date: {date_str}")
                    invalidate_shop_date_cache(shop_id, date_str)
                    
                    if staff_id:
                        invalidate_shop_date_cache(shop_id, date_str, staff_id)
                except Exception as e:
                    print(f"Error invalidating new date cache: {e}")
        
        return {"status": "success", "message": "Appointment updated successfully"}
        
    except Exception as e:
        print(f"Critical error in update_appointment: {e}")
        traceback.print_exc()
        return {"status": "error", "message": f"Error updating appointment: {str(e)}"}


async def create_appointment(appointment_data: Dict[str, Any],
                           background_tasks: Optional[BackgroundTasks] = None) -> Dict[str, Any]:
    """
    Create a new appointment and invalidate relevant caches
    
    Args:
        appointment_data: The data for the new appointment
        background_tasks: Optional background tasks for async processing
        
    Returns:
        Dict with appointment ID and status
    """
    try:
        db = get_firestore_db()
        
        # Add creation timestamp
        appointment_data['createdAt'] = firestore.SERVER_TIMESTAMP
        appointment_data['updatedAt'] = firestore.SERVER_TIMESTAMP
        
        # Create the appointment
        doc_ref = db.collection('appointments').document()
        doc_ref.set(appointment_data)
        appointment_id = doc_ref.id
        
        # Extract shop_id and date for cache invalidation
        shop_id = appointment_data.get('shopId')
        staff_id = appointment_data.get('staffId')
        
        if shop_id:
            # Extract date from appointment
            date_obj = extract_date_from_timestamp(appointment_data.get('startTime'))
            
            if date_obj:
                date_str = date_obj.isoformat()
                try:
                    # Invalidate shop-wide cache
                    invalidate_shop_date_cache(shop_id, date_str)
                    
                    # Invalidate staff-specific cache
                    if staff_id:
                        invalidate_shop_date_cache(shop_id, date_str, staff_id)
                except Exception as e:
                    print(f"Error invalidating cache after appointment creation: {e}")
        
        return {
            "status": "success", 
            "message": "Appointment created successfully", 
            "appointmentId": appointment_id
        }
        
    except Exception as e:
        print(f"Error creating appointment: {e}")
        traceback.print_exc()
        return {"status": "error", "message": f"Error creating appointment: {str(e)}"}


async def cancel_appointment(appointment_id: str,
                           background_tasks: Optional[BackgroundTasks] = None) -> Dict[str, str]:
    """
    Cancel an appointment and invalidate relevant caches
    
    Args:
        appointment_id: The ID of the appointment to cancel
        background_tasks: Optional background tasks for async processing
        
    Returns:
        Dict with status information
    """
    try:
        # Mark as cancelled with timestamp
        update_data = {
            'status': 'cancelled',
            'cancelledAt': firestore.SERVER_TIMESTAMP,
            'updatedAt': firestore.SERVER_TIMESTAMP
        }
        
        # Use the main update function to ensure consistent cache invalidation
        result = await update_appointment(appointment_id, update_data, background_tasks)
        
        if result.get('status') == 'success':
            return {"status": "success", "message": "Appointment cancelled successfully"}
        else:
            return result
        
    except Exception as e:
        print(f"Error cancelling appointment: {e}")
        traceback.print_exc()
        return {"status": "error", "message": f"Error cancelling appointment: {str(e)}"}
