"""Salon-Verzeichnis, öffentlicher Teil (ohne Anmeldung): Karte, „Wünsch ich mir“, Eintrag entfernen.

    GET  /routes/verzeichnis/karte           Salons ohne Dranzeit mit Lage, für die Karte (/shop-map)
    POST /routes/verzeichnis/{id}/wunsch     Kunde wünscht sich Online-Nummern bei diesem Salon (zählt nur)
    POST /routes/verzeichnis/{id}/entfernen  Jemand vom Salon nimmt den Eintrag offline (Formular auf der Seite)

Die Seiten selbst liefert app/verzeichnis_seiten.py. Grund und Kontakt beim Entfernen stehen nur im Protokoll auf
dem Server (app/libs/protokoll.py), nicht in Firestore. IP-Adressen werden nur gehasht und nur im Speicher gezählt.
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

from app.libs import protokoll
from app.libs import verzeichnis as vz

router = APIRouter()

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
_lock = threading.Lock()
_calls: dict = defaultdict(deque)
LIMITS = {  # (Anzahl, Sekunden) je IP
    "wunsch": (30, 3600),
    "entfernen": (5, 86400),
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
