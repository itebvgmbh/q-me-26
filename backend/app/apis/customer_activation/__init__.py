"""Kunden-Link: Ein Laden legt unter "Mein Tag" eine Person an (Sammlung customers) und schickt ihr den Link
/activate?token=…  Damit verbindet die Person ihr Dranzeit-Konto mit diesem Eintrag.

Danach gehören die Termine, die der Laden für sie eingetragen hat, ihrem Konto: Sie stehen unter "Meine Termine",
und "Früher dran" erreicht sie bei Terminen mit checkEarlierOptions (find_slots liest dafür auch customers.userId).

Öffentlich ist nur, ob der Link gilt und von welchem Laden er ist. Verbinden geht nur angemeldet, und nur einmal:
Ist der Eintrag schon mit einem Konto verbunden, kann ihn kein anderes Konto mehr übernehmen.
"""

import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from google.cloud import firestore as gcf

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser

router = APIRouter()

TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{16,128}")
NOT_FOUND = "Diesen Link gibt es nicht. Bitte den Laden um einen neuen."


def _expired(data: dict, now: datetime) -> bool:
    expires = data.get("activationExpires")
    if not isinstance(expires, datetime):
        return False
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires < now


def _customer(token: str):
    """Eintrag zum Link als (Dokument, Daten) – 404, wenn es ihn nicht oder nicht eindeutig gibt"""
    if not TOKEN_RE.fullmatch(token or ""):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    docs = list(get_firestore_db().collection("customers").where("activationToken", "==", token).limit(2).stream())
    if len(docs) != 1:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return docs[0], docs[0].to_dict() or {}


def _shop(shop_id: str) -> dict:
    if not shop_id:
        return {}
    snap = get_firestore_db().collection("shops").document(shop_id).get()
    return (snap.to_dict() or {}) if snap.exists else {}


@router.get("/customer-activation/{token}")
def activation_info(token: str) -> dict:
    """Für die Seite /activate vor dem Anmelden: gilt der Link, und von welchem Laden ist er?"""
    _, data = _customer(token)
    shop = _shop(data.get("shopId", ""))
    if data.get("userId"):
        status = "verbunden"
    elif _expired(data, datetime.now(timezone.utc)):
        status = "abgelaufen"
    else:
        status = "offen"
    return {"status": status, "shopName": shop.get("name") or "Dein Laden"}


@router.post("/customer-activation/{token}")
def activate(token: str, user: AuthorizedUser) -> dict:
    """Eintrag mit dem angemeldeten Konto verbinden und die Termine des Eintrags ans Konto hängen"""
    doc, data = _customer(token)
    shop_id = data.get("shopId", "")
    shop = _shop(shop_id)
    shop_name = shop.get("name") or "Dein Laden"

    if data.get("userId"):
        if data["userId"] == user.sub:
            return {"shopName": shop_name, "moved": 0}
        raise HTTPException(status_code=409, detail="Dieser Link ist schon mit einem anderen Konto verbunden.")
    if _expired(data, datetime.now(timezone.utc)):
        raise HTTPException(status_code=410, detail="Der Link ist abgelaufen. Bitte den Laden um einen neuen.")
    if shop.get("owner") == user.sub:
        raise HTTPException(
            status_code=409,
            detail="Du bist mit dem Konto des Ladens angemeldet. Den Link öffnet die Kundin oder der Kunde mit dem eigenen Konto.",
        )

    db = get_firestore_db()
    # Termine, die der Laden für diesen Eintrag eingetragen hat (customerId = ID des Eintrags)
    appointments = [
        a for a in db.collection("appointments").where("customerId", "==", doc.id).stream() if (a.to_dict() or {}).get("shopId") == shop_id
    ]
    # Erst die Termine, zuletzt der Eintrag: Bricht es dazwischen ab, holt ein zweiter Klick den Rest
    for start in range(0, len(appointments), 400):  # eine Sammelschreibung fasst höchstens 500 Änderungen
        batch = db.batch()
        for a in appointments[start : start + 400]:
            batch.update(a.reference, {"customerId": user.sub, "isAnonymous": False})
        batch.commit()
    doc.reference.update({"userId": user.sub, "isActive": True, "activatedAt": gcf.SERVER_TIMESTAMP, "updatedAt": gcf.SERVER_TIMESTAMP})
    return {"shopName": shop_name, "moved": len(appointments)}
