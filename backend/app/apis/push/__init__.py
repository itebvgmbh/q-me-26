"""Benachrichtigungen für eine Nummer an- und abmelden. Öffentlich (ohne Konto), wie das Nummer-Ziehen selbst.

Geschützt wird über die Termin-ID: Sie ist zufällig (20 Zeichen) und nur dem bekannt, der die Nummer gezogen
hat. Zusätzlich nur für Termine, die heute oder später anstehen, und mit einer Bremse je Absender.
Versand: app/libs/notify_worker.py.
"""

import hashlib
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from app.apis.firebase_utils import get_firestore_db
from app.libs.mail import mail_configured
from app.libs.notify_worker import wake
from app.libs.webpush import public_key, push_configured

router = APIRouter()

MAX_SUBSCRIPTIONS_PER_APPOINTMENT = 5
_RATE_WINDOW_SECONDS = 60
_RATE_MAX = 30
_hits: dict[str, deque] = defaultdict(deque)


def _throttle(request: Request) -> None:
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > _RATE_WINDOW_SECONDS:
        q.popleft()
    if len(q) >= _RATE_MAX:
        raise HTTPException(status_code=429, detail="Zu viele Anfragen. Versuch es gleich noch einmal.")
    q.append(now)


def _open_appointment(appointment_id: str) -> dict:
    """Termin laden, der noch ansteht – sonst 404/409 mit verständlicher Meldung."""
    if not appointment_id or len(appointment_id) > 64 or "/" in appointment_id:
        raise HTTPException(status_code=404, detail="Diese Nummer gibt es nicht.")
    doc = get_firestore_db().collection("appointments").document(appointment_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Diese Nummer gibt es nicht.")
    appt = doc.to_dict() or {}
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


@router.get("/push/config")
def push_config() -> PushConfig:
    """Welche Kanäle gibt es? Die Nummernseite blendet danach die Knöpfe ein."""
    return PushConfig(push=push_configured(), email=mail_configured(), publicKey=public_key() if push_configured() else "")


class SubscribeRequest(BaseModel):
    appointment_id: str
    endpoint: str = Field(min_length=10, max_length=1000)
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=5, max_length=100)


@router.post("/push/subscribe")
def subscribe(body: SubscribeRequest, request: Request) -> dict:
    _throttle(request)
    if not push_configured():
        raise HTTPException(status_code=503, detail="Benachrichtigungen sind gerade nicht eingerichtet.")
    if not body.endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="Ungültige Push-Adresse.")
    appt = _open_appointment(body.appointment_id)
    db = get_firestore_db()
    existing = list(db.collection("push_subscriptions").where("appointmentId", "==", body.appointment_id).limit(MAX_SUBSCRIPTIONS_PER_APPOINTMENT + 1).stream())
    doc_id = hashlib.sha256(f"{body.appointment_id}|{body.endpoint}".encode()).hexdigest()[:40]
    if len(existing) >= MAX_SUBSCRIPTIONS_PER_APPOINTMENT and all(d.id != doc_id for d in existing):
        raise HTTPException(status_code=409, detail="Für diese Nummer sind schon genug Geräte angemeldet.")
    db.collection("push_subscriptions").document(doc_id).set(
        {
            "appointmentId": body.appointment_id,
            "shopId": appt.get("shopId"),
            "endpoint": body.endpoint,
            "p256dh": body.p256dh,
            "auth": body.auth,
            "createdAt": datetime.now(timezone.utc),
        }
    )
    wake()
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


@router.post("/push/notify-email")
def notify_email(body: NotifyEmailRequest, request: Request) -> dict:
    """E-Mail für "Gleich dran" hinterlegen (z. B. iPhone ohne Home-Bildschirm-App). Leer = wieder löschen."""
    _throttle(request)
    if body.email and not mail_configured():
        raise HTTPException(status_code=503, detail="E-Mails sind gerade nicht eingerichtet.")
    _open_appointment(body.appointment_id)
    get_firestore_db().collection("appointments").document(body.appointment_id).update({"notifyEmail": str(body.email) if body.email else None})
    if body.email:
        wake()
    return {"status": "ok"}
