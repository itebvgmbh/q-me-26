from fastapi import APIRouter, BackgroundTasks
from typing import Dict, Optional, Any
from datetime import datetime
from pydantic import BaseModel

from app.apis.firebase_utils import get_firestore_db
from app.apis.cache import invalidate_shop_date_cache
from app.apis.appointment_helpers import update_appointment, create_appointment, cancel_appointment

# Create the router
router = APIRouter()

# Define models
class CreateAppointmentRequest(BaseModel):
    shopId: str
    staffId: Optional[str] = None
    serviceId: str
    serviceName: str
    customerId: Optional[str] = None
    customerName: str
    startTime: str  # ISO format date string
    endTime: str    # ISO format date string
    notes: Optional[str] = None
    price: Optional[float] = None
    isAnonymous: Optional[bool] = False
    anonymousReferenceCode: Optional[str] = None

class UpdateAppointmentRequest(BaseModel):
    appointmentId: str
    status: Optional[str] = None
    staffId: Optional[str] = None
    serviceId: Optional[str] = None
    serviceName: Optional[str] = None
    customerId: Optional[str] = None
    customerName: Optional[str] = None
    startTime: Optional[str] = None  # ISO format date string
    endTime: Optional[str] = None    # ISO format date string
    notes: Optional[str] = None
    price: Optional[float] = None

class CancelAppointmentRequest(BaseModel):
    appointmentId: str

@router.post("/create-appointment")
async def create_appointment_endpoint(request: CreateAppointmentRequest, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Create a new appointment with automatic cache invalidation"""
    try:
        from dateutil.parser import parse as parse_date
        from google.cloud import firestore
        
        appointment_data = request.dict()
        
        if 'startTime' in appointment_data and appointment_data['startTime']:
            start_time = parse_date(appointment_data['startTime'])
            appointment_data['startTime'] = firestore.firestore.Timestamp.from_datetime(start_time.replace(tzinfo=None))
            
        if 'endTime' in appointment_data and appointment_data['endTime']:
            end_time = parse_date(appointment_data['endTime'])
            appointment_data['endTime'] = firestore.firestore.Timestamp.from_datetime(end_time.replace(tzinfo=None))
        
        result = await create_appointment(appointment_data, background_tasks)
        
        return result
    except Exception as e:
        print(f"Error creating appointment: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": f"Error creating appointment: {str(e)}"}

@router.post("/update-appointment")
async def update_appointment_endpoint(request: UpdateAppointmentRequest, background_tasks: BackgroundTasks) -> Dict[str, str]:
    """Update an appointment with automatic cache invalidation"""
    try:
        appointment_id = request.appointmentId
        
        update_data = request.dict(exclude={'appointmentId'}, exclude_unset=True)
        
        if 'startTime' in update_data and update_data['startTime']:
            from dateutil.parser import parse as parse_date
            from google.cloud import firestore
            
            start_time = parse_date(update_data['startTime'])
            update_data['startTime'] = firestore.firestore.Timestamp.from_datetime(start_time.replace(tzinfo=None))
            
        if 'endTime' in update_data and update_data['endTime']:
            from dateutil.parser import parse as parse_date
            from google.cloud import firestore
            
            end_time = parse_date(update_data['endTime'])
            update_data['endTime'] = firestore.firestore.Timestamp.from_datetime(end_time.replace(tzinfo=None))
        
        result = await update_appointment(appointment_id, update_data, background_tasks)
        
        return result
    except Exception as e:
        print(f"Error updating appointment: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": f"Error updating appointment: {str(e)}"}

@router.post("/cancel-appointment")
async def cancel_appointment_endpoint(request: CancelAppointmentRequest, background_tasks: BackgroundTasks) -> Dict[str, str]:
    """Cancel an appointment with automatic cache invalidation"""
    try:
        appointment_id = request.appointmentId
        
        result = await cancel_appointment(appointment_id, background_tasks)
        
        return result
    except Exception as e:
        print(f"Error cancelling appointment: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": f"Error cancelling appointment: {str(e)}"}