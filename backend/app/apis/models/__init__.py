from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter

# Leerer Router, damit das Modul als API-Modul erkannt wird
router = APIRouter()

class TimeSlot(BaseModel):
    start_time: datetime
    end_time: datetime
    is_available: bool

class AvailableTimeslotsRequest(BaseModel):
    shop_id: str
    staff_id: Optional[str] = None
    service_id: str
    date: datetime
    force_refresh: Optional[bool] = False

class AvailableTimeslotsResponse(BaseModel):
    timeslots: List[TimeSlot]

class EarlierSlotNotification(BaseModel):
    id: str
    appointmentId: str
    userId: str
    shopId: str
    staffId: str
    serviceId: str
    originalStartTime: datetime
    originalEndTime: datetime
    earlierStartTime: datetime
    earlierEndTime: datetime
    createdAt: datetime
    isRead: bool = False
    isAccepted: bool = False

class CheckEarlierSlotsResponse(BaseModel):
    notifications_created: int
    appointments_checked: int
    appointments_with_earlier_slots: int