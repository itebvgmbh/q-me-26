"""Hintergrunddienst für Benachrichtigungen: "Gleich bist du dran", "Du bist dran" und Termin-Erinnerungen.

Läuft als eigener Thread (gestartet in main.py, wie "Früher dran"). Alle 30 Sekunden liest er die heutigen
Termine und schickt fällige Nachrichten. Ruft der Tresen eine Nummer auf, weckt ihn ein Firestore-Listener
sofort – sonst käme "Du bist dran" bis zu 30 Sekunden zu spät.

Kanäle je Termin: Web-Push (Sammlung push_subscriptions) und E-Mail (Feld notifyEmail am Termin, bei
Erinnerungen auch die E-Mail des Kundenkontos). Was gesendet wurde, steht am Termin
(notifiedSoonAt, notifiedCalledAt, reminderSentAt), damit nichts doppelt kommt.
"""

import os
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.libs.mail import branded_html, esc, mail_configured, send_mail
from app.libs.queue_notify import message_for, needs_reminder, plan_queue_notifications
from app.libs.webpush import SubscriptionGone, push_configured, send_push

BERLIN = ZoneInfo("Europe/Berlin")
SWEEP_SECONDS = 30
SUBSCRIPTION_MAX_AGE_DAYS = 3

_wakeup = threading.Event()
_thread: threading.Thread | None = None
_watch = None


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
    last_cleanup = None
    while True:
        try:
            run_once(db)
            today = datetime.now(BERLIN).date()
            if last_cleanup != today:
                last_cleanup = today
                removed = cleanup_subscriptions(db)
                print(f"Benachrichtigungen: {removed} alte Push-Anmeldungen entfernt")
        except Exception as e:  # nie den Dienst deswegen anhalten
            print(f"Benachrichtigungen: Fehler im Durchlauf: {e}")
        _wakeup.wait(SWEEP_SECONDS)
        _wakeup.clear()


def _start_watch(db) -> None:
    """Jede Änderung an aufgerufenen Nummern weckt den Dienst sofort."""
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


def run_once(db, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    can_push, can_mail = push_configured(), mail_configured()
    if not can_push and not can_mail:
        return {"skipped": "kein Kanal eingerichtet"}

    start, end = _day_range(now)
    todays = [
        _as_dict(d)
        for d in db.collection("appointments").where("startTime", ">=", start).where("startTime", "<", end).stream()
    ]
    active = [a for a in todays if a.get("status") in ("scheduled", "in-progress")]
    planned = plan_queue_notifications(active, now)
    by_id = {a["id"]: a for a in active}

    reminders = [a for a in active if needs_reminder(a, now)]
    # Erinnerungen für morgen früh liegen nicht im heutigen Tag
    if now.astimezone(BERLIN).hour >= 21:
        tomorrow = [
            _as_dict(d)
            for d in db.collection("appointments").where("startTime", ">=", end).where("startTime", "<", end + timedelta(hours=4)).stream()
        ]
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
        title, body = message_for(p.kind, shop.get("name", ""), ahead=p.ahead)
        _deliver(db, appt, channels, email, title, body, tag=f"{p.kind}-{appt['id']}")
        field = "notifiedCalledAt" if p.kind == "called" else "notifiedSoonAt"
        db.collection("appointments").document(appt["id"]).update({field: now})
        sent += 1

    for appt in reminders:
        email = _customer_email(db, appt) if can_mail else ""
        channels = subs.get(appt["id"], [])
        if channels or email:
            shop = _shop(db, shops, appt.get("shopId"))
            start_label = appt["startTime"].astimezone(BERLIN).strftime("%H:%M")
            title, body = message_for("reminder", shop.get("name", ""), start_label=start_label)
            _deliver(db, appt, channels, email, title, body, tag=f"reminder-{appt['id']}")
            sent += 1
        db.collection("appointments").document(appt["id"]).update({"reminderSentAt": now})

    return {"geplant": len(planned), "erinnerungen": len(reminders), "gesendet": sent}


def _deliver(db, appt: dict, channels: list, email: str, title: str, body: str, tag: str) -> None:
    url = f"/nummer/{appt['id']}"
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
                html_body=branded_html(esc(title), [esc(body)], button_text="Nummer ansehen", button_url=public_url() + url),
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
