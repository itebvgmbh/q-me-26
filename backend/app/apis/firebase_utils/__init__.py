import firebase_admin
from firebase_admin import credentials, firestore
import databutton as db
import json
import traceback
from typing import Optional
from fastapi import APIRouter

# Create router for FastAPI to detect
router = APIRouter()

# Cache for the Firebase app instance
_firebase_app = None
_firestore_client = None
_initialization_completed = False

def get_firebase_app() -> firebase_admin.App:
    """
    Get or initialize the Firebase app instance.
    Uses a singleton pattern to avoid multiple initializations.
    """
    global _firebase_app, _initialization_completed
    
    # Fast path: return cached app if available
    if _firebase_app is not None:
        return _firebase_app
        
    # Check if initialization was completed before
    if _initialization_completed:
        try:
            _firebase_app = firebase_admin.get_app()
            print("Retrieved existing Firebase app")
            return _firebase_app
        except ValueError:
            print("Warning: _initialization_completed is True but no app exists")
            # Fall through to initialization
    
    # Attempt to get existing app first
    try:
        # Try to get the default app if it already exists
        _firebase_app = firebase_admin.get_app()
        print("Retrieved existing Firebase app")
        _initialization_completed = True
        return _firebase_app
    except ValueError:
        # App doesn't exist, we'll initialize it
        print("No existing Firebase app found, initializing new app")
    
    # We need thread safety here
    import threading
    init_lock = threading.Lock()
    
    with init_lock:
        # Double-check inside lock
        try:
            _firebase_app = firebase_admin.get_app()
            print("Another thread initialized Firebase app")
            _initialization_completed = True
            return _firebase_app
        except ValueError:
            # Still need to initialize
            pass
            
        try:
            # Get service account key from secrets
            service_account_key_json = db.secrets.get("FIREBASE_SERVICE_ACCOUNT_KEY")
            
            if not service_account_key_json:
                raise ValueError("Firebase service account key not found in secrets")
            
            # Parse the service account key JSON
            service_account_info = json.loads(service_account_key_json)
            
            # Initialize the app with the service account key
            cred = credentials.Certificate(service_account_info)
            _firebase_app = firebase_admin.initialize_app(cred)
            _initialization_completed = True
            print("Successfully initialized new Firebase app")
        except Exception as e:
            # Handle the case where another thread initialized the app
            # between our check and our initialization
            if "The default Firebase app already exists" in str(e):
                print("Firebase app was initialized by another process/thread")
                _firebase_app = firebase_admin.get_app()
                _initialization_completed = True
            else:
                print(f"Error initializing Firebase app: {str(e)}")
                traceback.print_exc()
                raise
    
    return _firebase_app

def get_firestore_db() -> firestore.Client:
    """
    Get the Firestore database client.
    Initializes the Firebase app if necessary.
    Uses a cached client to avoid creating multiple clients.
    """
    global _firestore_client
    
    # Fast path: return cached client if available
    if _firestore_client is not None:
        return _firestore_client
    
    try:
        app = get_firebase_app()
        _firestore_client = firestore.client(app)
        return _firestore_client
    except Exception as e:
        print(f"Error getting Firestore client: {str(e)}")
        traceback.print_exc()
        raise
