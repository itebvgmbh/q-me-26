import os
import sys
import dotenv

dotenv.load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.apis.firebase_utils import get_firestore_db

def inspect_latest():
    db = get_firestore_db()
    notifs = list(db.collection('earlier_slot_notifications').where('isAccepted', '==', True).order_by('acceptedAt', direction='DESCENDING').limit(1).stream())
    
    if not notifs:
        print("No accepted notifs found")
        return
        
    for doc in notifs:
        n = doc.to_dict()
        print(f"Notification: {doc.id}")
        appt_id = n.get('appointmentId')
        print(f"Appt ID: {appt_id}")
        
        appt_ref = db.collection('appointments').document(appt_id)
        appt_doc = appt_ref.get()
        if not appt_doc.exists:
            print("APPOINTMENT DELETED")
            continue
            
        data = appt_doc.to_dict()
        print(f"startTime value: {repr(data.get('startTime'))}")
        print(f"startTime type: {type(data.get('startTime'))}")
        print(f"endTime value: {repr(data.get('endTime'))}")
        print(f"endTime type: {type(data.get('endTime'))}")
        print(f"status: {data.get('status')}")
        print(f"staffId: {repr(data.get('staffId'))}")

if __name__ == "__main__":
    inspect_latest()
