"""Nachrichten an das Team: Ein Kunde zieht selbst eine Nummer, bucht online oder am Telefon oder sagt ab.
Reine Logik ohne Datenbank, getestet in tests/test_queue_notify.py.

Stefans Entscheidungen (28.10.2026):
- Wer: die gebuchte Person (staffId am Termin, auch bei „Egal wer“) und der Inhaber (alles aus seinem Laden).
- Was: neue Nummer, neue Buchung (online oder über den Telefon-Assistenten), Absage oder zurückgegebene Nummer.
  Nicht, was der Laden selbst am Tresen anlegt oder absagt.
- Jedes Gerät wählt in „Mein Tag“, welche Ereignisse (events), oder schaltet ganz ab (frontend/src/utils/team-push.ts).
- Zwischen 21 und 8 Uhr kommt nichts; was nachts passiert ist, kommt morgens als eine Nachricht.

Ablauf: Was der Kunde tut, merkt das Backend am Termin vor (teamNotice "new" / "cancelled", notice_fields) – über
/push/team-event aus der App, /nummer/absagen und den Telefon-Assistenten. Der Benachrichtigungsdienst
(app/libs/notify_worker.py) schickt es an die Geräte in team_push_subscriptions (angemeldet über app/apis/team_push)
und leert den Merker. Hat ein Gerät in einem Durchlauf mehrere Ereignisse – morgens nach der Nachtruhe oder bei einem
Ansturm –, bekommt es eine Sammelnachricht. Kundennamen stehen nie darin: Die Nachricht ist auf dem Sperrbildschirm
zu sehen, und Push an die App geht über Google und Apple.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.i18n import t, tn
from app.libs.queue_notify import day_label

BERLIN = ZoneInfo("Europe/Berlin")
COLLECTION = "team_push_subscriptions"
EVENTS = ("nummer", "buchung", "absage")
# Nachtruhe nach Ortszeit: ab QUIET_FROM Uhr bis QUIET_UNTIL Uhr
QUIET_FROM = 21
QUIET_UNTIL = 8


def quiet(now: datetime) -> bool:
    hour = now.astimezone(BERLIN).hour
    return hour >= QUIET_FROM or hour < QUIET_UNTIL


def notice_fields(appt: dict, kind: str, now: datetime) -> dict | None:
    """Felder für den Termin, wenn der Kunde selbst bucht ("new") oder absagt ("cancelled") – None, wenn es dafür
    schon einen Merker gab (jedes Ereignis nur einmal je Termin)."""
    if kind == "new":
        if appt.get("teamNewAt"):
            return None
        return {"teamNotice": "new", "teamNoticeAt": now, "teamNewAt": now}
    if kind == "cancelled":
        if appt.get("teamCancelledAt"):
            return None
        if appt.get("teamNotice") == "new":
            # Noch niemandem gemeldet (Nachtruhe): Dann gibt es auch nichts abzusagen
            return {"teamNotice": None, "teamNoticeAt": None, "teamCancelledAt": now}
        return {"teamNotice": "cancelled", "teamNoticeAt": now, "teamCancelledAt": now}
    raise ValueError(kind)


def event_of(appt: dict, today_start: datetime) -> str | None:
    """Was der offene Merker meldet ("nummer", "buchung", "absage") – None, wenn es nichts mehr zu melden gibt, etwa weil
    der Laden die neue Buchung inzwischen selbst abgesagt hat oder der Tag vorbei ist."""
    start = appt.get("startTime")
    if not start or start < today_start:
        return None
    notice, status = appt.get("teamNotice"), appt.get("status")
    if notice == "new" and status in ("scheduled", "in-progress"):
        return "nummer" if appt.get("type") == "queue" else "buchung"
    if notice == "cancelled" and status == "cancelled":
        return "absage"
    return None


def wants(sub: dict, appt: dict, event: str, owner_uid: str | None, staff_uids: dict) -> bool:
    """Bekommt dieses Gerät die Nachricht? Der Inhaber alles aus seinem Laden, sonst nur die gebuchte Person, solange sie
    noch im Team ist (staff_uids: aktive Personen des Ladens → Konto) – und nur, wenn das Ereignis nicht abgewählt ist."""
    if sub.get("shopId") != appt.get("shopId") or (sub.get("events") or {}).get(event, True) is False:
        return False
    uid = sub.get("uid")
    if owner_uid and uid == owner_uid:
        return True
    staff_id = sub.get("staffId")
    return bool(staff_id) and staff_id == appt.get("staffId") and staff_uids.get(staff_id) == uid


def plan_team_messages(pending: list[dict], subs: list[dict], owner_uid: str | None, staff_uids: dict, today_start: datetime) -> list:
    """Je Gerät (sub) die Termine mit Ereignis, die es melden soll, in der Reihenfolge der Merker:
    [(sub, [(appt, event), …]), …]. Gemeinsam für einen Laden."""
    planned: dict[str, tuple[dict, list]] = {}
    for appt in sorted(pending, key=lambda a: (a.get("teamNoticeAt") is None, a.get("teamNoticeAt") or 0)):
        event = event_of(appt, today_start)
        if not event:
            continue
        for sub in subs:
            if wants(sub, appt, event, owner_uid, staff_uids):
                planned.setdefault(sub["doc_id"], (sub, []))[1].append((appt, event))
    return list(planned.values())


def team_message(appt: dict, event: str, sprache: str, now: datetime, service: str = "", staff: str = "") -> tuple[str, str]:
    """Titel und Text für ein Ereignis. staff: Name der gebuchten Person, nur für den Inhaber (sonst ist es man selbst)."""
    start = appt["startTime"].astimezone(BERLIN)
    queue = appt.get("type") == "queue"
    code = appt.get("referenceCode") or ""
    wann = {"wann": day_label(start, now.astimezone(BERLIN), sprache), "zeit": f"{start:%H:%M}"}
    if event == "nummer":
        title = t("Neue Nummer {nummer}", sprache, nummer=code) if code else t("Neue Nummer", sprache)
    elif event == "buchung":
        title = t("Neue Buchung", sprache)
    elif queue:
        title = t("Nummer {nummer} zurückgegeben", sprache, nummer=code) if code else t("Nummer zurückgegeben", sprache)
    else:
        title = t("Termin abgesagt", sprache)
    when = t("{wann} gegen {zeit}", sprache, **wann) if queue else t("{wann} um {zeit}", sprache, **wann)
    body = f"{service}, {when}" if service else when[:1].upper() + when[1:]
    if staff:
        body += " " + t("bei {name}", sprache, name=staff)
    if appt.get("source") == "telefon":
        body += " " + t("(per Telefon)", sprache)
    return title, body


def digest_message(events: list[str], sprache: str, shop_name: str) -> tuple[str, str]:
    """Sammelnachricht: mehrere Ereignisse auf einmal, etwa morgens nach der Nachtruhe"""
    counts = {event: events.count(event) for event in EVENTS}
    parts = []
    if counts["nummer"]:
        parts.append(tn(counts["nummer"], "{n} neue Nummer", "{n} neue Nummern", sprache))
    if counts["buchung"]:
        parts.append(tn(counts["buchung"], "{n} neue Buchung", "{n} neue Buchungen", sprache))
    if counts["absage"]:
        parts.append(tn(counts["absage"], "{n} Absage", "{n} Absagen", sprache))
    return t("Neu bei {laden}", sprache, laden=shop_name or "Dranzeit"), ", ".join(parts)
