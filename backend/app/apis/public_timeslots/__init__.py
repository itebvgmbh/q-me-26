from fastapi import APIRouter
from app.apis.models import AvailableTimeslotsRequest, AvailableTimeslotsResponse
from app.apis.available_timeslots import get_available_timeslots as original_get_available_timeslots
from fastapi import BackgroundTasks

# Keine Authentifizierung erforderlich für diese Route
router = APIRouter(prefix="/public", tags=["open"])

@router.post("/available-timeslots")
def get_public_available_timeslots(request: AvailableTimeslotsRequest, background_tasks: BackgroundTasks) -> AvailableTimeslotsResponse:
    """
    Public version of the available-timeslots endpoint that does not require authentication.
    """
    # Delegiere an die ursprüngliche Implementierung, mit BackgroundTasks
    return original_get_available_timeslots(request, background_tasks)
