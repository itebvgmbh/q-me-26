"""Tablet am Tresen per QR-Code koppeln und gekoppelte Tablets verwalten (app/libs/geraete.py).

Ohne vorgeschaltete Anmeldung (routers.json): Starten und Abholen macht das Tablet, bevor es angemeldet ist. Die
übrigen Endpunkte verlangen über AuthorizedUser eine volle Sitzung – ein gekoppeltes Tablet bekommt dort 403, weil sie
nicht auf seiner Freigabeliste stehen.

- POST /geraete/koppeln/start      Tablet: neuer QR-Code (code), Geheimnis zum Abholen, Prüfzahl
- POST /geraete/koppeln/abholen    Tablet: {"status": "wartet" | "abgelaufen" | "fertig"}; bei „fertig“ das Cookie
- GET  /geraete/koppeln/info       Handy des Inhabers: Prüfzahl, Gerät und eigene Läden zum Code
- POST /geraete/koppeln/bestaetigen Handy des Inhabers: Tablet für einen Laden freigeben
- GET  /geraete                     gekoppelte Tablets
- POST /geraete/{kennung}/abmelden  ein Tablet abmelden
"""

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app import store
from app.apis.anmeldung import cookie_setzen, ip_von, ursprung_pruefen
from app.auth import AuthorizedUser
from app.i18n import merke
from app.libs import geraete
from app.libs import laeden as ld
from app.libs.geraete import KoppelFehler

router = APIRouter()

TEXTE = {
    "ungueltig": merke("Dieser Code gilt nicht mehr. Am Tablet erscheint gleich ein neuer – scanne den."),
    "zu-viele": merke("Zu viele Versuche. Warte kurz und versuch es dann noch einmal."),
    "kein-laden": merke("Ein Tablet koppeln kann nur, wer einen Laden bei Dranzeit hat."),
    "laden-waehlen": merke("Wähl den Laden, für den das Tablet ist."),
    "unbekannt": merke("Dieses Tablet ist schon abgemeldet."),
}


def _fehler(e: KoppelFehler) -> HTTPException:
    return HTTPException(status_code=e.status, detail=TEXTE.get(e.code, e.code), headers={"X-Koppeln-Fehler": e.code})


def _keine_ablage(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _laeden(uid: str) -> list[dict]:
    """Eigene Läden mit Name, nicht gesperrte zuerst"""
    laeden = ld.eigene_laeden(store.db(), uid)
    return sorted(
        ({"id": s["id"], "name": s.get("name") or ""} | ({"gesperrt": True} if s.get("suspended") else {}) for s in laeden),
        key=lambda s: (bool(s.get("gesperrt")), s["name"].lower()),
    )


class Start(BaseModel):
    geraet: str = ""


class Abholen(BaseModel):
    abholen: str = ""


class Bestaetigen(BaseModel):
    code: str = ""
    laden: str = ""


@router.post("/geraete/koppeln/start")
def koppeln_start(body: Start, request: Request, response: Response) -> dict:
    ursprung_pruefen(request)
    _keine_ablage(response)
    name = geraete.geraet_name(body.geraet, request.headers.get("user-agent"))
    try:
        g = geraete.starten(ip_von(request), name)
    except KoppelFehler as e:
        raise _fehler(e)
    return {"code": g.code, "abholen": g.abholen, "pruefzahl": g.pruefzahl, "gueltigSekunden": g.gueltig_sekunden}


@router.post("/geraete/koppeln/abholen")
def koppeln_abholen(body: Abholen, request: Request, response: Response) -> dict:
    ursprung_pruefen(request)
    _keine_ablage(response)
    ergebnis = geraete.abholen(body.abholen)
    if ergebnis.status != "fertig":
        return {"status": ergebnis.status}
    cookie_setzen(response, ergebnis.token)
    return {
        "status": "fertig", **ergebnis.konto.oeffentlich(), "bereich": geraete.BEREICH, "laden": ergebnis.laden,
    }


@router.get("/geraete/koppeln/info")
def koppeln_info(code: str, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    laeden = _laeden(user.sub)
    if not laeden:
        raise _fehler(KoppelFehler("kein-laden", 403))
    try:
        o = geraete.offen(code)
    except KoppelFehler as e:
        raise _fehler(e)
    if o.bestaetigt:
        raise _fehler(KoppelFehler("ungueltig", 404))
    return {"pruefzahl": o.pruefzahl, "geraet": o.geraet, "laeden": laeden}


@router.post("/geraete/koppeln/bestaetigen")
def koppeln_bestaetigen(body: Bestaetigen, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    laeden = _laeden(user.sub)
    if not laeden:
        raise _fehler(KoppelFehler("kein-laden", 403))
    if body.laden:
        if not any(s["id"] == body.laden for s in laeden):
            raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht."))
        laden = body.laden
    elif len(laeden) == 1:
        laden = laeden[0]["id"]
    else:
        raise _fehler(KoppelFehler("laden-waehlen", 400))
    try:
        geraete.bestaetigen(body.code, user.sub, laden)
    except KoppelFehler as e:
        raise _fehler(e)
    return {"ok": True, "laden": laden}


@router.get("/geraete")
def geraete_liste(user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    namen = {s["id"]: s["name"] for s in _laeden(user.sub)}
    return {
        "geraete": [
            {
                "kennung": g["kennung"], "geraet": g["geraet"], "laden": g["laden"], "ladenName": namen.get(g["laden"] or ""),
                "angelegt": g["angelegt"].isoformat(), "zuletzt": g["zuletzt"].isoformat(),
            }
            for g in geraete.liste(user.sub)
        ]
    }


@router.post("/geraete/{kennung}/abmelden")
def geraet_abmelden(kennung: str, user: AuthorizedUser, response: Response) -> dict:
    _keine_ablage(response)
    if not geraete.abmelden(user.sub, kennung):
        raise _fehler(KoppelFehler("unbekannt", 404))
    return {"ok": True}
