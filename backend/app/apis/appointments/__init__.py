from fastapi import APIRouter, BackgroundTasks
from typing import Dict, Optional, Any
from datetime import datetime
from pydantic import BaseModel

from app.apis.firebase_utils import get_firestore_db
from app.apis.cache import invalidate_shop_date_cache
from app.apis.appointment_helpers import update_appointment, create_appointment, cancel_appointment

# Create the router
from fastapi import Depends
from app.auth.access import require_admin

# Die App schreibt Termine selbst über Firestore; diese Endpunkte prüfen keinen Besitz und sind nur für den Betreiber.

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

@router.post("/create-appointment", dependencies=[Depends(require_admin)])
async def create_appointment_endpoint(request: CreateAppointmentRequest, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Create a new appointment with automatic cache invalidation"""
    try:
        from dateutil.parser import parse as parse_date

        appointment_data = request.dict()

        # Als datetime speichern; der Speicher legt es als Zeitpunkt ab (früher ein Aufruf, den es nicht gibt)
        if 'startTime' in appointment_data and appointment_data['startTime']:
            appointment_data['startTime'] = parse_date(appointment_data['startTime'])

        if 'endTime' in appointment_data and appointment_data['endTime']:
            appointment_data['endTime'] = parse_date(appointment_data['endTime'])
        
        result = await create_appointment(appointment_data, background_tasks)
        
        return result
    except Exception as e:
        print(f"Error creating appointment: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": f"Error creating appointment: {str(e)}"}

@router.post("/update-appointment", dependencies=[Depends(require_admin)])
async def update_appointment_endpoint(request: UpdateAppointmentRequest, background_tasks: BackgroundTasks) -> Dict[str, str]:
    """Update an appointment with automatic cache invalidation"""
    try:
        appointment_id = request.appointmentId
        
        update_data = request.dict(exclude={'appointmentId'}, exclude_unset=True)
        
        from dateutil.parser import parse as parse_date

        # Als datetime speichern; der Speicher legt es als Zeitpunkt ab (früher ein Aufruf, den es nicht gibt)
        if 'startTime' in update_data and update_data['startTime']:
            update_data['startTime'] = parse_date(update_data['startTime'])

        if 'endTime' in update_data and update_data['endTime']:
            update_data['endTime'] = parse_date(update_data['endTime'])
        
        result = await update_appointment(appointment_id, update_data, background_tasks)
        
        return result
    except Exception as e:
        print(f"Error updating appointment: {e}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": f"Error updating appointment: {str(e)}"}

@router.post("/cancel-appointment", dependencies=[Depends(require_admin)])
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