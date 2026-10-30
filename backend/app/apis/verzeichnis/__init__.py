"""Salon-Verzeichnis, öffentlicher Teil (ohne Anmeldung): Karte, „Wünsch ich mir“, Eintrag entfernen, Übernahme.

    GET  /routes/verzeichnis/karte                   Salons ohne Dranzeit mit Lage, für die Karte (/shop-map)
    GET  /routes/verzeichnis/laden/{shopId}          Seite eines Dranzeit-Ladens im Verzeichnis (Canonical der Ladenansicht)
    POST /routes/verzeichnis/{id}/wunsch             Kunde wünscht sich Online-Nummern bei diesem Salon (zählt nur)
    POST /routes/verzeichnis/{id}/entfernen          Jemand vom Salon nimmt den Eintrag offline (Formular auf der Seite)
    GET  /routes/verzeichnis/{id}/vorschau           Angaben der Seite für den Einrichtungsassistenten („Ist das dein Salon?“)
    POST /routes/verzeichnis/uebernahme/pruefen      Übernahme-Code aus dem Brief: zu welcher Seite gehört er?
    POST /routes/verzeichnis/uebernahme/einloesen    Code einlösen (angemeldet, eigener Laden): Seite wird die des Ladens
    POST /routes/verzeichnis/uebernahme/anfragen     Ohne Code (angemeldet, eigener Laden): Vorschlag + Mail an den Betreiber

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

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
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
    "anfrage": (10, 3600),
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


class AnfrageRequest(BaseModel):
    eintragId: str
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


def _eigener_laden(user, shop_id: str) -> dict:
    if not ID_RE.fullmatch(shop_id or ""):
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht mehr.")
    require_shop_of_owner(user, shop_id)
    shop = _laden(shop_id)
    if not shop:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht mehr.")
    return shop


@router.post("/verzeichnis/uebernahme/einloesen")
def code_einloesen(body: EinloesenRequest, request: Request, user: AuthorizedUser) -> dict:
    """Nach dem Anlegen des Ladens: Seite und Laden verknüpfen, ohne dass der Betreiber bestätigt"""
    _limit("code", _ip(request))
    _limit("einloesen", user.sub)
    shop = _eigener_laden(user, body.shopId)
    try:
        entry = ue.einloesen(body.code, shop["id"])
    except ue.Fehler as e:
        raise _ue_fehler(e) from e
    protokoll.write(user, "Verzeichnis: per Code übernommen", {"verzeichnisId": entry["id"], "shopId": shop["id"], "name": shop.get("name")},
                    before={"name": entry.get("name"), "status": entry.get("status")}, after={"pfad": vz.pfad(entry)})
    from app import verzeichnis_seiten

    verzeichnis_seiten.vergessen()
    return {"ok": True, "pfad": vz.pfad(entry)}


@router.post("/verzeichnis/uebernahme/anfragen")
def anfragen(body: AnfrageRequest, background: BackgroundTasks, user: AuthorizedUser) -> dict:
    """Ohne Code: Der Inhaber fragt an, ob die Seite die seines Ladens wird. Der Betreiber bestätigt den Vorschlag im
    Betreiber-Bereich und bekommt dazu eine Mail. Dieselbe Anfrage noch einmal schickt keine zweite Mail."""
    _limit("anfrage", user.sub)
    shop = _eigener_laden(user, body.shopId)
    entry = _online_eintrag(body.eintragId)
    if shop["id"] in (entry.get("abgelehnt") or []):
        raise HTTPException(status_code=409, detail="Diese Seite gehört nach unserer Prüfung zu einem anderen Salon. Schreib uns an hilfe@dranzeit.de, wenn das nicht stimmt.")
    pfad = vz.pfad(entry)
    if (entry.get("anfrage") or {}).get("shopId") == shop["id"]:
        return {"ok": True, "pfad": pfad}
    jetzt = vz.now()
    vz.store().aendere(entry["id"], {
        "anfrage": {"shopId": shop["id"], "am": jetzt},
        "vorschlag": {"shopId": shop["id"], "name": shop.get("name", ""), "grund": vz.GRUND_ANFRAGE, "am": jetzt},
    })
    protokoll.write(user, "Verzeichnis: Übernahme angefragt", {"verzeichnisId": entry["id"], "shopId": shop["id"], "name": shop.get("name")},
                    before={"name": entry.get("name"), "vorher": (entry.get("anfrage") or {}).get("shopId")}, after={"pfad": pfad})
    from app import verzeichnis_seiten

    verzeichnis_seiten.vergessen()
    background.add_task(anfrage_melden, entry, shop, getattr(user, "email", "") or "")
    return {"ok": True, "pfad": pfad}


def anfrage_melden(entry: dict, shop: dict, email: str) -> None:
    """Mail an die Betreiber (QME_ADMIN_EMAILS): Eine Übernahme ohne Code wartet auf Bestätigung"""
    from app.auth.access import admin_lists
    from app.libs.mail import MailError, branded_html, esc, public_url, send_mail

    an = sorted(a for a in admin_lists()[0] if "@" in a)
    if not an:
        print(f"Übernahme angefragt, aber kein Betreiber in QME_ADMIN_EMAILS: {entry.get('id')} ← Laden {shop.get('id')}")
        return
    adresse = lambda d: ", ".join(x for x in (d.get("street"), " ".join(y for y in (d.get("postalCode"), d.get("city")) if y)) if x)  # noqa: E731
    base = public_url()
    seite = f"{base}{vz.pfad(entry)}"
    laden = " · ".join(x for x in (shop.get("name"), adresse(shop), shop.get("phone"), email) if x)
    salon = " · ".join(x for x in (entry.get("name"), adresse(entry), entry.get("phone")) if x)
    absaetze = [
        "Ein Laden möchte eine Seite aus dem Salon-Verzeichnis übernehmen, ohne Code aus einem Brief.",
        f"<strong>Laden:</strong> {esc(laden)}",
        f"<strong>Seite:</strong> <a href=\"{esc(seite)}\">{esc(salon)}</a>",
        "Ist es derselbe Salon? Dann bestätige im Betreiber-Bereich unter „Verzeichnis“, sonst lehne ab. Bis dahin bleibt die Seite grau.",
    ]
    ziel = f"{base}/betreiber?reiter=verzeichnis"
    text = (f"Ein Laden möchte eine Seite aus dem Salon-Verzeichnis übernehmen, ohne Code aus einem Brief.\n\nLaden: {laden}\n"
            f"Seite: {salon}\n{seite}\n\nBestätigen oder ablehnen: {ziel}\n")
    betreff = " ".join(f"Übernahme angefragt: {entry.get('name') or ''}".split())
    for to in an:
        try:
            send_mail(to, betreff, branded_html("Übernahme angefragt", absaetze, "Im Betreiber-Bereich prüfen", ziel), text)
        except MailError as e:
            print(f"Mail „Übernahme angefragt“ an {to} nicht verschickt: {e}")
