from datetime import datetime
from fastapi import APIRouter
from firebase_admin import firestore
from app.apis.firebase_utils import get_firestore_db
from app.apis.utils import convert_timestamp_to_datetime

# Define router
router = APIRouter()

@router.post("/cleanup-past-suggestions")
async def cleanup_past_suggestions() -> int:
    """Cleanup past timeslot suggestions that are no longer relevant"""
    return await cleanup_past_timeslot_suggestions()

async def cleanup_past_timeslot_suggestions() -> int:
    """
    Delete all earlier slot suggestions that are in the past.
    This prevents users from seeing outdated suggestions.
    Returns the number of deleted suggestions.
    """
    try:
        db = get_firestore_db()
        now = datetime.now()
        
        # Find all notifications where the suggested earlierStartTime is in the past
        notifications_ref = db.collection('earlier_slot_notifications')
        # We can't filter directly on Firestore timestamp fields with < comparison in queries
        # So we need to get all non-accepted notifications and filter them in code
        query = notifications_ref.where(filter=firestore.FieldFilter("isAccepted", "==", False))
        
        docs_to_delete = []
        for doc in query.stream():
            notification = doc.to_dict()
            earlier_start = convert_timestamp_to_datetime(notification.get('earlierStartTime'))
            
            # If the earlier start time is in the past, mark for deletion
            if earlier_start and earlier_start < now:
                docs_to_delete.append(doc.reference)
                
        # Delete them in batches
        deleted_count = 0
        batch_size = 500  # Firestore allows up to 500 operations per batch
        
        # Process in batches of 500
        for i in range(0, len(docs_to_delete), batch_size):
            batch = db.batch()
            current_batch = docs_to_delete[i:i+batch_size]
            
            for doc_ref in current_batch:
                batch.delete(doc_ref)
                deleted_count += 1
                
            # Commit the batch
            batch.commit()
            
        print(f"Deleted {deleted_count} past timeslot suggestions")
        return deleted_count
    
    except Exception as e:
        print(f"Error cleaning up past timeslot suggestions: {str(e)}")
        return 0
