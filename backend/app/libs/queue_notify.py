"""Wer bekommt jetzt welche Nachricht? Reine Logik ohne Datenbank, getestet in tests/test_queue_notify.py.

Eine Schlange ist alles, was heute bei derselben Person im selben Laden ansteht (wie am Tresen,
components/counter/CounterLane.tsx): wartend = Status "scheduled" mit Ende in der Zukunft, nach Startzeit.

Nachrichten:
- "called": Der Tresen hat die Nummer aufgerufen (Status "in-progress").
- "soon":   Nur noch wenige vor dir oder die Startzeit ist nah – Zeit, sich auf den Weg zu machen.
- "reminder": Erinnerung an einen gebuchten Termin, einige Zeit vorher.
Jede Nachricht geht pro Termin nur einmal raus (Merker notifiedCalledAt / notifiedSoonAt / reminderSentAt).
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

# Bei so vielen (oder weniger) Wartenden vor dir kommt "gleich dran"
SOON_AHEAD = 1
# ... oder wenn die geplante Startzeit so nah ist
SOON_MINUTES = 10
# Nie früher als so lange vor der Startzeit (ein Termin am Nachmittag ist morgens nicht "gleich")
SOON_MAX_MINUTES = 45
# Erinnerung an gebuchte Termine so lange vorher
REMINDER_MINUTES = 120
# Wer kurzfristig bucht, braucht keine Erinnerung
REMINDER_MIN_LEAD_MINUTES = 180


@dataclass(frozen=True)
class Planned:
    appointment_id: str
    kind: str  # "called" | "soon" | "reminder"
    ahead: int = 0  # Wartende vor dir (nur "soon")


def _lane(appt: dict) -> tuple:
    return (appt.get("shopId") or "", appt.get("staffId") or "")


def plan_queue_notifications(appts: list[dict], now: datetime) -> list[Planned]:
    """appts: heutige Termine mit id, shopId, staffId, status, startTime, endTime (aware datetimes)."""
    lanes: dict[tuple, list[dict]] = {}
    for a in appts:
        lanes.setdefault(_lane(a), []).append(a)

    planned: list[Planned] = []
    for items in lanes.values():
        in_progress = [a for a in items if a.get("status") == "in-progress"]
        for a in in_progress:
            if not a.get("notifiedCalledAt"):
                planned.append(Planned(a["id"], "called"))

        waiting = sorted(
            (a for a in items if a.get("status") == "scheduled" and a.get("endTime") and a["endTime"] > now),
            key=lambda a: a["startTime"],
        )
        for index, a in enumerate(waiting):
            if a.get("notifiedSoonAt"):
                continue
            until_start = a["startTime"] - now
            if until_start > timedelta(minutes=SOON_MAX_MINUTES):
                continue
            if index < SOON_AHEAD or until_start <= timedelta(minutes=SOON_MINUTES):
                planned.append(Planned(a["id"], "soon", ahead=index))
    return planned


def needs_reminder(appt: dict, now: datetime) -> bool:
    """Gebuchter Termin, der in den nächsten REMINDER_MINUTES beginnt und lange genug vorher gebucht wurde."""
    if appt.get("type") != "booked" or appt.get("status") != "scheduled" or appt.get("reminderSentAt"):
        return False
    start = appt.get("startTime")
    if not start or not (now < start <= now + timedelta(minutes=REMINDER_MINUTES)):
        return False
    created = appt.get("createdAt")
    if created and start - created < timedelta(minutes=REMINDER_MIN_LEAD_MINUTES):
        return False
    return True


def message_for(kind: str, shop_name: str, ahead: int = 0, start_label: str = "") -> tuple[str, str]:
    """Titel und Text der Nachricht, du-Form wie in der App."""
    shop = shop_name or "Dein Laden"
    if kind == "called":
        return "Du bist dran", f"{shop} ruft dich auf. Komm jetzt rein."
    if kind == "soon":
        if ahead <= 0:
            return "Gleich bist du dran", f"{shop}: Du bist als Nächstes dran. Mach dich auf den Weg."
        return "Gleich bist du dran", f"{shop}: Nur noch {ahead} vor dir. Mach dich auf den Weg."
    if kind == "reminder":
        return "Erinnerung an deinen Termin", f"{shop}, heute um {start_label}. Kannst du nicht? Dann sag bitte ab."
    raise ValueError(kind)
