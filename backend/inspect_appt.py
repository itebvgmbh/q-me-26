import os
import sys
import dotenv

dotenv.load_dotenv()
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.apis.firebase_utils import get_firestore_db

def inspect_appointment():
    db = get_firestore_db()
    
    # Get any recent accepted notification
    notifs = list(db.collection('earlier_slot_notifications').where('isAccepted', '==', True).limit(5).stream())
    
    if not notifs:
        print("No accepted notifications found.")
        return
        
    for doc in notifs:
        n = doc.to_dict()
        print(f"\n--- Notification {doc.id} ---")
        print(f"Appointment ID: {n.get('appointmentId')}")
        print(f"Earlier Start: {n.get('earlierStartTime')} (type: {type(n.get('earlierStartTime'))})")
        
        appt_ref = db.collection('appointments').document(n.get('appointmentId'))
        appt = appt_ref.get()
        if not appt.exists:
            print("  [ERROR] APPOINTMENT DELETED / MISSING!")
            continue
            
        a = appt.to_dict()
        print("  Current Appointment Data:")
        print(f"    startTime: {a.get('startTime')} (type: {type(a.get('startTime'))})")
        print(f"    endTime:   {a.get('endTime')} (type: {type(a.get('endTime'))})")
        print(f"    status:    {a.get('status')}")
        print(f"    staffId:   {a.get('staffId')} (type: {type(a.get('staffId'))})")
        print(f"    shopId:    {a.get('shopId')}")

if __name__ == "__main__":
    inspect_appointment()
