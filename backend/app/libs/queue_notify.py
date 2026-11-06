"""Wer bekommt jetzt welche Nachricht? Reine Logik ohne Datenbank, getestet in tests/test_queue_notify.py.

Eine Schlange ist alles, was heute bei derselben Person im selben Laden ansteht – dieselbe Regel wie am Tresen
(frontend/src/utils/queue-lane.ts, Änderungen an beiden Stellen):
- wartend = Status "scheduled", bis aufgerufen oder abgesagt – auch wenn die geplante Zeit vorbei ist,
- Reihenfolge nach geplanter Startzeit,
- Prognose: Wer dran ist, ist nach seiner geplanten Dauer ab Aufruf fertig, frühestens jetzt; die Wartenden
  folgen nacheinander, jeder frühestens zu seiner geplanten Zeit. Gerechnet wird nur, wenn bei der Person heute
  schon aufgerufen wurde, sonst gelten die geplanten Zeiten.
Vorher fiel ein Wartender aus der Schlange, sobald seine geplante Zeit vorbei war – hing der Laden hinterher,
kam "Gleich bist du dran" nicht mehr.

Nachrichten:
- "called": Der Tresen hat die Nummer aufgerufen (Status "in-progress").
- "soon":   Nur noch wenige vor dir oder die voraussichtliche Startzeit ist nah – Zeit, sich auf den Weg zu machen.
- "reminder": Erinnerung an einen gebuchten Termin, einige Zeit vorher.
- "cancelled" / "moved": Der Laden hat abgesagt oder verschoben (Merker customerNotice am Termin).
- "offer":  "Früher dran" – ein früherer Platz ist frei (app/apis/check_slots).
Texte in der Sprache des Kunden (Feld language am Termin bzw. an der Push-Anmeldung, Übersetzungen in app/i18n).
Jede Nachricht geht pro Termin nur einmal raus (Merker notifiedCalledAt / notifiedSoonAt / reminderSentAt,
customerNotice wird nach dem Senden geleert). Wer zurück auf "Wartet" gesetzt wird, verliert notifiedCalledAt –
beim nächsten Aufruf kommt "Du bist dran" noch einmal.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from app.i18n import t, wochentag

# Bei so vielen (oder weniger) Wartenden vor dir kommt "gleich dran"
SOON_AHEAD = 1
# ... oder wenn die voraussichtliche Startzeit so nah ist
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


def _duration(a: dict) -> timedelta:
    start, end = a.get("startTime"), a.get("endTime")
    return end - start if start and end and end > start else timedelta(0)


def _called_time(a: dict):
    return a.get("lastCalledAt") or a.get("calledAt") or a.get("startTime")


def waiting_in_order(items: list[dict]) -> list[dict]:
    return sorted((a for a in items if a.get("status") == "scheduled" and a.get("startTime")), key=lambda a: (a["startTime"], a.get("id", "")))


def project_lane(items: list[dict], now: datetime) -> dict[str, tuple[datetime, datetime]]:
    """Voraussichtlicher Beginn und Ende je Kunde, der dran ist oder wartet (wie projectLane im Frontend)."""
    running = any(a.get("status") in ("in-progress", "completed") for a in items)
    result: dict[str, tuple[datetime, datetime]] = {}
    cursor = None
    for a in items:
        if a.get("status") != "in-progress" or not a.get("startTime"):
            continue
        begin = _called_time(a)
        end = max(begin + _duration(a), now)
        result[a["id"]] = (begin, end)
        cursor = end if cursor is None else max(cursor, end)
    for a in waiting_in_order(items):
        start = a["startTime"]
        if running:
            start = max([start, now] + ([cursor] if cursor else []))
        end = start + _duration(a)
        result[a["id"]] = (start, end)
        cursor = end if cursor is None else max(cursor, end)
    return result


def plan_queue_notifications(appts: list[dict], now: datetime) -> list[Planned]:
    """appts: heutige Termine mit id, shopId, staffId, status, startTime, endTime (aware datetimes)."""
    lanes: dict[tuple, list[dict]] = {}
    for a in appts:
        lanes.setdefault(_lane(a), []).append(a)

    planned: list[Planned] = []
    for items in lanes.values():
        for a in items:
            if a.get("status") == "in-progress" and not a.get("notifiedCalledAt"):
                planned.append(Planned(a["id"], "called"))

        projection = project_lane(items, now)
        for index, a in enumerate(waiting_in_order(items)):
            if a.get("notifiedSoonAt"):
                continue
            until_start = projection[a["id"]][0] - now
            if until_start > timedelta(minutes=SOON_MAX_MINUTES):
                continue
            if index < SOON_AHEAD or until_start <= timedelta(minutes=SOON_MINUTES):
                planned.append(Planned(a["id"], "soon", ahead=index))
    return planned


def recalled_to_reset(appts: list[dict]) -> list[str]:
    """Zurück auf "Wartet" gesetzt, aber "Du bist dran" noch gemerkt: Merker weg, damit der nächste Aufruf meldet.
    Das Frontend löscht ihn schon beim Zurücksetzen; das hier fängt andere Wege ab."""
    return [a["id"] for a in appts if a.get("status") == "scheduled" and a.get("notifiedCalledAt")]


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


def notice_kind(appt: dict, now: datetime, today_start: datetime) -> str | None:
    """Offene Nachricht "cancelled"/"moved", wenn sie noch Sinn hat (nicht für vergangene Tage, nicht für eine
    Verschiebung, die wieder auf die alte Zeit zurückging)."""
    kind = appt.get("customerNotice")
    if kind not in ("cancelled", "moved"):
        return None
    start = appt.get("startTime")
    if not start or start < today_start:
        return None
    if kind == "moved":
        if appt.get("status") != "scheduled":
            return None
        previous = appt.get("customerNoticePreviousStart")
        if previous and previous == start:
            return None
    return kind


def day_label(start: datetime, now: datetime, sprache: str = "de") -> str:
    days = (start.date() - now.date()).days
    if days == 0:
        return t("heute", sprache)
    if days == 1:
        return t("morgen", sprache)
    return t("am {wochentag} {tag}.{monat}.", sprache, wochentag=wochentag(start, sprache), tag=start.day, monat=start.month)


def _gross(text: str) -> str:
    return text[:1].upper() + text[1:]


def message_for(kind: str, shop_name: str, ahead: int = 0, start_label: str = "", sprache: str = "de", **extra) -> tuple[str, str]:
    """Titel und Text der Nachricht, du-Form wie in der App, in der Sprache des Kunden (app/i18n).
    Für "cancelled", "moved" und "offer" kommen start (und previous / original) als Ortszeit (Europe/Berlin) und now."""
    shop = shop_name or t("Dein Laden", sprache)
    if kind == "called":
        return t("Du bist dran", sprache), t("{laden} ruft dich auf. Komm jetzt rein.", sprache, laden=shop)
    if kind == "soon":
        if ahead <= 0:
            return t("Gleich bist du dran", sprache), t("{laden}: Du bist als Nächstes dran. Mach dich auf den Weg.", sprache, laden=shop)
        return t("Gleich bist du dran", sprache), t("{laden}: Nur noch {n} vor dir. Mach dich auf den Weg.", sprache, laden=shop, n=ahead)
    if kind == "reminder":
        return t("Erinnerung an deinen Termin", sprache), t(
            "{laden}, heute um {zeit}. Kannst du nicht? Dann sag bitte ab.", sprache, laden=shop, zeit=start_label
        )
    now = extra.get("now")
    if kind == "cancelled":
        start = extra["start"]
        wann = {"laden": shop, "wann": day_label(start, now, sprache), "zeit": f"{start:%H:%M}"}
        if extra.get("queue"):
            return t("Abgesagt", sprache), t("{laden} hat deine Nummer {wann} um {zeit} abgesagt.", sprache, **wann)
        return t("Abgesagt", sprache), t("{laden} hat deinen Termin {wann} um {zeit} abgesagt.", sprache, **wann)
    if kind == "moved":
        start, previous = extra["start"], extra.get("previous")
        parts = [t("{laden} hat deinen Termin verschoben: jetzt {wann} um {zeit}", sprache, laden=shop, wann=day_label(start, now, sprache), zeit=f"{start:%H:%M}")]
        if extra.get("staff"):
            parts.append(t("bei {name}", sprache, name=extra["staff"]))
        if previous and previous.date() == start.date():
            parts.append(t("(vorher {zeit})", sprache, zeit=f"{previous:%H:%M}"))
        elif previous:
            parts.append(t("(vorher {wann} um {zeit})", sprache, wann=day_label(previous, now, sprache), zeit=f"{previous:%H:%M}"))
        return t("Neue Uhrzeit", sprache), " ".join(parts) + "."
    if kind == "offer":
        start, original = extra["start"], extra.get("original")
        free = t("{laden}: {wann} um {zeit} ist ein Platz frei", sprache, laden=shop, wann=_gross(day_label(start, now, sprache)), zeit=f"{start:%H:%M}")
        if original and original.date() == start.date():
            free += " " + t("(statt {zeit})", sprache, zeit=f"{original:%H:%M}")
        hold = extra.get("hold_until")
        if hold:
            until = t("Bis {zeit} nur für dich – unter „Meine Termine“ annehmen.", sprache, zeit=f"{hold:%H:%M}")
        else:
            until = t("Nur kurz für dich reserviert – unter „Meine Termine“ annehmen.", sprache)
        return t("Früher dran?", sprache), f"{free}. {until}"
    raise ValueError(kind)
