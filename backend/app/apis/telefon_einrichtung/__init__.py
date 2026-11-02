"""
Telefon-Assistent einrichten: Der Inhaber schaltet ihn ein und trägt die Nummer seines Ladens ein (/telefon-assistent).

    GET  /telefon-einrichtung/{shop_id}   Stand: freigegeben, eingeschaltet, Nummern, Probeanruf, Minuten
    POST /telefon-einrichtung/{shop_id}   einschalten, ausschalten, Nummer ändern

Den Probeanruf erkennt der Eingang (app/apis/telefon_eingang), die Daten stehen in app/libs/telefon_laeden.py.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.libs import telefon_laeden as tl

router = APIRouter()


class Einstellung(BaseModel):
    aktiv: bool
    anschluss: str = ""


def _laden(db, shop_id: str) -> dict:
    snap = db.collection("shops").document(shop_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht.")
    return snap.to_dict() or {}


@router.get("/telefon-einrichtung/{shop_id}")
def ansehen(shop_id: str, user: AuthorizedUser) -> dict:
    require_shop_of_owner(user, shop_id)
    db = get_firestore_db()
    return tl.stand(db, shop_id, _laden(db, shop_id))


@router.post("/telefon-einrichtung/{shop_id}")
def speichern(shop_id: str, body: Einstellung, user: AuthorizedUser) -> dict:
    require_shop_of_owner(user, shop_id)
    db = get_firestore_db()
    shop = _laden(db, shop_id)
    try:
        tl.einstellen(db, shop_id, body.aktiv, body.anschluss)
    except tl.Abgelehnt as nein:
        raise HTTPException(status_code=nein.status, detail=nein.text) from nein
    return tl.stand(db, shop_id, shop)
