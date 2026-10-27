"""Benachrichtigungen für eine Nummer an- und abmelden. Öffentlich (ohne Konto), wie das Nummer-Ziehen selbst.

Anmelden darf, wer den Schlüssel der Nummer hat (Nummer ohne Konto, app/libs/ticket.py) oder mit dem Konto des
Termins angemeldet ist. Zusätzlich nur für Termine, die heute oder später anstehen, und mit einer Bremse je Absender.
Die App für iPhone/iPad (mobile/) meldet statt eines Browsers ein FCM-Token an (/push/subscribe-app, app/libs/fcm.py).
Versand: app/libs/notify_worker.py. Die Sprache (language, sonst Accept-Language) steht an der Anmeldung und am Termin –
so kommen Nachrichten in der Sprache, die der Kunde zuletzt gewählt hat.
"""

import hashlib
from typing import Literal
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from app.apis.firebase_utils import get_firestore_db
from app.i18n import aus_anfrage, sprache_von
from app.libs.fcm import fcm_configured
from app.libs.mail import mail_configured
from app.libs.notify_worker import wake
from app.libs.plans import has_feature
from app.libs.throttle import throttle
from app.libs.ticket import may_manage, request_uid
from app.libs.webpush import public_key, push_configured

router = APIRouter()

MAX_SUBSCRIPTIONS_PER_APPOINTMENT = 5


def _throttle(request: Request) -> None:
    throttle(request, "push")


def _require_notifications(shop_id: str | None) -> None:
    """Benachrichtigungen gehören zu den Bezahltarifen (app/libs/plans.py)."""
    shop = get_firestore_db().collection("shops").document(shop_id).get() if shop_id else None
    if not shop or not shop.exists or not has_feature(shop.to_dict() or {}, "benachrichtigung"):
        raise HTTPException(status_code=403, detail="Dieser Laden bietet keine Benachrichtigungen an.")


def _open_appointment(appointment_id: str, key: str | None, request: Request) -> dict:
    """Termin laden, der noch ansteht und den der Absender verwalten darf – sonst 404/403/409 mit verständlicher Meldung."""
    if not appointment_id or len(appointment_id) > 64 or "/" in appointment_id:
        raise HTTPException(status_code=404, detail="Diese Nummer gibt es nicht.")
    doc = get_firestore_db().collection("appointments").document(appointment_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Diese Nummer gibt es nicht.")
    appt = doc.to_dict() or {}
    if not may_manage(appt, key, request_uid(request)):
        raise HTTPException(
            status_code=403,
            detail="Benachrichtigungen für diese Nummer gehen nur auf dem Handy, mit dem sie gezogen wurde, oder mit deinem Konto.",
        )
    if appt.get("status") not in ("scheduled", "in-progress"):
        raise HTTPException(status_code=409, detail="Diese Nummer ist schon erledigt oder abgesagt.")
    start = appt.get("startTime")
    if start and start < datetime.now(timezone.utc) - timedelta(hours=12):
        raise HTTPException(status_code=409, detail="Diese Nummer liegt in der Vergangenheit.")
    return appt


class PushConfig(BaseModel):
    push: bool
    email: bool
    publicKey: str
    # Push an die App (Firebase Cloud Messaging) – im Browser egal
    app: bool = False


@router.get("/push/config")
def push_config() -> PushConfig:
    """Welche Kanäle gibt es? Die Nummernseite blendet danach die Knöpfe ein."""
    return PushConfig(
        push=push_configured(), email=mail_configured(), publicKey=public_key() if push_configured() else "", app=fcm_configured()
    )


class SubscribeRequest(BaseModel):
    appointment_id: str
    key: str | None = Field(default=None, max_length=64)
    endpoint: str = Field(min_length=10, max_length=1000)
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=5, max_length=100)
    language: str | None = Field(default=None, max_length=10)


def _language(value: str | None, request: Request) -> str:
    return sprache_von(value) if value else aus_anfrage(request)


@router.post("/push/subscribe")
def subscribe(body: SubscribeRequest, request: Request) -> dict:
    _throttle(request)
    if not push_configured():
        raise HTTPException(status_code=503, detail="Benachrichtigungen sind gerade nicht eingerichtet.")
    if not body.endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="Ungültige Push-Adresse.")
    appt = _open_appointment(body.appointment_id, body.key, request)
    _require_notifications(appt.get("shopId"))
    _save_subscription(
        appt, body.appointment_id, body.endpoint, {"endpoint": body.endpoint, "p256dh": body.p256dh, "auth": body.auth},
        _language(body.language, request),
    )
    return {"status": "ok"}


def _save_subscription(appt: dict, appointment_id: str, device: str, fields: dict, language: str) -> None:
    """Ein Gerät je Nummer anmelden (Browser: endpoint, App: token) – höchstens MAX_SUBSCRIPTIONS_PER_APPOINTMENT."""
    db = get_firestore_db()
    existing = list(db.collection("push_subscriptions").where("appointmentId", "==", appointment_id).limit(MAX_SUBSCRIPTIONS_PER_APPOINTMENT + 1).stream())
    doc_id = hashlib.sha256(f"{appointment_id}|{device}".encode()).hexdigest()[:40]
    if len(existing) >= MAX_SUBSCRIPTIONS_PER_APPOINTMENT and all(d.id != doc_id for d in existing):
        raise HTTPException(status_code=409, detail="Für diese Nummer sind schon genug Geräte angemeldet.")
    db.collection("push_subscriptions").document(doc_id).set(
        {"appointmentId": appointment_id, "shopId": appt.get("shopId"), **fields, "language": language, "createdAt": datetime.now(timezone.utc)}
    )
    if appt.get("language") != language:
        db.collection("appointments").document(appointment_id).update({"language": language})
    wake()


class SubscribeAppRequest(BaseModel):
    appointment_id: str
    key: str | None = Field(default=None, max_length=64)
    token: str = Field(min_length=20, max_length=4096)
    platform: Literal["ios", "android"]
    language: str | None = Field(default=None, max_length=10)


@router.post("/push/subscribe-app")
def subscribe_app(body: SubscribeAppRequest, request: Request) -> dict:
    """Die App (mobile/) meldet ihr FCM-Token für eine Nummer an – sonst wie /push/subscribe."""
    _throttle(request)
    if not fcm_configured():
        raise HTTPException(status_code=503, detail="Benachrichtigungen sind gerade nicht eingerichtet.")
    appt = _open_appointment(body.appointment_id, body.key, request)
    _require_notifications(appt.get("shopId"))
    _save_subscription(appt, body.appointment_id, body.token, {"token": body.token, "platform": body.platform}, _language(body.language, request))
    return {"status": "ok"}


class UnsubscribeRequest(BaseModel):
    appointment_id: str
    endpoint: str


@router.post("/push/unsubscribe")
def unsubscribe(body: UnsubscribeRequest, request: Request) -> dict:
    _throttle(request)
    doc_id = hashlib.sha256(f"{body.appointment_id}|{body.endpoint}".encode()).hexdigest()[:40]
    get_firestore_db().collection("push_subscriptions").document(doc_id).delete()
    return {"status": "ok"}


class NotifyEmailRequest(BaseModel):
    appointment_id: str
    email: EmailStr | None = None
    key: str | None = Field(default=None, max_length=64)
    language: str | None = Field(default=None, max_length=10)


@router.post("/push/notify-email")
def notify_email(body: NotifyEmailRequest, request: Request) -> dict:
    """E-Mail für "Gleich dran" hinterlegen (z. B. iPhone ohne Home-Bildschirm-App). Leer = wieder löschen."""
    _throttle(request)
    if body.email and not mail_configured():
        raise HTTPException(status_code=503, detail="E-Mails sind gerade nicht eingerichtet.")
    appt = _open_appointment(body.appointment_id, body.key, request)
    if body.email:
        _require_notifications(appt.get("shopId"))
    update = {"notifyEmail": str(body.email) if body.email else None}
    if body.email:
        update["language"] = _language(body.language, request)
    get_firestore_db().collection("appointments").document(body.appointment_id).update(update)
    if body.email:
        wake()
    return {"status": "ok"}
