import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
import json

load_dotenv()

service_account_str = os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY")
if not service_account_str:
    print("No service account key found")
    exit(1)

cert = json.loads(service_account_str)

try:
    firebase_admin.get_app()
except ValueError:
    cred = credentials.Certificate(cert)
    firebase_admin.initialize_app(cred)

db = firestore.client()
users = db.collection('users').stream()

count = 0
for u in users:
    print(f"[{u.id}] => {u.to_dict()}")
    count += 1

print(f"Total users found: {count}")
