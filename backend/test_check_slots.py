import os
import sys
import dotenv

# Databutton / firebase setup requires .env
dotenv.load_dotenv()

# Add backend directory to sys.path so 'app.' imports work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.apis.firebase_utils import get_firestore_db
from app.apis.utils import convert_timestamp_to_datetime
from datetime import datetime, timedelta

def test_query():
    print("Connecting to DB...")
    db = get_firestore_db()
    
    appointments_query = db.collection('appointments')
    appointments_query = appointments_query.where('checkEarlierOptions', '==', True)
    appointments_query = appointments_query.where('status', '==', 'scheduled')
    
    appointments = []
    for doc in appointments_query.stream():
        appt = doc.to_dict()
        appt['id'] = doc.id
        appointments.append(appt)

    print(f"\nFound {len(appointments)} appointments with checkEarlierOptions=True")
    
    for appt in appointments:
        start_time = convert_timestamp_to_datetime(appt.get('startTime'))
        print(f"\n--- Appointment {appt['id']} ---")
        print(f"startTime: {appt.get('startTime')}")
        print(f"parsed start_time (local): {start_time}")
        now = datetime.now()
        
        if start_time < now + timedelta(hours=2):
             print(f"SKIP 1: Too close. start_time {start_time} - now+2h {now + timedelta(hours=2)}")
        else:
             print("ELIGIBLE FOR EARLIER SLOT CHECK")
             
        existing = list(db.collection('earlier_slot_notifications').where('appointmentId', '==', appt['id']).stream())
        if len(existing) > 0:
             print(f"EXISTING NOTIFICATIONS: {len(existing)}")
             for e in existing:
                 print(f"  - {e.id} (isAccepted: {e.to_dict().get('isAccepted')})")

if __name__ == "__main__":
    test_query()
