from fastapi import APIRouter, HTTPException
from typing import List, Dict, Optional
from datetime import datetime
from pydantic import BaseModel
from firebase_admin import firestore
from app.apis.firebase_utils import get_firestore_db
from app.apis.utils import convert_timestamp_to_datetime

router = APIRouter()

# Define models
class NotificationHistoryItem(BaseModel):
    id: str
    appointmentId: str
    userId: str
    userName: Optional[str] = None
    shopId: str
    shopName: Optional[str] = None
    staffId: str
    staffName: Optional[str] = None
    originalStartTime: Optional[datetime] = None
    earlierStartTime: Optional[datetime] = None
    createdAt: Optional[datetime] = None
    isAccepted: bool = False
    acceptedAt: Optional[datetime] = None
    timeDifference: Optional[int] = None  # in minutes
    appointmentDuration: Optional[int] = None  # in minutes

@router.get("/notification-history", operation_id="get_notification_history_full2222222")
async def get_notification_history_full2222222(limit: int = 100) -> List[NotificationHistoryItem]:
    """
    Get history of all earlier slot notifications, acceptances, and reschedulings.
    """
    try:
        db = get_firestore_db()
        
        # Get notifications
        notifications_query = db.collection('earlier_slot_notifications')
        notifications_query = notifications_query.order_by('createdAt', direction=firestore.Query.DESCENDING)
        notifications_query = notifications_query.limit(limit)
        
        history_items = []
        
        for doc in notifications_query.stream():
            notification = doc.to_dict()
            notification['id'] = doc.id
            
            # Convert timestamps to datetime objects
            # Add null safety for timestamp conversions
            try:
                if notification.get('originalStartTime'):
                    notification['originalStartTime'] = convert_timestamp_to_datetime(notification['originalStartTime'])
                else:
                    notification['originalStartTime'] = datetime.now()
                    
                if notification.get('earlierStartTime'):
                    notification['earlierStartTime'] = convert_timestamp_to_datetime(notification['earlierStartTime'])
                else:
                    notification['earlierStartTime'] = datetime.now()
                    
                if notification.get('createdAt'):
                    notification['createdAt'] = convert_timestamp_to_datetime(notification['createdAt'])
                else:
                    notification['createdAt'] = datetime.now()
            except Exception as e:
                print(f"Error converting timestamps: {e}")
                # Use default values if conversion fails
                notification['originalStartTime'] = datetime.now()
                notification['earlierStartTime'] = datetime.now()
                notification['createdAt'] = datetime.now()
            
            # Calculate time saved (in minutes)
            time_difference = 0
            if notification.get('originalStartTime') and notification.get('earlierStartTime'):
                try:
                    time_difference = int((notification['originalStartTime'] - notification['earlierStartTime']).total_seconds() / 60)
                except Exception as e:
                    print(f"Error calculating time difference: {e}")
                    time_difference = 0
            
            # Get appointment duration
            appointment_duration = 30  # Default to 30 minutes
            if 'appointmentId' in notification:
                appointment_ref = db.collection('appointments').document(notification['appointmentId'])
                appointment_doc = appointment_ref.get()
                if appointment_doc.exists:
                    appointment_data = appointment_doc.to_dict()
                    if 'duration' in appointment_data:
                        appointment_duration = appointment_data['duration']
            
            # Get user name
            user_name = None
            if 'userId' in notification:
                # First try to get from users collection using userId
                user_ref = db.collection('users').document(notification['userId'])
                user_doc = user_ref.get()
                if user_doc.exists:
                    user_data = user_doc.to_dict()
                    # Priorität: displayName > name > email
                    display_name = user_data.get('displayName')
                    name = user_data.get('name')
                    email = user_data.get('email')
                    
                    if display_name and display_name != 'Unbekannt':
                        user_name = display_name
                        print(f"Using displayName from userId: {user_name}")
                    elif name and name != 'Unbekannt':
                        user_name = name
                        print(f"Using name from userId: {user_name}")
                    elif email:
                        user_name = email
                        print(f"Using email from userId: {user_name}")
                
                # Wenn kein Name gefunden wurde, überprüfe den Termin
                if not user_name:
                    appointment_ref = db.collection('appointments').document(notification['appointmentId'])
                    appointment_doc = appointment_ref.get()
                    if appointment_doc.exists:
                        appointment_data = appointment_doc.to_dict()
                        
                        # 1. Prüfe, ob der appointment einen sinnvollen customerName hat
                        appointment_customer_name = appointment_data.get('customerName')
                        if appointment_customer_name and appointment_customer_name != 'Unbekannt':
                            user_name = appointment_customer_name
                            print(f"Using customerName from appointment: {user_name}")
                        
                        # 2. Wenn nicht, versuche customerId zu verwenden (könnte anders sein als userId)
                        elif 'customerId' in appointment_data and appointment_data['customerId']:
                            customer_id = appointment_data['customerId']
                            print(f"Looking for customer with ID: {customer_id}")
                            customer_ref = db.collection('users').document(customer_id)
                            customer_doc = customer_ref.get()
                            if customer_doc.exists:
                                customer_data = customer_doc.to_dict()
                                # Wieder Priorität: displayName > name > email
                                display_name = customer_data.get('displayName')
                                name = customer_data.get('name')
                                email = customer_data.get('email')
                                
                                if display_name and display_name != 'Unbekannt':
                                    user_name = display_name
                                    print(f"Using displayName from customerId: {user_name}")
                                elif name and name != 'Unbekannt':
                                    user_name = name
                                    print(f"Using name from customerId: {user_name}")
                                elif email:
                                    user_name = email
                                    print(f"Using email from customerId: {user_name}")
                                            
                # Fallback für Customers Collection
                if not user_name and 'customerId' in notification:
                    try:
                        # Suche nach Kunden in der customers Collection
                        customers_query = db.collection('customers')
                        customers_query = customers_query.where('userId', '==', notification['userId'])
                        customer_docs = customers_query.get()
                        
                        for customer_doc in customer_docs:
                            customer_data = customer_doc.to_dict()
                            if customer_data.get('name') and customer_data.get('name') != 'Unbekannt':
                                user_name = customer_data.get('name')
                                print(f"Using name from customers collection: {user_name}")
                                break
                            elif customer_data.get('email'):
                                user_name = customer_data.get('email')
                                print(f"Using email from customers collection: {user_name}")
                                break
                    except Exception as e:
                        print(f"Error searching in customers collection: {e}")
                
                # Wenn immer noch kein Name gefunden wurde, verwende den Standardwert
                if not user_name:
                    user_name = 'Unbekannter Kunde'
                    print("Using default: Unbekannter Kunde")
            
            # Get shop name
            shop_name = None
            if 'shopId' in notification:
                shop_ref = db.collection('shops').document(notification['shopId'])
                shop_doc = shop_ref.get()
                if shop_doc.exists:
                    shop_data = shop_doc.to_dict()
                    shop_name = shop_data.get('name', 'Unbekannter Shop')
            
            # Get staff name
            staff_name = None
            if 'staffId' in notification:
                staff_ref = db.collection('staff').document(notification['staffId'])
                staff_doc = staff_ref.get()
                if staff_doc.exists:
                    staff_data = staff_doc.to_dict()
                    staff_name = staff_data.get('name', 'Unbekannter Mitarbeiter')
                # If no staff name found in staff collection, try getting it from the appointment
                if not staff_name:
                    appointment_ref = db.collection('appointments').document(notification['appointmentId'])
                    appointment_doc = appointment_ref.get()
                    if appointment_doc.exists:
                        appointment_data = appointment_doc.to_dict()
                        if 'staffName' in appointment_data and appointment_data['staffName']:
                            staff_name = appointment_data['staffName']
            
            # Check if was accepted and when
            accepted_at = None
            if notification.get('isAccepted', False):
                # Try to find when it was accepted by looking at the appointment updates
                appointment_ref = db.collection('appointments').document(notification['appointmentId'])
                appointment_doc = appointment_ref.get()
                if appointment_doc.exists:
                    appointment_data = appointment_doc.to_dict()
                    if 'updatedAt' in appointment_data:
                        accepted_at = convert_timestamp_to_datetime(appointment_data['updatedAt'])
            
            history_item = NotificationHistoryItem(
                id=notification['id'],
                appointmentId=notification['appointmentId'],
                userId=notification['userId'],
                userName=user_name,
                shopId=notification['shopId'],
                shopName=shop_name,
                staffId=notification.get('staffId', ''),
                staffName=staff_name,
                originalStartTime=notification['originalStartTime'],
                earlierStartTime=notification['earlierStartTime'],
                createdAt=notification['createdAt'],
                isAccepted=notification.get('isAccepted', False),
                acceptedAt=accepted_at,
                timeDifference=time_difference,
                appointmentDuration=appointment_duration
            )
            
            history_items.append(history_item)
        
        return history_items
        
    except Exception as e:
        print(f"Error getting notification history: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting notification history: {str(e)}") from e
