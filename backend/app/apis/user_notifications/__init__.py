from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import List, Dict, Optional, Any, Union
from datetime import datetime
from pydantic import BaseModel, Field
from app.apis.firebase_utils import get_firestore_db
from app.apis.utils import convert_timestamp_to_datetime
import traceback

router = APIRouter()

class NotificationItem(BaseModel):
    id: str
    appointmentId: str
    userId: str
    shopId: str
    staffId: str
    serviceId: str
    originalStartTime: datetime
    originalEndTime: datetime
    earlierStartTime: datetime
    earlierEndTime: datetime
    createdAt: datetime
    isRead: bool
    isAccepted: bool

@router.get("/user-notifications", response_model=List[NotificationItem])
async def get_user_notifications(userId: str, _t: Optional[str] = None) -> List[NotificationItem]:
    """
    Get all earlier slot notifications for a specific user.
    The _t parameter is a cache busting mechanism and is ignored.
    """
    try:
        db = get_firestore_db()
        
        # Get notifications for the user
        notifications_query = db.collection('earlier_slot_notifications')
        notifications_query = notifications_query.where('userId', '==', userId)
        notifications_query = notifications_query.where('isAccepted', '==', False)
        
        print(f"Querying notifications for user {userId} where isAccepted is False")
        
        # Debug check: Also check if there might be notifications without isAccepted field
        try:
            missing_field_query = db.collection('earlier_slot_notifications').where('userId', '==', userId)
            missing_field_docs = list(missing_field_query.stream())
            print(f"Total notifications for user {userId} (including all statuses): {len(missing_field_docs)}")
            
            # Check for missing isAccepted field
            for doc in missing_field_docs:
                notification = doc.to_dict()
                if 'isAccepted' not in notification:
                    print(f"Found notification {doc.id} without isAccepted field. Adding isAccepted=False")
                    # Fix the notification by adding isAccepted field
                    doc.reference.update({'isAccepted': False})
        except Exception as debug_err:
            print(f"Debug check error: {debug_err}")
            # Non-critical, continue with normal flow
        
        # Check if there are unknown_user notifications that might belong to this user
        # This helps to retroactively fix notifications created with the wrong user ID
        try:
            # Get all unknown_user notifications
            unknown_query = db.collection('earlier_slot_notifications').where('userId', '==', 'unknown_user')
            unknown_notifications = list(unknown_query.stream())
            
            if unknown_notifications:
                print(f"Found {len(unknown_notifications)} unknown_user notifications. Checking if any belong to user {userId}")
                
                # For each unknown notification, check if the appointment belongs to this user
                for doc in unknown_notifications:
                    notification = doc.to_dict()
                    notification_id = doc.id
                    appointment_id = notification.get('appointmentId')
                    
                    if not appointment_id:
                        continue
                    
                    # Get the appointment and check the customer ID
                    appointment_ref = db.collection('appointments').document(appointment_id)
                    appointment_doc = appointment_ref.get()
                    
                    if not appointment_doc.exists:
                        continue
                        
                    appointment_data = appointment_doc.to_dict()
                    
                    # Multiple checks to match appointment to user
                    matched = False
                    
                    # Check 1: Direct customerId match
                    customer_id = appointment_data.get('customerId')
                    if customer_id == userId:
                        matched = True
                        print(f"Found unknown_user notification {notification_id} that belongs to user {userId} (customerId match)")
                    
                    # Check 2: Look for userId in appointment
                    if not matched and appointment_data.get('userId') == userId:
                        matched = True
                        print(f"Found unknown_user notification {notification_id} that belongs to user {userId} (userId match)")
                    
                    # Check 3: Check userRef in appointment if available
                    if not matched and 'userRef' in appointment_data and appointment_data['userRef']:
                        try:
                            user_id_from_ref = appointment_data['userRef'].id
                            if user_id_from_ref == userId:
                                matched = True
                                print(f"Found unknown_user notification {notification_id} that belongs to user {userId} (userRef match)")
                        except Exception as ref_err:
                            print(f"Error checking userRef: {ref_err}")
                    
                    # Check 4: Email address match if customer email is available
                    if not matched and 'customerEmail' in appointment_data and appointment_data['customerEmail']:
                        try:
                            # Get current user's email
                            user_doc = db.collection('users').document(userId).get()
                            if user_doc.exists:
                                user_data = user_doc.to_dict()
                                if 'email' in user_data and user_data['email'] == appointment_data['customerEmail']:
                                    matched = True
                                    print(f"Found unknown_user notification {notification_id} that belongs to user {userId} (email match)")
                        except Exception as email_err:
                            print(f"Error checking email match: {email_err}")
                    
                    # Check 5: Name match if customer name is available
                    if not matched and 'customerName' in appointment_data and appointment_data['customerName'] and 'displayName' in appointment_data:
                        try:
                            # Get current user's display name
                            user_doc = db.collection('users').document(userId).get()
                            if user_doc.exists:
                                user_data = user_doc.to_dict()
                                if 'displayName' in user_data and user_data['displayName'] == appointment_data['customerName']:
                                    matched = True
                                    print(f"Found unknown_user notification {notification_id} that belongs to user {userId} (name match)")
                        except Exception as name_err:
                            print(f"Error checking name match: {name_err}")
                    
                    # If any match is found, update the notification with the correct user ID
                    if matched:
                        try:
                            doc.reference.update({
                                'userId': userId
                            })
                            print(f"Updated notification {notification_id} with correct user ID: {userId}")
                        except Exception as update_err:
                            print(f"Error updating notification: {update_err}")
        except Exception as unknown_err:
            print(f"Error checking unknown_user notifications: {unknown_err}")
            # Non-critical, continue with normal flow
        
        # Requery to get all notifications including any that were just updated
        notifications_query = db.collection('earlier_slot_notifications')
        notifications_query = notifications_query.where('userId', '==', userId)
        notifications_query = notifications_query.where('isAccepted', '==', False)
        
        user_notifications = []
        
        for doc in notifications_query.stream():
            notification = doc.to_dict()
            notification['id'] = doc.id
            
            # Convert timestamps to datetime objects
            try:
                # Safely convert timestamps with detailed error information
                try:
                    notification['originalStartTime'] = convert_timestamp_to_datetime(notification['originalStartTime'])
                    print(f"Successfully converted originalStartTime for {doc.id}")
                except Exception as e1:
                    print(f"Error converting originalStartTime in {doc.id}: {e1}")
                    notification['originalStartTime'] = datetime.now()  # Use current time as fallback
                    
                try:
                    notification['originalEndTime'] = convert_timestamp_to_datetime(notification['originalEndTime'])
                    print(f"Successfully converted originalEndTime for {doc.id}")
                except Exception as e2:
                    print(f"Error converting originalEndTime in {doc.id}: {e2}")
                    notification['originalEndTime'] = datetime.now()  # Use current time as fallback
                    
                try:
                    notification['earlierStartTime'] = convert_timestamp_to_datetime(notification['earlierStartTime'])
                    print(f"Successfully converted earlierStartTime for {doc.id}")
                except Exception as e3:
                    print(f"Error converting earlierStartTime in {doc.id}: {e3}")
                    notification['earlierStartTime'] = datetime.now()  # Use current time as fallback
                    
                try:
                    notification['earlierEndTime'] = convert_timestamp_to_datetime(notification['earlierEndTime'])
                    print(f"Successfully converted earlierEndTime for {doc.id}")
                except Exception as e4: 
                    print(f"Error converting earlierEndTime in {doc.id}: {e4}")
                    notification['earlierEndTime'] = datetime.now()  # Use current time as fallback
                    
                try:
                    notification['createdAt'] = convert_timestamp_to_datetime(notification.get('createdAt', datetime.now()))
                    print(f"Successfully converted createdAt for {doc.id}")
                except Exception as e5:
                    print(f"Error converting createdAt in {doc.id}: {e5}")
                    notification['createdAt'] = datetime.now()  # Use current time as fallback
            except Exception as e:
                print(f"Error converting timestamps in notification {doc.id}: {e}")
                # Wenn die Konvertierung fehlschlägt, überspringen wir diesen Eintrag
                continue
            
            notification_item = NotificationItem(
                id=notification['id'],
                appointmentId=notification['appointmentId'],
                userId=notification['userId'],
                shopId=notification['shopId'],
                staffId=notification['staffId'],
                serviceId=notification['serviceId'],
                originalStartTime=notification['originalStartTime'],
                originalEndTime=notification['originalEndTime'],
                earlierStartTime=notification['earlierStartTime'],
                earlierEndTime=notification['earlierEndTime'],
                createdAt=notification['createdAt'],
                isRead=notification.get('isRead', False),
                isAccepted=notification.get('isAccepted', False)
            )
            
            user_notifications.append(notification_item)
        
            # Debug-Ausgabe
        print(f"Found {len(user_notifications)} notifications for user {userId}")
        for notif in user_notifications:
            print(f"Notification {notif.id} for appointment {notif.appointmentId}")
            # Additional debug information for each notification
            try:
                appointment_time = notif.originalStartTime.strftime('%Y-%m-%d %H:%M:%S')
                earlier_time = notif.earlierStartTime.strftime('%Y-%m-%d %H:%M:%S')
                time_diff = int((notif.originalStartTime - notif.earlierStartTime).total_seconds() / 60)
                print(f"  Original time: {appointment_time}, Earlier time: {earlier_time}")
                print(f"  Time difference: {time_diff} minutes")
                print(f"  isAccepted: {notif.isAccepted}, isRead: {notif.isRead}")
            except Exception as debug_err:
                print(f"  Error printing debug info: {debug_err}")
        
        return user_notifications
        
    except Exception as e:
        print(f"Error getting user notifications: {str(e)}")
        print(traceback.format_exc())  # Print full traceback for better debugging
        raise HTTPException(status_code=500, detail=f"Error getting user notifications: {str(e)}") from e
