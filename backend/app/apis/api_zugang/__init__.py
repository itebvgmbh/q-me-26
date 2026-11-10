"""
Schlüssel für die Termin-API verwalten – nur der Inhaber des Ladens (requirements/termin-api.md).

    GET  /team/laeden/{shopId}/api-schluessel                  aktive Schlüssel (ohne Geheimnis) und ob der Tarif passt
    POST /team/laeden/{shopId}/api-schluessel                  {"name": "Webseite"}: neuer Schlüssel, einmal im Klartext
    POST /team/laeden/{shopId}/api-schluessel/{id}/widerrufen  sofort ungültig

Die API selbst steht in app/schnittstelle, die Schlüssel in app/libs/api_schluessel.py.
"""
import re

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app import store
from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.i18n import merke
from app.libs import api_schluessel as ak
from app.libs import live
from app.libs import webhooks as wh
from app.libs.plans import has_feature

router = APIRouter()

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
KEIN_TARIF = merke("Die Schnittstelle gibt es ab dem Tarif Solo.")


class SchluesselAnlegen(BaseModel):
    name: str = Field(default="", max_length=200)


def _laden(shop_id: str, user) -> dict:
    if not ID.match(shop_id):
        raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht."))
    require_shop_of_owner(user, shop_id)
    snap = store.db().collection("shops").document(shop_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht."))
    return snap.to_dict() or {}


@router.get("/team/laeden/{shop_id}/api-schluessel")
def schluessel(shop_id: str, user: AuthorizedUser, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    shop = _laden(shop_id, user)
    db = store.db()
    return live.json_wert({"schluessel": ak.liste(db, shop_id), "tarif": has_feature(shop, "api"),
                           "webhooks": [wh.fuer_den_inhaber(i, w) for i, w in wh.des_ladens(db, shop_id)]})


@router.post("/team/laeden/{shop_id}/api-schluessel")
def anlegen(shop_id: str, body: SchluesselAnlegen, user: AuthorizedUser, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    shop = _laden(shop_id, user)
    if not has_feature(shop, "api"):
        raise HTTPException(status_code=403, detail=KEIN_TARIF)
    try:
        eintrag, klartext = ak.anlegen(store.db(), shop_id, body.name, user.sub)
    except ak.SchluesselFehler as e:
        raise HTTPException(status_code=e.status, detail=e.meldung)
    print(f"API-Schlüssel {eintrag['id']} für {shop_id} angelegt")
    return live.json_wert({"eintrag": eintrag, "schluessel": klartext})


@router.post("/team/laeden/{shop_id}/api-schluessel/{schluessel_id}/widerrufen")
def widerrufen(shop_id: str, schluessel_id: str, user: AuthorizedUser) -> dict:
    _laden(shop_id, user)
    try:
        ak.widerrufen(store.db(), shop_id, schluessel_id)
    except ak.SchluesselFehler as e:
        raise HTTPException(status_code=e.status, detail=e.meldung)
    print(f"API-Schlüssel {schluessel_id} für {shop_id} widerrufen")
    return {"ok": True}


@router.post("/team/laeden/{shop_id}/webhooks/{webhook_id}/entfernen")
def webhook_entfernen(shop_id: str, webhook_id: str, user: AuthorizedUser) -> dict:
    """Der Inhaber sieht, wohin Daten gehen, und kann einen Webhook selbst entfernen"""
    _laden(shop_id, user)
    try:
        wh.loeschen(store.db(), shop_id, webhook_id)
    except wh.WebhookFehler as e:
        raise HTTPException(status_code=e.status, detail=e.meldung)
    print(f"Webhook {webhook_id} von {shop_id} durch den Inhaber entfernt")
    return {"ok": True}
