"""Benachrichtigungen für Inhaber und Team auf einem Gerät an- und abmelden ("Mein Tag", frontend/src/utils/team-push.ts).

Ein Gerät (Browser: endpoint mit Schlüsseln, App für iPhone/iPad: FCM-Token) meldet sich für alle Läden des Kontos an –
eigene (shops.owner) und die, in deren Team es aktiv ist (staff.userId). Je Laden ein Eintrag in team_push_subscriptions
mit der Person (staffId) und den gewählten Ereignissen (events). Was ankommt, entscheidet app/libs/team_notify.py; ob die
Person noch im Team ist, prüft der Versand bei jeder Nachricht. Die App meldet sich bei jedem Öffnen von "Mein Tag" neu
an – so stimmen Läden und Adresse, und alte Geräte fallen nach einer Weile heraus (notify_worker).
"""

import hashlib
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.i18n import aus_anfrage, sprache_von
from app.libs.fcm import fcm_configured
from app.libs.plans import has_feature
from app.libs.team_notify import COLLECTION, EVENTS
from app.libs.throttle import throttle
from app.libs.webpush import push_configured

router = APIRouter()


class TeamEvents(BaseModel):
    nummer: bool = True
    buchung: bool = True
    absage: bool = True


class Device(BaseModel):
    """Browser: endpoint, p256dh, auth – App: token, platform"""

    endpoint: str | None = Field(default=None, min_length=10, max_length=1000)
    p256dh: str | None = Field(default=None, min_length=10, max_length=200)
    auth: str | None = Field(default=None, min_length=5, max_length=100)
    token: str | None = Field(default=None, min_length=20, max_length=4096)
    platform: Literal["ios", "android"] | None = None


class SubscribeRequest(Device):
    events: TeamEvents = TeamEvents()
    language: str | None = Field(default=None, max_length=10)


def _device(body: Device) -> tuple[str, dict]:
    """Kennung des Geräts (Hash der Adresse) und die Felder für den Versand"""
    if body.token:
        if not fcm_configured():
            raise HTTPException(status_code=503, detail="Benachrichtigungen sind gerade nicht eingerichtet.")
        return hashlib.sha256(body.token.encode()).hexdigest()[:40], {"token": body.token, "platform": body.platform or "ios"}
    if not body.endpoint or not body.p256dh or not body.auth:
        raise HTTPException(status_code=400, detail="Ungültige Push-Adresse.")
    if not push_configured():
        raise HTTPException(status_code=503, detail="Benachrichtigungen sind gerade nicht eingerichtet.")
    if not body.endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="Ungültige Push-Adresse.")
    return hashlib.sha256(body.endpoint.encode()).hexdigest()[:40], {"endpoint": body.endpoint, "p256dh": body.p256dh, "auth": body.auth}


def team_shops(db, uid: str) -> dict[str, str | None]:
    """Läden des Kontos → eigene Person darin (staffId) oder None: eigene Läden und aktive Einträge im Team"""
    shops: dict[str, str | None] = {doc.id: None for doc in db.collection("shops").where("owner", "==", uid).stream()}
    for doc in db.collection("staff").where("userId", "==", uid).stream():
        data = doc.to_dict() or {}
        if data.get("shopId") and data.get("isActive", True) is not False:
            shops[data["shopId"]] = doc.id
    return shops


def _own_entries(db, uid: str, device: str) -> list:
    return list(db.collection(COLLECTION).where("uid", "==", uid).where("device", "==", device).stream())


@router.post("/team-push/subscribe")
def subscribe(body: SubscribeRequest, request: Request, user: AuthorizedUser) -> dict:
    """Gerät anmelden oder Auswahl ändern – für alle Läden des Kontos"""
    throttle(request, "team-push")
    device, channel = _device(body)
    db = get_firestore_db()
    shops = team_shops(db, user.sub)
    if not shops:
        raise HTTPException(status_code=403, detail="Dieses Konto gehört zu keinem Laden.")
    paid = {shop_id for shop_id in shops if has_feature(_shop(db, shop_id), "benachrichtigung")}
    if not paid:
        raise HTTPException(status_code=403, detail="Dieser Laden bietet keine Benachrichtigungen an.")
    now = datetime.now(timezone.utc)
    language = sprache_von(body.language) if body.language else aus_anfrage(request)
    events = {event: bool(getattr(body.events, event)) for event in EVENTS}
    for shop_id in paid:
        doc_id = hashlib.sha256(f"{user.sub}|{shop_id}|{device}".encode()).hexdigest()[:40]
        ref = db.collection(COLLECTION).document(doc_id)
        existing = ref.get()
        created = ((existing.to_dict() or {}).get("createdAt") if existing.exists else None) or now
        ref.set({"uid": user.sub, "shopId": shop_id, "staffId": shops[shop_id], "device": device, **channel, "events": events,
                 "language": language, "createdAt": created, "updatedAt": now})
    # Nicht mehr im Team (oder Tarif ohne Benachrichtigung): dort abmelden
    for doc in _own_entries(db, user.sub, device):
        if (doc.to_dict() or {}).get("shopId") not in paid:
            doc.reference.delete()
    return {"status": "ok", "shops": len(paid)}


@router.post("/team-push/unsubscribe")
def unsubscribe(body: Device, request: Request, user: AuthorizedUser) -> dict:
    """Gerät für dieses Konto abmelden (Schalter in "Mein Tag", Abmelden aus dem Konto)"""
    throttle(request, "team-push")
    device = hashlib.sha256((body.token or body.endpoint or "").encode()).hexdigest()[:40]
    db = get_firestore_db()
    for doc in _own_entries(db, user.sub, device):
        doc.reference.delete()
    return {"status": "ok"}


def _shop(db, shop_id: str) -> dict:
    doc = db.collection("shops").document(shop_id).get()
    return (doc.to_dict() or {}) if doc.exists else {}
