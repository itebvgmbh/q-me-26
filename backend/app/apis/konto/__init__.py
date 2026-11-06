"""
Das eigene Konto: Profil, eigene Termine, eigene Angebote „Früher dran“ (requirements/eigene-datenbank.md, Stufe 2).
Nur mit Anmeldung und immer nur das eigene (wie firestore.rules).

    GET  /konto/profil                 {"profil": {…} oder null}
    POST /konto/profil/anlegen         {"email", "role", "language"}: anlegen, wenn es noch keins gibt
    POST /konto/profil                 {"aenderung": {…}}: ändern (Rolle nur customer, shopOwner, employee)
    GET  /konto/termine                eigene Termine (Meine Termine)
    GET  /konto/termine/{id}           ein eigener Termin (404, wenn nicht der eigene)
    GET  /konto/angebote               offene Angebote „Früher dran“
    GET  /konto/angebote/{id}          ein eigenes Angebot

Logik: app/libs/laeden.py.
"""

import re

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app import store
from app.auth import AuthorizedUser
from app.i18n import merke
from app.libs import laeden as ld
from app.libs import live

router = APIRouter()

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ProfilAnlegen(BaseModel):
    email: str = ""
    role: str = "customer"
    language: str | None = None


class Aenderung(BaseModel):
    aenderung: dict


def _keine_ablage(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


@router.get("/konto/profil")
def profil(user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    return live.json_wert({"profil": ld.profil(store.db(), user.sub)})


@router.post("/konto/profil/anlegen")
def profil_anlegen(body: ProfilAnlegen, user: AuthorizedUser) -> dict:
    try:
        return live.json_wert({"profil": ld.profil_anlegen(store.db(), user.sub, body.email, body.role, body.language)})
    except ld.LadenFehler as e:
        raise HTTPException(status_code=e.status, detail=e.text)


@router.post("/konto/profil")
def profil_aendern(body: Aenderung, user: AuthorizedUser) -> dict:
    try:
        aenderung = live.aus_json(body.aenderung)
    except ValueError:
        raise HTTPException(status_code=400, detail=merke("Ungültige Angaben zur Person."))
    try:
        return live.json_wert({"profil": ld.profil_aendern(store.db(), user.sub, aenderung)})
    except ld.LadenFehler as e:
        raise HTTPException(status_code=e.status, detail=e.text)


@router.get("/konto/termine")
def termine(user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    return live.json_wert({"termine": ld.eigene_termine(store.db(), user.sub)})


@router.get("/konto/termine/{termin_id}")
def termin(termin_id: str, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    gefunden = ld.eigener_termin(store.db(), user.sub, termin_id) if ID.match(termin_id) else None
    if gefunden is None:
        raise HTTPException(status_code=404, detail=merke("Diesen Termin gibt es nicht mehr."))
    return live.json_wert({"termin": gefunden})


@router.get("/konto/angebote")
def angebote(user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    return live.json_wert({"angebote": ld.eigene_angebote(store.db(), user.sub)})


@router.get("/konto/angebote/{angebot_id}")
def angebot(angebot_id: str, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    gefunden = ld.eigenes_angebot(store.db(), user.sub, angebot_id) if ID.match(angebot_id) else None
    if gefunden is None:
        raise HTTPException(status_code=404, detail=merke("Dieses Angebot gibt es nicht mehr."))
    return live.json_wert({"angebot": gefunden})
