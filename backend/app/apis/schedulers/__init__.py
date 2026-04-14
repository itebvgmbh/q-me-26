from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from datetime import datetime, timedelta
import threading
import time
from typing import Dict, List, Optional

from app.apis.check_slots import check_earlier_slots_v2
from app.apis.appointment_helpers import update_appointment

router = APIRouter()

from app.apis.cleanup import cleanup_past_timeslot_suggestions
scheduler_thread = None
scheduler_running = False
last_run_time = None
run_interval = 3600  # Default: Check once per hour

# Define models (if needed)

def scheduler_task():
    """Background task that runs on a schedule to check for earlier slots"""
    global scheduler_running, last_run_time, run_interval
    
    background_tasks = BackgroundTasks()
    print(f"Starting scheduler task at {datetime.now()}")
    
    while scheduler_running:
        try:
            # Perform the check
            print(f"Running earlier slots check at {datetime.now()}")
            
            # Run check_earlier_slots synchronously since we're in a background thread
            # We need to use an event loop to run the async function
            import asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            check_result = loop.run_until_complete(check_earlier_slots_v2(background_tasks))
            loop.close()
            
            print(f"Earlier slots check completed: {check_result}")
            last_run_time = datetime.now()
            
            # Wait for the next interval
            time.sleep(run_interval)
        except Exception as e:
            print(f"Error in scheduler task: {e}")
            time.sleep(60)  # Wait a minute before trying again

@router.post("/start-scheduler")
async def start_scheduler() -> Dict[str, str]:
    """Start the scheduler to periodically check for earlier slots"""
    global scheduler_thread, scheduler_running, last_run_time, run_interval
    
    if scheduler_running:
        return {"status": "already_running", "message": "Scheduler is already running"}
    
    scheduler_running = True
    scheduler_thread = threading.Thread(target=scheduler_task)
    scheduler_thread.daemon = True  # Allow the thread to exit when the main process exits
    scheduler_thread.start()
    
    return {"status": "started", "message": "Scheduler started successfully"}

@router.post("/stop-scheduler")
async def stop_scheduler() -> Dict[str, str]:
    """Stop the scheduler"""
    global scheduler_running
    
    if not scheduler_running:
        return {"status": "not_running", "message": "Scheduler is not running"}
    
    scheduler_running = False
    return {"status": "stopped", "message": "Scheduler stopped successfully"}

@router.get("/scheduler-status")
async def get_scheduler_status() -> Dict[str, object]:
    """Get the current status of the scheduler"""
    global scheduler_running, last_run_time, run_interval
    
    return {
        "is_running": scheduler_running,
        "last_run": last_run_time.isoformat() if last_run_time else None,
        "interval_seconds": run_interval,
        "next_run": (last_run_time + timedelta(seconds=run_interval)).isoformat() if last_run_time else None
    }

@router.post("/set-interval")
async def set_interval(interval_seconds: int) -> Dict[str, object]:
    """Set the interval for running the scheduler task"""
    global run_interval
    
    if interval_seconds < 60:
        raise HTTPException(status_code=400, detail="Interval must be at least 60 seconds")
    
    run_interval = interval_seconds
    return {"status": "success", "message": f"Interval set to {interval_seconds} seconds"}

@router.post("/run-now")
async def run_now() -> Dict[str, object]:
    """Run the earlier slots check immediately"""
    global last_run_time
    
    try:
        background_tasks = BackgroundTasks()
        check_result = await check_earlier_slots_v2(background_tasks)
        last_run_time = datetime.now()
        
        return {
            "status": "success", 
            "message": "Earlier slots check completed",
            "result": check_result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error running earlier slots check: {str(e)}")