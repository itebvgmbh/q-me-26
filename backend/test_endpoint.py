import datetime
import asyncio
import sys
import os
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from app.apis.available_timeslots import get_available_timeslots
from app.apis.models import AvailableTimeslotsRequest

async def run():
    req = AvailableTimeslotsRequest(
        shop_id="zNS505OFvKZpFaR1vTdN",    
        service_id="Yex84m4WeGzs4ONMshBF", 
        staff_id="KLjdJpaxnweaAgjidh5m",
        date=datetime.datetime(2026, 4, 17, 0, 0),
        force_refresh=True
    )
    # The endpoint will use the initialized db based on FIREBASE config inside .env
    from fastapi import BackgroundTasks; bg = BackgroundTasks(); res = get_available_timeslots(req, bg)
    for slot in res.timeslots:
        if slot.start_time.hour == 12:
            print("SLOT", slot.start_time, "is_available:", slot.is_available)

asyncio.run(run())
