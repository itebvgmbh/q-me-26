"""
Termine für Inhaber und Team: Tresen, Kalender, Mein Tag (requirements/eigene-datenbank.md, Stufe 2).

    GET  /team/termine?shopId&von&bis   Termine des Ladens, die in [von, bis) beginnen (höchstens 6 Wochen)
    GET  /team/termine/{id}             ein Termin
    POST /team/termine                  {"termin": {…}}: neuer Termin (Platz belegen, Nummer, Kurzfassung)
    POST /team/termine/{id}             {"aenderung": {…}, "kundeBenachrichtigen": bool}: ändern

Nur mit Anmeldung, und nur für Inhaber und aktive Personen des Ladens (app/auth/access.require_shop_member).
Zeitpunkte kommen und gehen als {"__zeit": "…Z"} (app/libs/live.py). Die Logik steht in app/libs/team_termine.py.
Die Antworten nennen den Kanal `laden:<Laden>`; die Seiten hören darauf (GET /routes/live/ereignisse) und laden neu.

Fehler: 400 ungültige Angaben, 403 nicht dein Laden, 404 gibt es nicht, 409 der Platz ist inzwischen belegt
(Text wie im Browser: „Da ist schon ein Termin (10:00–10:30).“).
"""

import re
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app import store
from app.auth import AuthorizedUser
from app.auth.access import require_shop_member
from app.i18n import merke
from app.libs import live
from app.libs.buchung import PlatzWeg
from app.libs.schedule import BERLIN
from app.libs.team_termine import TerminFehler, termin_aendern, termin_anlegen

router = APIRouter()

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_ZEITRAUM = timedelta(days=42)
TAKEN = merke("Der Platz ist gerade weggegangen.")


class TerminAnlegen(BaseModel):
    termin: dict


class TerminAendern(BaseModel):
    aenderung: dict
    kundeBenachrichtigen: bool = False


def _keine_ablage(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _zeitpunkt(text: str):
    try:
        return live.aus_json({"__zeit": text})
    except ValueError:
        raise HTTPException(status_code=400, detail=merke("Ungültiger Zeitraum."))


def _platz_weg(e: PlatzWeg) -> HTTPException:
    if e.window is not None:
        von, bis = e.window.start.astimezone(BERLIN), e.window.end.astimezone(BERLIN)
        return HTTPException(status_code=409, detail=merke("Da ist schon ein Termin ({von}–{bis}).", von=f"{von:%H:%M}", bis=f"{bis:%H:%M}"))
    return HTTPException(status_code=409, detail=TAKEN)


def _fehler(e: TerminFehler) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.text)


def _termin_des_teams(db, termin_id: str, user) -> dict:
    if not ID.match(termin_id):
        raise HTTPException(status_code=404, detail=merke("Diesen Termin gibt es nicht mehr."))
    snap = db.collection("appointments").document(termin_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail=merke("Diesen Termin gibt es nicht mehr."))
    termin = snap.to_dict() or {}
    require_shop_member(user, termin.get("shopId", ""))
    return {"id": termin_id, **termin}


@router.get("/team/termine")
def termine(shopId: str, von: str, bis: str, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    if not ID.match(shopId):
        raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht."))
    anfang, ende = _zeitpunkt(von), _zeitpunkt(bis)
    if not (anfang < ende <= anfang + MAX_ZEITRAUM):
        raise HTTPException(status_code=400, detail=merke("Ungültiger Zeitraum."))
    require_shop_member(user, shopId)
    abfrage = (
        store.db().collection("appointments")
        .where(filter=store.FieldFilter("shopId", "==", shopId))
        .where(filter=store.FieldFilter("startTime", ">=", anfang))
        .where(filter=store.FieldFilter("startTime", "<", ende))
    )
    liste = [{"id": d.id, **(d.to_dict() or {})} for d in abfrage.stream()]
    return live.json_wert({"termine": liste, "kanaele": [f"laden:{shopId}"]})


@router.get("/team/termine/{termin_id}")
def termin(termin_id: str, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    return live.json_wert({"termin": _termin_des_teams(store.db(), termin_id, user)})


@router.post("/team/termine")
def anlegen(body: TerminAnlegen, user: AuthorizedUser) -> dict:
    try:
        daten = live.aus_json(body.termin)
    except ValueError:
        raise HTTPException(status_code=400, detail=merke("Ungültige Zeitangabe für den Termin."))
    shop_id = daten.get("shopId")
    if not isinstance(shop_id, str) or not ID.match(shop_id):
        raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht."))
    require_shop_member(user, shop_id)
    try:
        created = termin_anlegen(store.db(), user.sub, daten)
    except TerminFehler as e:
        raise _fehler(e)
    except PlatzWeg as e:
        raise _platz_weg(e)
    print(f"Termin vom Team {created['id']} in {shop_id}: {created['startTime'].astimezone(BERLIN):%d.%m. %H:%M} bei {created['staffId']}")
    return live.json_wert({"termin": created})


@router.post("/team/termine/{termin_id}")
def aendern(termin_id: str, body: TerminAendern, user: AuthorizedUser) -> dict:
    db = store.db()
    _termin_des_teams(db, termin_id, user)
    try:
        aenderung = live.aus_json(body.aenderung)
    except ValueError:
        raise HTTPException(status_code=400, detail=merke("Ungültige Zeitangabe für den Termin."))
    try:
        nachher = termin_aendern(db, termin_id, aenderung, kunde_benachrichtigen=body.kundeBenachrichtigen)
    except TerminFehler as e:
        raise _fehler(e)
    except PlatzWeg as e:
        raise _platz_weg(e)
    return live.json_wert({"termin": nachher})
