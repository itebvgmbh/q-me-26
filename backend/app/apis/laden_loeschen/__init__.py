"""
Laden löschen durch den Inhaber (Seite „Meine Läden“, „Laden“ → „Laden löschen“). Logik: app/libs/laden_loeschen.py.

    GET  /team/laeden/{shopId}/loeschen     Vorschau: was weggeht, ob es geht, was zur Bestätigung einzutippen ist
    POST /team/laeden/{shopId}/loeschen     {"bestaetigung": "<Name des Ladens>"}: Sicherung, löschen, Protokoll

Der Betreiber löscht weiter im Betreiber-Bereich (app/apis/betreiber, POST /betreiber/loeschen).
"""

import re

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app import store
from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.i18n import merke
from app.libs import laden_loeschen as ll

router = APIRouter()

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class Bestaetigung(BaseModel):
    bestaetigung: str = ""


def _laden(shop_id: str, user) -> None:
    if not ID.match(shop_id or ""):
        raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht mehr."))
    if not store.db().collection("shops").document(shop_id).get().exists:
        raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht mehr."))
    require_shop_of_owner(user, shop_id)


@router.get("/team/laeden/{shop_id}/loeschen")
def loeschen_vorschau(shop_id: str, user: AuthorizedUser, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    _laden(shop_id, user)
    try:
        return ll.vorschau(store.db(), shop_id)
    except ll.LoeschFehler as e:
        raise HTTPException(status_code=e.status, detail=e.text)


@router.post("/team/laeden/{shop_id}/loeschen")
def laden_loeschen(shop_id: str, body: Bestaetigung, user: AuthorizedUser) -> dict:
    _laden(shop_id, user)
    try:
        return ll.loeschen(store.db(), user, shop_id, body.bestaetigung)
    except ll.LoeschFehler as e:
        raise HTTPException(status_code=e.status, detail=e.text)
