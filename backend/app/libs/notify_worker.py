"""Hintergrunddienst für Benachrichtigungen: "Gleich bist du dran", "Du bist dran", Termin-Erinnerungen,
Absage/Verschiebung durch den Laden und "Früher dran"-Angebote, nebenbei die Start-Mails an neue Läden
(app/libs/onboarding_mail.py).

Läuft als eigener Thread (gestartet in main.py, wie "Früher dran"). Alle 30 Sekunden liest er die heutigen
Termine und schickt fällige Nachrichten. Ruft der Tresen eine Nummer auf, weckt ihn ein Firestore-Listener
sofort – sonst käme "Du bist dran" bis zu 30 Sekunden zu spät. Absagen und Verschiebungen (über /slot-freed)
und neue Angebote (check_slots) wecken ihn ebenfalls; deren Merker prüft er beim Wecken und alle
EXTRA_EVERY Durchläufe, nicht jedes Mal (spart Lesevorgänge).

Kanäle je Termin: Web-Push (Sammlung push_subscriptions) und E-Mail (Feld notifyEmail am Termin, bei
Erinnerungen, Absagen, Verschiebungen und Angeboten auch die E-Mail des Kundenkontos). Was gesendet wurde,
steht am Termin bzw. Angebot (notifiedSoonAt, notifiedCalledAt, reminderSentAt; customerNotice und
offerNotice werden geleert), damit nichts doppelt kommt.
"""

import os
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.libs import onboarding_mail
from app.libs.appointment_window import AppointmentWindow
from app.libs.mail import branded_html, esc, mail_configured, send_mail
from app.libs.plans import has_feature
from app.libs.queue_notify import message_for, needs_reminder, notice_kind, plan_queue_notifications, recalled_to_reset
from app.libs.webpush import SubscriptionGone, push_configured, send_push

BERLIN = ZoneInfo("Europe/Berlin")
SWEEP_SECONDS = 30
# Absagen/Verschiebungen und Angebote ohne Wecken spätestens nach so vielen Durchläufen (5 Minuten)
EXTRA_EVERY = 10
SUBSCRIPTION_MAX_AGE_DAYS = 3

_wakeup = threading.Event()
_thread: threading.Thread | None = None
_watch = None
# Die Termine von heute und den ersten Stunden von morgen (Erinnerungen nach 21 Uhr) hält ein Listener im
# Speicher (app/libs/appointment_window.py), statt sie alle 30 Sekunden neu zu lesen
_window = AppointmentWindow(timedelta(hours=28))


def public_url() -> str:
    return (os.environ.get("PUBLIC_URL", "").strip() or "https://dranzeit.de").rstrip("/")


def start_notify_worker() -> bool:
    global _thread
    if _thread and _thread.is_alive():
        return False
    _thread = threading.Thread(target=_loop, name="notify-worker", daemon=True)
    _thread.start()
    return True


def _loop() -> None:
    from app.apis.firebase_utils import get_firestore_db

    db = get_firestore_db()
    _start_watch(db)
    _window.enable(db)
    last_cleanup = None
    last_onboarding = None
    sweep = 0
    woken = True
    while True:
        try:
            run_once(db, extras=woken or sweep % EXTRA_EVERY == 0)
            today = datetime.now(BERLIN).date()
            if last_cleanup != today:
                last_cleanup = today
                removed = cleanup_subscriptions(db)
                print(f"Benachrichtigungen: {removed} alte Push-Anmeldungen entfernt")
        except Exception as e:  # nie den Dienst deswegen anhalten
            print(f"Benachrichtigungen: Fehler im Durchlauf: {e}")
        # Start-Mails an Läden (app/libs/onboarding_mail.py), seltener als die Nachrichten an Kunden
        now = datetime.now(timezone.utc)
        if last_onboarding is None or now - last_onboarding >= timedelta(minutes=onboarding_mail.SWEEP_MINUTES):
            last_onboarding = now
            try:
                count = onboarding_mail.run_once(db, public_url(), now)
                if count:
                    print(f"Start-Mails: {count} verschickt")
            except Exception as e:
                print(f"Start-Mails: Fehler im Durchlauf: {e}")
        sweep += 1
        woken = _wakeup.wait(SWEEP_SECONDS)
        _wakeup.clear()


def _start_watch(db) -> None:
    """Jede Änderung an aufgerufenen Nummern weckt den Dienst sofort – auch wenn eine zurück auf "Wartet" geht."""
    global _watch
    try:
        _watch = db.collection("appointments").where("status", "==", "in-progress").on_snapshot(lambda *_: _wakeup.set())
    except Exception as e:
        print(f"Benachrichtigungen: Listener nicht gestartet, prüfe alle {SWEEP_SECONDS} s: {e}")


def _as_dict(doc) -> dict:
    data = doc.to_dict() or {}
    data["id"] = doc.id
    return data


def _day_range(now: datetime) -> tuple[datetime, datetime]:
    local = now.astimezone(BERLIN)
    start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


def run_once(db, now: datetime | None = None, extras: bool = True) -> dict:
    """Ein Durchlauf. extras: auch Absagen/Verschiebungen des Ladens und "Früher dran"-Angebote prüfen."""
    now = now or datetime.now(timezone.utc)
    can_push, can_mail = push_configured(), mail_configured()
    if not can_push and not can_mail:
        return {"skipped": "kein Kanal eingerichtet"}

    start, end = _day_range(now)
    todays = _appointments(db, start, end)
    active = [a for a in todays if a.get("status") in ("scheduled", "in-progress")]
    # Zurück auf "Wartet": beim nächsten Aufruf soll "Du bist dran" wieder kommen
    reset = set(recalled_to_reset(active))
    for appt in active:
        if appt["id"] in reset:
            _mark(db, appt["id"], {"notifiedCalledAt": None})
            appt["notifiedCalledAt"] = None
    # Fertige zählen mit: Erst wenn bei einer Person aufgerufen wurde, rechnet die Schlange mit Verzug
    planned = plan_queue_notifications([a for a in todays if a.get("status") != "cancelled"], now)
    by_id = {a["id"]: a for a in active}

    reminders = [a for a in active if needs_reminder(a, now)]
    # Erinnerungen für morgen früh liegen nicht im heutigen Tag
    if now.astimezone(BERLIN).hour >= 21:
        tomorrow = _appointments(db, end, end + timedelta(hours=4))
        reminders += [a for a in tomorrow if needs_reminder(a, now)]
        by_id.update({a["id"]: a for a in tomorrow})

    ids = list({p.appointment_id for p in planned} | {a["id"] for a in reminders})
    subs = _subscriptions_for(db, ids) if can_push else {}
    shops: dict[str, dict] = {}
    sent = 0

    for p in planned:
        appt = by_id[p.appointment_id]
        channels = subs.get(appt["id"], [])
        email = (appt.get("notifyEmail") or "").strip() if can_mail else ""
        if not channels and not email:
            continue  # ohne Kanal nichts merken: wer sich später anmeldet, bekommt die Nachricht noch
        shop = _shop(db, shops, appt.get("shopId"))
        if not has_feature(shop, "benachrichtigung", now):
            continue  # gehört zu den Bezahltarifen (app/libs/plans.py)
        title, body = message_for(p.kind, shop.get("name", ""), ahead=p.ahead)
        _deliver(db, appt, channels, email, title, body, tag=f"{p.kind}-{appt['id']}")
        field = "notifiedCalledAt" if p.kind == "called" else "notifiedSoonAt"
        _mark(db, appt["id"], {field: now})
        sent += 1

    for appt in reminders:
        shop = _shop(db, shops, appt.get("shopId"))
        allowed = has_feature(shop, "erinnerung", now)
        email = _customer_email(db, appt) if can_mail and allowed else ""
        channels = subs.get(appt["id"], []) if allowed else []
        if channels or email:
            start_label = appt["startTime"].astimezone(BERLIN).strftime("%H:%M")
            title, body = message_for("reminder", shop.get("name", ""), start_label=start_label)
            _deliver(db, appt, channels, email, title, body, tag=f"reminder-{appt['id']}")
            sent += 1
        _mark(db, appt["id"], {"reminderSentAt": now})

    result = {"geplant": len(planned), "erinnerungen": len(reminders), "gesendet": sent}
    if extras:
        result["mitteilungen"] = _send_notices(db, now, start, shops, can_push, can_mail)
        result["angebote"] = _send_offers(db, now, shops, can_push, can_mail)
    return result


def _local(value: datetime | None) -> datetime | None:
    return value.astimezone(BERLIN) if value else None


def _send_notices(db, now: datetime, today_start: datetime, shops: dict, can_push: bool, can_mail: bool) -> int:
    """Laden hat abgesagt oder verschoben (Merker customerNotice, gesetzt von updateAppointment im Frontend)."""
    pending = [_as_dict(d) for d in db.collection("appointments").where("customerNotice", "in", ["cancelled", "moved"]).stream()]
    if not pending:
        return 0
    subs = _subscriptions_for(db, [a["id"] for a in pending]) if can_push else {}
    sent = 0
    for appt in pending:
        kind = notice_kind(appt, now, today_start)
        shop = _shop(db, shops, appt.get("shopId"))
        delivered = False
        if kind and has_feature(shop, "benachrichtigung", now):
            channels = subs.get(appt["id"], [])
            email = _customer_email(db, appt) if can_mail else ""
            if channels or email:
                title, body = message_for(
                    kind,
                    shop.get("name", ""),
                    now=_local(now),
                    start=_local(appt["startTime"]),
                    previous=_local(appt.get("customerNoticePreviousStart")),
                    queue=appt.get("type") == "queue",
                    staff=_staff_name(db, appt.get("staffId")) if kind == "moved" else "",
                )
                _deliver(db, appt, channels, email, title, body, tag=f"notice-{appt['id']}")
                delivered = True
                sent += 1
        # Auch ohne Kanal oder Tarif leeren – sonst käme die Nachricht Tage später, wenn sich jemand anmeldet
        update = {"customerNotice": None, "customerNoticePreviousStart": None}
        if delivered:
            update["customerNoticeSentAt"] = now
        db.collection("appointments").document(appt["id"]).update(update)
    return sent


def _send_offers(db, now: datetime, shops: dict, can_push: bool, can_mail: bool) -> int:
    """"Früher dran": neues oder verbessertes Angebot (Merker offerNotice, gesetzt in app/apis/check_slots)."""
    offers = [_as_dict(d) for d in db.collection("earlier_slot_notifications").where("offerNotice", "==", "pending").stream()]
    if not offers:
        return 0
    appts: dict[str, dict | None] = {}
    for offer in offers:
        appt_id = offer.get("appointmentId")
        if appt_id and appt_id not in appts:
            doc = db.collection("appointments").document(appt_id).get()
            appts[appt_id] = _as_dict(doc) if doc.exists else None
    subs = _subscriptions_for(db, [i for i, a in appts.items() if a]) if can_push else {}
    sent = 0
    local_now = _local(now)
    for offer in offers:
        appt = appts.get(offer.get("appointmentId"))
        start = _local_offer_time(offer.get("earlierStartTime"))
        shop = _shop(db, shops, offer.get("shopId"))
        still_open = offer.get("status") == "offered" and not offer.get("isAccepted") and start is not None and start > local_now
        if appt and still_open and appt.get("status") == "scheduled" and has_feature(shop, "frueherDran", now):
            channels = subs.get(appt["id"], [])
            email = _customer_email(db, appt) if can_mail else ""
            if channels or email:
                title, body = message_for(
                    "offer",
                    shop.get("name", ""),
                    now=local_now,
                    start=start,
                    original=_local(appt.get("startTime")),
                    hold_until=_local(offer.get("expiresAt")),
                )
                _deliver(db, appt, channels, email, title, body, tag=f"offer-{appt['id']}", url="/my-bookings", button_text="Angebot ansehen")
                sent += 1
        db.collection("earlier_slot_notifications").document(offer["id"]).update({"offerNotice": None, "offerNotifiedAt": now})
    return sent


def _local_offer_time(value) -> datetime | None:
    """earlierStartTime steht als Ortszeit ohne Zeitzone im Angebot (siehe check_slots)."""
    if not value:
        return None
    if not isinstance(value, datetime):
        try:
            value = datetime.fromisoformat(str(value))
        except ValueError:
            return None
    return value.astimezone(BERLIN) if value.tzinfo else value.replace(tzinfo=BERLIN)


def _staff_name(db, staff_id: str | None) -> str:
    if not staff_id:
        return ""
    doc = db.collection("staff").document(staff_id).get()
    return ((doc.to_dict() or {}).get("name") or "").strip() if doc.exists else ""


def _deliver(
    db, appt: dict, channels: list, email: str, title: str, body: str, tag: str, url: str | None = None, button_text: str = "Nummer ansehen"
) -> None:
    url = url or f"/nummer/{appt['id']}"
    for sub in channels:
        try:
            send_push(sub["subscription"], title, body, url, tag)
        except SubscriptionGone:
            db.collection("push_subscriptions").document(sub["doc_id"]).delete()
        except Exception as e:
            print(f"Push an {appt['id']} fehlgeschlagen: {e}")
    if email:
        try:
            send_mail(
                to=email,
                subject=title,
                html_body=branded_html(esc(title), [esc(body)], button_text=button_text, button_url=public_url() + url),
                text_body=f"{body}\n\n{public_url()}{url}\n",
            )
        except Exception as e:
            print(f"E-Mail an Termin {appt['id']} fehlgeschlagen: {e}")


def _subscriptions_for(db, appointment_ids: list[str]) -> dict[str, list]:
    result: dict[str, list] = {}
    for i in range(0, len(appointment_ids), 30):  # Firestore erlaubt höchstens 30 Werte für "in"
        chunk = appointment_ids[i : i + 30]
        for doc in db.collection("push_subscriptions").where("appointmentId", "in", chunk).stream():
            data = doc.to_dict() or {}
            sub = {"endpoint": data.get("endpoint"), "keys": {"p256dh": data.get("p256dh"), "auth": data.get("auth")}}
            if sub["endpoint"]:
                result.setdefault(data["appointmentId"], []).append({"doc_id": doc.id, "subscription": sub})
    return result


def _shop(db, cache: dict, shop_id: str | None) -> dict:
    if not shop_id:
        return {}
    if shop_id not in cache:
        doc = db.collection("shops").document(shop_id).get()
        cache[shop_id] = (doc.to_dict() or {}) if doc.exists else {}
    return cache[shop_id]


def _customer_email(db, appt: dict) -> str:
    email = (appt.get("notifyEmail") or "").strip()
    customer_id = appt.get("customerId")
    if email or not customer_id or customer_id == "walk-in":
        return email
    doc = db.collection("users").document(customer_id).get()
    return ((doc.to_dict() or {}).get("email") or "").strip() if doc.exists else ""


def _appointments(db, start: datetime, end: datetime) -> list[dict]:
    """Termine mit Beginn in [start, end): vom Listener, wenn er so weit ist, sonst gelesen."""
    cached = _window.between(start, end)
    if cached is not None:
        return cached
    return [_as_dict(d) for d in db.collection("appointments").where("startTime", ">=", start).where("startTime", "<", end).stream()]


def _mark(db, appointment_id: str, fields: dict) -> None:
    """Merker am Termin setzen (z. B. notifiedSoonAt); der nächste Durchlauf wartet, bis der Listener ihn kennt."""
    db.collection("appointments").document(appointment_id).update(fields)
    _window.wrote()


def cleanup_subscriptions(db, now: datetime | None = None) -> int:
    """Push-Anmeldungen gelten nur für eine Nummer; nach ein paar Tagen braucht sie niemand mehr."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=SUBSCRIPTION_MAX_AGE_DAYS)
    removed = 0
    for doc in db.collection("push_subscriptions").where("createdAt", "<", cutoff).limit(500).stream():
        doc.reference.delete()
        removed += 1
    return removed


def wake() -> None:
    """Sofort prüfen, z. B. nach einer neuen Push-Anmeldung."""
    _wakeup.set()


def worker_alive() -> bool:
    return bool(_thread and _thread.is_alive())


if __name__ == "__main__":  # Handtest auf dem Server: einmal durchlaufen lassen
    from app.apis.firebase_utils import get_firestore_db

    print(run_once(get_firestore_db()))
