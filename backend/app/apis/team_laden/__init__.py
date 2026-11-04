"""
Team und Leistungen eines Ladens, mit Anmeldung (requirements/eigene-datenbank.md, Stufe 2, Bereich 4).

    GET  /team/laden/{shopId}/personen      Personen mit Konto-ID und Einladung; Kontaktdaten nur für den Inhaber
    GET  /team/ich/personen                 eigene aktive Einträge (Mein Tag, auch in mehreren Läden)
    POST /team/personen                     {"person": {…}}: neue Person (Inhaber)
    POST /team/personen/{id}                {"aenderung": {…}}: ändern (Inhaber; die Person selbst nur Arbeitszeiten)
    POST /team/personen/{id}/aktiv          {"aktiv": bool}: deaktivieren oder zurückholen (Inhaber)
    POST /team/leistungen                   {"leistung": {…}}: neue Leistung (Inhaber)
    POST /team/leistungen/{id}              {"aenderung": {…}}: ändern, ausblenden, wiederherstellen (Inhaber)
    GET  /team/leistungen/{id}/kommende     {"anzahl": n}: kommende Termine mit der Leistung (Inhaber und Team)

Öffentlich ohne Anmeldung, ohne Konto-ID und Einladung: GET /live/laden/{id}/personen, /live/laden/{id}/leistungen,
/live/leistung/{id} (app/apis/live). Logik und Rechte: app/libs/team_laden.py.
"""

import re

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app import store
from app.auth import AuthorizedUser
from app.auth.access import is_admin, require_shop_member, require_shop_of_owner
from app.i18n import merke
from app.libs import live
from app.libs import team_laden as tl

router = APIRouter()

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class PersonAnlegen(BaseModel):
    person: dict


class Aenderung(BaseModel):
    aenderung: dict


class Aktiv(BaseModel):
    aktiv: bool


class LeistungAnlegen(BaseModel):
    leistung: dict


def _keine_ablage(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _id(wert, text) -> str:
    if not isinstance(wert, str) or not ID.match(wert):
        raise HTTPException(status_code=404, detail=text)
    return wert


def _fehler(e: tl.TeamFehler) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.text)


def _daten(roh: dict) -> dict:
    try:
        return live.aus_json(roh)
    except ValueError:
        raise HTTPException(status_code=400, detail=merke("Ungültige Angaben zur Person."))


def _ist_inhaber(db, user, shop_id: str) -> bool:
    if is_admin(user):
        return True
    snap = db.collection("shops").document(shop_id).get()
    return bool(snap.exists and (snap.to_dict() or {}).get("owner") == user.sub)


def _person_und_laden(db, person_id: str) -> dict:
    _id(person_id, merke("Diese Person gibt es nicht mehr."))
    snap = db.collection(tl.STAFF).document(person_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail=merke("Diese Person gibt es nicht mehr."))
    return snap.to_dict() or {}


def _leistung_und_laden(db, service_id: str) -> dict:
    _id(service_id, merke("Diese Leistung gibt es nicht mehr."))
    gefunden = tl.leistung(db, service_id)
    if gefunden is None:
        raise HTTPException(status_code=404, detail=merke("Diese Leistung gibt es nicht mehr."))
    return gefunden


@router.get("/team/laden/{shop_id}/personen")
def personen(shop_id: str, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    _id(shop_id, merke("Diesen Laden gibt es nicht."))
    require_shop_member(user, shop_id)
    db = store.db()
    return live.json_wert({"personen": tl.personen_fuers_team(db, shop_id, inhaber=_ist_inhaber(db, user, shop_id))})


@router.get("/team/ich/personen")
def eigene(user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    return live.json_wert({"personen": tl.eigene_eintraege(store.db(), user.sub)})


@router.post("/team/personen")
def person_anlegen(body: PersonAnlegen, user: AuthorizedUser) -> dict:
    daten = _daten(body.person)
    shop_id = _id(daten.get("shopId"), merke("Diesen Laden gibt es nicht."))
    require_shop_of_owner(user, shop_id)
    try:
        return live.json_wert({"person": tl.person_anlegen(store.db(), user.sub, daten)})
    except tl.TeamFehler as e:
        raise _fehler(e)


@router.post("/team/personen/{person_id}")
def person_aendern(person_id: str, body: Aenderung, user: AuthorizedUser) -> dict:
    db = store.db()
    person = _person_und_laden(db, person_id)
    inhaber = _ist_inhaber(db, user, person.get("shopId", ""))
    if not inhaber and person.get("userId") != user.sub:
        raise HTTPException(status_code=403, detail=merke("Das darf nur der Inhaber des Ladens."))
    try:
        return live.json_wert({"person": tl.person_aendern(db, user.sub, person_id, _daten(body.aenderung), inhaber)})
    except tl.TeamFehler as e:
        raise _fehler(e)


@router.post("/team/personen/{person_id}/aktiv")
def person_aktiv(person_id: str, body: Aktiv, user: AuthorizedUser) -> dict:
    db = store.db()
    person = _person_und_laden(db, person_id)
    require_shop_of_owner(user, person.get("shopId", ""))
    try:
        return live.json_wert({"person": tl.person_aktiv(db, person_id, body.aktiv)})
    except tl.TeamFehler as e:
        raise _fehler(e)


@router.post("/team/leistungen")
def leistung_anlegen(body: LeistungAnlegen, user: AuthorizedUser) -> dict:
    daten = _daten(body.leistung)
    shop_id = _id(daten.get("shopId"), merke("Diesen Laden gibt es nicht."))
    require_shop_of_owner(user, shop_id)
    try:
        return live.json_wert({"leistung": tl.leistung_anlegen(store.db(), daten)})
    except tl.TeamFehler as e:
        raise _fehler(e)


@router.post("/team/leistungen/{service_id}")
def leistung_aendern(service_id: str, body: Aenderung, user: AuthorizedUser) -> dict:
    db = store.db()
    gefunden = _leistung_und_laden(db, service_id)
    require_shop_of_owner(user, gefunden.get("shopId", ""))
    try:
        return live.json_wert({"leistung": tl.leistung_aendern(db, service_id, _daten(body.aenderung))})
    except tl.TeamFehler as e:
        raise _fehler(e)


@router.get("/team/leistungen/{service_id}/kommende")
def kommende(service_id: str, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    db = store.db()
    gefunden = _leistung_und_laden(db, service_id)
    require_shop_member(user, gefunden.get("shopId", ""))
    return {"anzahl": tl.kommende_termine_mit_leistung(db, gefunden["shopId"], service_id)}
