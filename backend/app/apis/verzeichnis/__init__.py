"""Salon-Verzeichnis, öffentlicher Teil (ohne Anmeldung): Karte, „Wünsch ich mir“, Eintrag entfernen, Übernahme.

    GET  /routes/verzeichnis/karte                   Salons ohne Dranzeit mit Lage, für die Karte (/shop-map)
    GET  /routes/verzeichnis/laden/{shopId}          Seite eines Dranzeit-Ladens im Verzeichnis (Canonical der Ladenansicht)
    POST /routes/verzeichnis/{id}/wunsch             Kunde wünscht sich Online-Nummern bei diesem Salon (zählt nur)
    POST /routes/verzeichnis/{id}/entfernen          Jemand vom Salon nimmt den Eintrag offline (Formular auf der Seite)
    GET  /routes/verzeichnis/{id}/vorschau           Angaben der Seite für den Einrichtungsassistenten („Ist das dein Salon?“)
    POST /routes/verzeichnis/uebernahme/pruefen      Übernahme-Code aus dem Brief: zu welcher Seite gehört er?
    POST /routes/verzeichnis/uebernahme/einloesen    Code einlösen (angemeldet, eigener Laden): Seite wird die des Ladens

Die Seiten selbst liefert app/verzeichnis_seiten.py, die Übernahme app/libs/uebernahme.py. Grund und Kontakt beim
Entfernen stehen nur im Protokoll auf dem Server (app/libs/protokoll.py), nicht in Firestore. IP-Adressen werden nur
gehasht und nur im Speicher gezählt.
"""

import hashlib
import re
import threading
import time
from collections import defaultdict, deque
from datetime import date
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.libs import protokoll
from app.libs import uebernahme as ue
from app.libs import verzeichnis as vz

router = APIRouter()

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
_lock = threading.Lock()
_calls: dict = defaultdict(deque)
LIMITS = {  # (Anzahl, Sekunden) je IP bzw. Konto
    "wunsch": (30, 3600),
    "entfernen": (5, 86400),
    "code": (20, 3600),
    "einloesen": (10, 3600),
}
_wuensche: dict = {"tag": None, "schon": set()}  # je Person und Tag zählt ein Wunsch einmal; um Mitternacht vergessen


class _Bot:
    """Wer im Protokoll steht, wenn jemand vom Salon den Eintrag entfernt (kein Konto)"""
    email = "Salon (Formular auf der Seite)"
    sub = ""


def _ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    return hashlib.sha256(f"{date.today().isoformat()}:{ip}".encode()).hexdigest()[:16]


def _limit(kind: str, who: str) -> None:
    count, seconds = LIMITS[kind]
    now = time.time()
    with _lock:
        calls = _calls[(kind, who)]
        while calls and now - calls[0] > seconds:
            calls.popleft()
        if len(calls) >= count:
            raise HTTPException(status_code=429, detail="Zu viele Anfragen. Bitte später noch einmal.")
        calls.append(now)


def _online_eintrag(entry_id: str) -> dict:
    if not ID_RE.fullmatch(entry_id or ""):
        raise HTTPException(status_code=404, detail="Diesen Eintrag gibt es nicht.")
    entry = vz.store().hole(entry_id)
    if not entry or entry.get("status") != "online" or entry.get("shopId"):
        raise HTTPException(status_code=404, detail="Diesen Eintrag gibt es nicht.")
    return entry


def _wants_html(request: Request) -> bool:
    return "text/html" in request.headers.get("accept", "") or "form" in request.headers.get("content-type", "")


@router.get("/verzeichnis/karte")
def karte() -> JSONResponse:
    """Salons ohne Dranzeit (online, mit Lage) für die Karte. Dranzeit-Läden lädt die Karte selbst."""
    from app import verzeichnis_seiten

    rows = [
        {
            "id": s["id"], "name": s["name"], "kategorie": s["kategorie"], "street": s.get("street") or "",
            "postalCode": s.get("postalCode") or "", "city": s.get("city") or "", "ortsteil": s.get("ortsteil") or "",
            "latitude": s["coordinates"]["latitude"], "longitude": s["coordinates"]["longitude"], "pfad": s["pfad"],
        }
        for s in verzeichnis_seiten.daten()["seiten"]
        if s["typ"] == "eintrag" and s.get("coordinates")
    ]
    return JSONResponse({"salons": rows}, headers={"Cache-Control": "public, max-age=60"})


@router.get("/verzeichnis/laden/{shop_id}")
def laden_seite(shop_id: str) -> JSONResponse:
    """Die Ladenansicht der App (/shop-details) zeigt per Canonical auf diese Seite, damit Google nur eine nimmt."""
    from app import verzeichnis_seiten

    pfad = verzeichnis_seiten.laden_pfade().get(shop_id) if ID_RE.fullmatch(shop_id or "") else None
    if not pfad:
        raise HTTPException(status_code=404, detail="Dieser Laden hat keine Seite im Verzeichnis.")
    return JSONResponse({"pfad": pfad}, headers={"Cache-Control": "public, max-age=300"})


@router.post("/verzeichnis/{entry_id}/wunsch")
def wunsch(entry_id: str, request: Request):
    entry = _online_eintrag(entry_id)
    who = _ip(request)
    _limit("wunsch", who)
    with _lock:
        if _wuensche["tag"] != date.today():
            _wuensche.update(tag=date.today(), schon=set())
        neu = (who, entry_id) not in _wuensche["schon"]
        _wuensche["schon"].add((who, entry_id))
    if neu:
        vz.store().wunsch(entry_id)
        from app import verzeichnis_seiten

        verzeichnis_seiten.vergessen()
    if _wants_html(request):
        return RedirectResponse(f"{vz.pfad(entry)}?gewuenscht=1#wunsch", status_code=303)
    return {"ok": True}


@router.post("/verzeichnis/{entry_id}/entfernen")
async def entfernen(entry_id: str, request: Request):
    entry = _online_eintrag(entry_id)
    _limit("entfernen", _ip(request))
    form = parse_qs((await request.body()).decode("utf-8", errors="replace")[:5000])
    field = lambda name, limit: (form.get(name) or [""])[0].strip()[:limit]  # noqa: E731
    if field("inhaber", 10) != "ja":
        raise HTTPException(status_code=400, detail="Bitte bestätigen, dass du zu diesem Salon gehörst.")
    vz.store().aendere(entry_id, {"status": "entfernt", "entferntAm": vz.now(), "geaendertAm": vz.now()})
    protokoll.write(_Bot(), "Verzeichnis: vom Salon entfernt", {"verzeichnisId": entry_id, "name": entry.get("name")},
                    field("grund", 1000), after={"kontakt": field("kontakt", 200), "pfad": vz.pfad(entry)})
    from app import verzeichnis_seiten

    verzeichnis_seiten.vergessen()
    if _wants_html(request):
        return HTMLResponse(verzeichnis_seiten.render_entfernt(entry.get("name", "")))
    return {"ok": True}


# --- Übernahme: der Salon macht seine Seite zum Dranzeit-Laden (app/libs/uebernahme.py) -------------------------------


@router.get("/verzeichnis/{entry_id}/vorschau")
def vorschau(entry_id: str) -> JSONResponse:
    """Angaben einer Seite für den Einrichtungsassistenten – dieselben, die öffentlich auf der Seite stehen"""
    entry = _online_eintrag(entry_id)
    return JSONResponse(ue.vorschau(entry), headers={"Cache-Control": "no-store"})


class CodeRequest(BaseModel):
    code: str


class EinloesenRequest(BaseModel):
    code: str
    shopId: str


def _ue_fehler(e: ue.Fehler) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.text)


@router.post("/verzeichnis/uebernahme/pruefen")
def code_pruefen(body: CodeRequest, request: Request) -> dict:
    """Zu welcher Seite gehört der Code? Zählt jeden Versuch (Raten bremsen)."""
    _limit("code", _ip(request))
    try:
        entry = ue.pruefen(body.code)
    except ue.Fehler as e:
        raise _ue_fehler(e) from e
    return {"code": ue.anzeigen(body.code), "eintrag": ue.vorschau(entry)}


def _laden(shop_id: str) -> dict:
    from app.apis.firebase_utils import get_firestore_db

    snap = get_firestore_db().collection("shops").document(shop_id).get()
    return {**(snap.to_dict() or {}), "id": snap.id} if snap.exists else {}


@router.post("/verzeichnis/uebernahme/einloesen")
def code_einloesen(body: EinloesenRequest, request: Request, user: AuthorizedUser) -> dict:
    """Nach dem Anlegen des Ladens: Seite und Laden verknüpfen, ohne dass der Betreiber bestätigt"""
    _limit("code", _ip(request))
    _limit("einloesen", user.sub)
    if not ID_RE.fullmatch(body.shopId or ""):
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht mehr.")
    require_shop_of_owner(user, body.shopId)
    shop = _laden(body.shopId)
    if not shop:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht mehr.")
    try:
        entry = ue.einloesen(body.code, shop["id"])
    except ue.Fehler as e:
        raise _ue_fehler(e) from e
    protokoll.write(user, "Verzeichnis: per Code übernommen", {"verzeichnisId": entry["id"], "shopId": shop["id"], "name": shop.get("name")},
                    before={"name": entry.get("name"), "status": entry.get("status")}, after={"pfad": vz.pfad(entry)})
    from app import verzeichnis_seiten

    verzeichnis_seiten.vergessen()
    return {"ok": True, "pfad": vz.pfad(entry)}
