"""
Pausen pflegen, nur der Inhaber des Ladens (requirements/eigene-datenbank.md, Stufe 2, Bereich 5).

    POST /team/pausen                       {"pause": {…}}       einzelne Pause anlegen
    POST /team/pausen/{id}                  {"aenderung": {…}}   ändern
    POST /team/pausen/{id}/loeschen                              löschen
    POST /team/feste-pausen                 {"pause": {…}}       feste Pause (Wochentag) anlegen
    POST /team/feste-pausen/{id}            {"aenderung": {…}}   ändern, an- oder abschalten (active)
    POST /team/feste-pausen/{id}/loeschen                        löschen

Lesen ist öffentlich: GET /live/person/{staffId}/pausen (app/apis/live). Logik und Prüfungen: app/libs/pausen.py.
"""

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import store
from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.i18n import merke
from app.libs import live
from app.libs import pausen as p

router = APIRouter()

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class PauseAnlegen(BaseModel):
    pause: dict


class Aenderung(BaseModel):
    aenderung: dict


def _daten(roh: dict) -> dict:
    try:
        return live.aus_json(roh)
    except ValueError:
        raise HTTPException(status_code=400, detail=merke("Ungültige Zeitangabe für die Pause."))


def _fehler(e: p.PausenFehler) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.text)


def _anlegen(sammlung: str, body: PauseAnlegen, user) -> dict:
    daten = _daten(body.pause)
    shop_id = daten.get("shopId")
    if not isinstance(shop_id, str) or not ID.match(shop_id):
        raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht."))
    require_shop_of_owner(user, shop_id)
    try:
        return live.json_wert({"pause": p.anlegen(store.db(), sammlung, daten)})
    except p.PausenFehler as e:
        raise _fehler(e)


def _eigene_pause(db, sammlung: str, pause_id: str, user) -> dict:
    if not ID.match(pause_id):
        raise HTTPException(status_code=404, detail=merke("Diese Pause gibt es nicht mehr."))
    try:
        pause = p.pause_lesen(db, sammlung, pause_id)
    except p.PausenFehler as e:
        raise _fehler(e)
    require_shop_of_owner(user, pause.get("shopId", ""))
    return pause


def _aendern(sammlung: str, pause_id: str, body: Aenderung, user) -> dict:
    db = store.db()
    _eigene_pause(db, sammlung, pause_id, user)
    try:
        return live.json_wert({"pause": p.aendern(db, sammlung, pause_id, _daten(body.aenderung))})
    except p.PausenFehler as e:
        raise _fehler(e)


def _loeschen(sammlung: str, pause_id: str, user) -> dict:
    db = store.db()
    _eigene_pause(db, sammlung, pause_id, user)
    p.loeschen(db, sammlung, pause_id)
    return {"geloescht": pause_id}


@router.post("/team/pausen")
def einzeln_anlegen(body: PauseAnlegen, user: AuthorizedUser) -> dict:
    return _anlegen(p.EINZELN, body, user)


@router.post("/team/pausen/{pause_id}")
def einzeln_aendern(pause_id: str, body: Aenderung, user: AuthorizedUser) -> dict:
    return _aendern(p.EINZELN, pause_id, body, user)


@router.post("/team/pausen/{pause_id}/loeschen")
def einzeln_loeschen(pause_id: str, user: AuthorizedUser) -> dict:
    return _loeschen(p.EINZELN, pause_id, user)


@router.post("/team/feste-pausen")
def fest_anlegen(body: PauseAnlegen, user: AuthorizedUser) -> dict:
    return _anlegen(p.FEST, body, user)


@router.post("/team/feste-pausen/{pause_id}")
def fest_aendern(pause_id: str, body: Aenderung, user: AuthorizedUser) -> dict:
    return _aendern(p.FEST, pause_id, body, user)


@router.post("/team/feste-pausen/{pause_id}/loeschen")
def fest_loeschen(pause_id: str, user: AuthorizedUser) -> dict:
    return _loeschen(p.FEST, pause_id, user)
