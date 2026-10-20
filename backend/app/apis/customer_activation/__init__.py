"""Kunden-Link: Ein Laden legt unter "Mein Tag" eine Person an (Sammlung customers) und schickt ihr den Link
/activate?token=…  Damit verbindet die Person ihr Dranzeit-Konto mit diesem Eintrag.

Danach gehören die Termine, die der Laden für sie eingetragen hat, ihrem Konto: Sie stehen unter "Meine Termine",
und "Früher dran" erreicht sie bei Terminen mit checkEarlierOptions (find_slots liest dafür auch customers.userId).

Den Link erzeugt POST /customer-activation (Inhaber und Team des Ladens). Gespeichert wird nur der SHA-256-Hash
des Tokens (activationTokenHash): Die Sammlung ist für die Buchung lesbar, das Token selbst kennt nur, wer den Link
bekommen hat. Ein neuer Link ersetzt den alten. Einträge von vor diesem Umbau tragen das Token noch im Klartext
(activationToken); hash_plain_tokens stellt sie um, ohne dass verschickte Links ungültig werden.

Öffentlich ist nur, ob der Link gilt und von welchem Laden er ist. Verbinden geht nur angemeldet, und nur einmal:
Ist der Eintrag schon mit einem Konto verbunden, kann ihn kein anderes Konto mehr übernehmen.

Bucht jemand mit Konto selbst (Nummer ziehen, Termin buchen), legt POST /customer-link/{shopId} den Eintrag gleich
verbunden an – oder verbindet einen, den der Laden mit derselben E-Mail angelegt hat. Das aber nur, wenn Firebase
die E-Mail des Kontos als bestätigt kennt (Google-Anmeldung): Sonst könnte jeder ein Konto mit fremder Adresse
anlegen und so die Termine dieser Person übernehmen. Dann bleibt es beim Kunden-Link.
"""

import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from google.api_core.exceptions import Conflict
from google.cloud import firestore as gcf
from pydantic import BaseModel

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import require_shop_member
from app.libs.links import new_token, public_origin, token_hash

router = APIRouter()

VALID_DAYS = 30
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{16,128}")
SHOP_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
NOT_FOUND = "Diesen Link gibt es nicht. Bitte den Laden um einen neuen."


def _expired(data: dict, now: datetime) -> bool:
    expires = data.get("activationExpires")
    if not isinstance(expires, datetime):
        return False
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires < now


def _hash_plain(ref, token: str) -> None:
    """Klartext-Token eines alten Eintrags durch seinen Hash ersetzen – der Link gilt weiter"""
    ref.update({"activationTokenHash": token_hash(token), "activationToken": gcf.DELETE_FIELD})


def hash_plain_tokens(db) -> int:
    """Übergang: Klartext-Tokens aller Einträge hashen (läuft beim Start und täglich, app/apis/schedulers).
    Danach steht kein Token mehr offen in der Datenbank. Gibt die Zahl der umgestellten Einträge zurück."""
    docs = list(db.collection("customers").where("activationToken", ">", "").stream())
    for doc in docs:
        _hash_plain(doc.reference, str((doc.to_dict() or {}).get("activationToken")))
    return len(docs)


def _customer(token: str):
    """Eintrag zum Link als (Dokument, Daten) – 404, wenn es ihn nicht oder nicht eindeutig gibt"""
    if not TOKEN_RE.fullmatch(token or ""):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    customers = get_firestore_db().collection("customers")
    docs = list(customers.where("activationTokenHash", "==", token_hash(token)).limit(2).stream())
    if not docs:
        # Link von vor dem Umbau, noch nicht umgestellt (oder von einer alten, noch offenen Seite erzeugt)
        docs = list(customers.where("activationToken", "==", token).limit(2).stream())
        if len(docs) == 1:
            _hash_plain(docs[0].reference, token)
    if len(docs) != 1:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return docs[0], docs[0].to_dict() or {}


def _shop(shop_id: str) -> dict:
    if not shop_id:
        return {}
    snap = get_firestore_db().collection("shops").document(shop_id).get()
    return (snap.to_dict() or {}) if snap.exists else {}


def _link(db, doc, shop_id: str, uid: str) -> int:
    """Eintrag mit dem Konto verbinden und die Termine, die der Laden für ihn eingetragen hat, ans Konto hängen"""
    # Termine, die der Laden für diesen Eintrag eingetragen hat (customerId = ID des Eintrags)
    appointments = [
        a for a in db.collection("appointments").where("customerId", "==", doc.id).stream() if (a.to_dict() or {}).get("shopId") == shop_id
    ]
    # Erst die Termine, zuletzt der Eintrag: Bricht es dazwischen ab, holt ein zweiter Versuch den Rest
    for start in range(0, len(appointments), 400):  # eine Sammelschreibung fasst höchstens 500 Änderungen
        batch = db.batch()
        for a in appointments[start : start + 400]:
            batch.update(a.reference, {"customerId": uid, "isAnonymous": False})
        batch.commit()
    doc.reference.update({"userId": uid, "isActive": True, "activatedAt": gcf.SERVER_TIMESTAMP, "updatedAt": gcf.SERVER_TIMESTAMP})
    return len(appointments)


def account(uid: str) -> dict:
    """E-Mail, ob sie bestätigt ist, und Name des Kontos – so, wie Firebase sie kennt, nicht wie der Browser sie schickt"""
    from firebase_admin import auth

    from app.apis.firebase_utils import get_firebase_app

    record = auth.get_user(uid, app=get_firebase_app())
    return {"email": (record.email or "").strip(), "verified": bool(record.email_verified), "name": (record.display_name or "").strip()}


class LinkRequest(BaseModel):
    customer_id: str


@router.post("/customer-activation")
def create_link(body: LinkRequest, request: Request, user: AuthorizedUser) -> dict:
    """Neuer Link für einen Eintrag der Kundenliste ("Kunde anlegen" in Mein Tag); der alte gilt danach nicht mehr.

    Das Token steht nur in dieser Antwort, am Eintrag nur sein Hash."""
    if not SHOP_ID_RE.fullmatch(body.customer_id or ""):
        raise HTTPException(status_code=404, detail="Diesen Kunden gibt es nicht mehr. Lade die Seite neu.")
    ref = get_firestore_db().collection("customers").document(body.customer_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Diesen Kunden gibt es nicht mehr. Lade die Seite neu.")
    customer = snap.to_dict() or {}
    require_shop_member(user, customer.get("shopId", ""))
    if customer.get("userId"):
        raise HTTPException(status_code=409, detail=f"{customer.get('name') or 'Die Person'} hat das Konto schon verbunden und braucht keinen Link.")

    token = new_token()
    expires = datetime.now(timezone.utc) + timedelta(days=VALID_DAYS)
    ref.update(
        {
            "activationTokenHash": token_hash(token),
            "activationExpires": expires,
            "activationToken": gcf.DELETE_FIELD,
            "updatedAt": gcf.SERVER_TIMESTAMP,
        }
    )
    return {"link": f"{public_origin(request)}/activate?token={token}", "expires": expires.isoformat()}


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
    return {"shopName": shop_name, "moved": _link(get_firestore_db(), doc, shop_id, user.sub)}


@router.post("/customer-link/{shop_id}")
def link_own_entry(shop_id: str, user: AuthorizedUser) -> dict:
    """Beim Buchen mit Konto: eigenen Kunden-Eintrag in diesem Laden verbunden anlegen oder einen vorhandenen
    mit derselben, bestätigten E-Mail verbinden. Sagt, was passiert ist und wie viele Termine ans Konto gingen."""
    if not SHOP_ID_RE.fullmatch(shop_id or "") or not _shop(shop_id):
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht.")
    db = get_firestore_db()
    customers = db.collection("customers")
    if list(customers.where("shopId", "==", shop_id).where("userId", "==", user.sub).limit(1).stream()):
        return {"status": "schon_verbunden", "moved": 0}

    me = account(user.sub)
    email = me["email"]
    variants = list(dict.fromkeys([email, email.lower()])) if email else []  # der Laden tippt die Adresse selbst ein
    same_email = {d.id: d for v in variants for d in customers.where("shopId", "==", shop_id).where("email", "==", v).stream()}
    open_entries = [d for d in same_email.values() if not (d.to_dict() or {}).get("userId")]
    if open_entries:
        if not me["verified"]:
            return {"status": "nicht_bestaetigt", "moved": 0}
        return {"status": "verbunden", "moved": sum(_link(db, d, shop_id, user.sub) for d in open_entries)}
    if same_email:  # Die Adresse gehört hier schon einem anderen Konto – keinen zweiten Eintrag danebenlegen
        return {"status": "anderes_konto", "moved": 0}

    # Feste ID je Laden und Konto: Ein doppelter Klick legt keinen zweiten Eintrag an
    ref = customers.document(f"{shop_id}_{user.sub}")
    try:
        ref.create(
            {
                "id": ref.id,
                "shopId": shop_id,
                "name": me["name"] or (email.split("@")[0] if email else "") or "Unbekannt",
                "email": email,
                "userId": user.sub,
                "isActive": True,
                "createdAt": gcf.SERVER_TIMESTAMP,
                "updatedAt": gcf.SERVER_TIMESTAMP,
                "activatedAt": gcf.SERVER_TIMESTAMP,
            }
        )
    except Conflict:
        return {"status": "schon_verbunden", "moved": 0}
    return {"status": "neu", "moved": 0}
