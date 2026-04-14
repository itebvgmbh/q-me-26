import datetime
import sys
sys.path.append('.')
from app.apis.calculators import calculate_available_timeslots
from google.api_core.datetime_helpers import DatetimeWithNanoseconds

day_start = datetime.datetime(2026, 4, 17, 9, 0)
day_end = datetime.datetime(2026, 4, 17, 17, 0)

appt_start = DatetimeWithNanoseconds(2026, 4, 17, 10, 10, tzinfo=datetime.timezone.utc)
appt_end = DatetimeWithNanoseconds(2026, 4, 17, 10, 20, tzinfo=datetime.timezone.utc)

appointments = [{'startTime': appt_start, 'endTime': appt_end}]
breaks = {}
slots = calculate_available_timeslots(day_start, day_end, appointments, breaks, 10, 0, 10)

print("Generated", len(slots), "slots")
for s in slots:
    if s.start_time.hour == 12:
        print("SLOT:", s.start_time.strftime("%H:%M"), "-", s.end_time.strftime("%H:%M"))
