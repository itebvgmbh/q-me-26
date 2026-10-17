from fastapi import APIRouter, HTTPException
from typing import Dict, List
from pydantic import BaseModel
from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import is_admin

router = APIRouter()


def _appointment_owner(db, appointment_id: str):
    """Kunden-ID des Termins (customerId, sonst userId) oder None"""
    doc = db.collection('appointments').document(appointment_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    return data.get('customerId') or data.get('userId')

class UpdateUserIdRequest(BaseModel):
    appointment_id: str
    new_user_id: str

class UpdateResult(BaseModel):
    updated_notifications: int
    message: str

@router.post("/update-notification-user")
async def update_notification_user_id(request: UpdateUserIdRequest, user: AuthorizedUser) -> UpdateResult:
    """
    Updates the userId in existing notifications for a specific appointment.
    Used to fix notifications with unknown_user IDs.
    Nur für den eigenen Termin und nur auf das eigene Konto (Betreiber: beliebig).
    """
    db = get_firestore_db()
    if not is_admin(user):
        if request.new_user_id != user.sub or _appointment_owner(db, request.appointment_id) != user.sub:
            raise HTTPException(status_code=403, detail="Das ist nicht dein Termin.")
    try:
        
        # Find notifications for this appointment
        notifications_query = db.collection('earlier_slot_notifications')
        notifications_query = notifications_query.where('appointmentId', '==', request.appointment_id)
        notifications_query = notifications_query.where('userId', '==', 'unknown_user')
        
        notification_docs = list(notifications_query.stream())
        updated_count = 0
        
        if not notification_docs:
            return UpdateResult(
                updated_notifications=0,
                message=f"No notifications found for appointment {request.appointment_id} with 'unknown_user' ID"
            )
        
        # Update each notification with the new user ID
        for doc in notification_docs:
            doc.reference.update({
                'userId': request.new_user_id
            })
            updated_count += 1
        
        return UpdateResult(
            updated_notifications=updated_count,
            message=f"Successfully updated {updated_count} notifications for appointment {request.appointment_id}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error updating notification user ID: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error updating notification user ID: {str(e)}") from e

@router.get("/unknown-notifications")
async def get_unknown_user_notifications(user: AuthorizedUser) -> List[Dict]:
    """
    Returns a list of notifications that have 'unknown_user' as userId.
    Used for debugging and fixing issues with user IDs.
    Nur die zu eigenen Terminen (Betreiber: alle) – vorher bekam jedes Konto alle.
    """
    try:
        db = get_firestore_db()
        
        # Find notifications with unknown_user ID
        notifications_query = db.collection('earlier_slot_notifications')
        notifications_query = notifications_query.where('userId', '==', 'unknown_user')
        
        notifications = []
        admin = is_admin(user)
        owners: Dict[str, object] = {}
        for doc in notifications_query.stream():
            notification = doc.to_dict()
            notification['id'] = doc.id
            appointment_id = notification.get('appointmentId')
            if not admin:
                if not appointment_id:
                    continue
                if appointment_id not in owners:
                    owners[appointment_id] = _appointment_owner(db, appointment_id)
                if owners[appointment_id] != user.sub:
                    continue
            notifications.append(notification)
        
        return notifications
        
    except Exception as e:
        print(f"Error getting unknown user notifications: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting unknown user notifications: {str(e)}") from e
