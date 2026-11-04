"""Betreiber-Bereich, Reiter Briefe: Salons aus dem Verzeichnis in Wellen anschreiben (requirements/briefversand.md, Stufe A).

    GET  /routes/betreiber/briefe                         Salons mit Grund je Art, Wellen mit Auswertung, Einstellungen
    POST /routes/betreiber/briefe/einstellungen           Obergrenze je Welle, Kostengrenze je Monat, Preis je Brief
    POST /routes/betreiber/briefe/welle                   Welle erzeugen: Sammel-PDF, nur in diesem Moment (Codes nur darin)
    POST /routes/betreiber/briefe/welle/{id}/hochgeladen  Beim Dienstleister hochgeladen: Briefe gelten als verschickt
    POST /routes/betreiber/briefe/welle/{id}/verwerfen    Nicht hochgeladen: Codes ungültig, Salons wieder auswählbar

Hängt am Unter-Router `admin` aus app/apis/betreiber (require_admin). Regeln: app/libs/briefaktion.py. Jeder Eingriff steht im
Protokoll, kein Code.
"""

from typing import List

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from app.auth import AuthorizedUser
from app.libs import briefaktion as ba
from app.libs import protokoll
from app.libs import verzeichnis as vz
from app.libs.konten import _plain

router = APIRouter()


@router.get("/betreiber/briefe")
def uebersicht() -> dict:
    now = vz.now()
    liste = ba.sperrliste()
    entries = [e for e in vz.store().alle() if not e.get("shopId")]
    s = ba.einstellungen()
    rows = sorted((ba.zeile(e, liste, now) for e in entries), key=lambda r: (r["postalCode"], r["name"].lower()))
    return _plain({
        "einstellungen": s,
        "monat": {"kosten": ba.monatskosten(now), "grenze": s["proMonat"]},
        "eintraege": rows,
        "wellen": ba.wellen(entries),
        "erinnerungTage": ba.ERINNERUNG_TAGE,
    })


class EinstellungenRequest(BaseModel):
    proWelle: int
    proMonat: float
    preis: float


@router.post("/betreiber/briefe/einstellungen")
def einstellungen(body: EinstellungenRequest, user: AuthorizedUser) -> dict:
    vorher = ba.einstellungen()
    try:
        neu = ba.einstellungen_speichern(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    protokoll.write(user, "Briefe: Einstellungen geändert", {"briefe": "einstellungen"}, before=vorher, after=neu)
    return neu


class WelleRequest(BaseModel):
    art: str
    ids: List[str]


def _gruenderplaetze() -> int:
    from app.apis.billing import founders_left

    return founders_left()


@router.post("/betreiber/briefe/welle")
def welle(body: WelleRequest, user: AuthorizedUser) -> Response:
    from app import seo

    if body.art not in ba.ARTEN:
        raise HTTPException(status_code=400, detail="Art ist brief oder erinnerung.")
    if not body.ids or len(body.ids) > 2000:
        raise HTTPException(status_code=400, detail="Bitte Salons auswählen.")
    try:
        neu, pdf = ba.welle_erzeugen(body.ids, body.art, seo.public_url(), _gruenderplaetze())
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    protokoll.write(user, "Briefe: Welle erzeugt", {"welle": neu["id"]}, after={"art": neu["art"], "anzahl": neu["anzahl"], "kosten": neu["kosten"]})
    datum = neu["am"].astimezone(ba.brief.BERLIN).strftime("%Y-%m-%d")
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="Dranzeit-Briefe-{datum}-{"Erinnerung" if neu["art"] == "erinnerung" else "Brief"}-{neu["anzahl"]}.pdf"',
        "Cache-Control": "private, no-store",
        "X-Welle": neu["id"],
    })


def _schritt(welle_id: str, user, fn, aktion: str) -> dict:
    try:
        w = fn(welle_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Diese Welle gibt es nicht.") from e
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    protokoll.write(user, aktion, {"welle": welle_id}, after={"art": w.get("art"), "anzahl": w.get("anzahl")})
    return {"ok": True, "status": w["status"]}


@router.post("/betreiber/briefe/welle/{welle_id}/hochgeladen")
def hochgeladen(welle_id: str, user: AuthorizedUser) -> dict:
    return _schritt(welle_id, user, ba.hochgeladen, "Briefe: Welle hochgeladen")


@router.post("/betreiber/briefe/welle/{welle_id}/verwerfen")
def verwerfen(welle_id: str, user: AuthorizedUser) -> dict:
    return _schritt(welle_id, user, ba.verwerfen, "Briefe: Welle verworfen")
