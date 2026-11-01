"""Salon-Verzeichnis, öffentlicher Teil (ohne Anmeldung): Karte, „Wünsch ich mir“, Eintrag entfernen, Übernahme.

    GET  /routes/verzeichnis/karte                   Salons ohne Dranzeit mit Lage, für die Karte (/shop-map)
    GET  /routes/verzeichnis/laden/{shopId}          Seite eines Dranzeit-Ladens im Verzeichnis (Canonical der Ladenansicht)
    POST /routes/verzeichnis/{id}/wunsch             Kunde wünscht sich Online-Nummern bei diesem Salon (zählt nur)
    POST /routes/verzeichnis/{id}/entfernen          Formular auf der Seite: Link an die Salon-Adresse, sonst prüft der Betreiber
    GET  /routes/verzeichnis/{id}/entfernen/bestaetigen  Link aus der Mail: zeigt nur den Knopf
    POST /routes/verzeichnis/{id}/entfernen/bestaetigen  Der Knopf: Erst hier geht der Eintrag offline (app/libs/entfernen.py)
    GET  /routes/verzeichnis/{id}/vorschau           Angaben der Seite für den Einrichtungsassistenten („Ist das dein Salon?“)
    POST /routes/verzeichnis/uebernahme/pruefen      Übernahme-Code aus dem Brief: zu welcher Seite gehört er?
    POST /routes/verzeichnis/uebernahme/einloesen    Code einlösen (angemeldet, eigener Laden): Seite wird die des Ladens
    POST /routes/verzeichnis/uebernahme/nachweis     Ohne Code, ohne Konto: Link mit Code an die Salon-Adresse (app/libs/uebernahme_mail.py)
    POST /routes/verzeichnis/uebernahme/anfragen     Ohne Code (angemeldet, eigener Laden): Vorschlag + Mail an den Betreiber

Die Seiten selbst liefert app/verzeichnis_seiten.py, die Übernahme app/libs/uebernahme.py. Die Adresse beim Entfernen und
beim Nachweis und der Grund stehen nur im Protokoll auf dem Server (app/libs/protokoll.py), nicht in Firestore. IP-Adressen werden nur
gehasht und nur im Speicher gezählt.
"""

import hashlib
import re
import threading
import time
import traceback
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from urllib.parse import parse_qs

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.libs import entfernen as ent
from app.libs import protokoll
from app.libs import uebernahme as ue
from app.libs import uebernahme_mail as ue_mail
from app.libs import verzeichnis as vz

router = APIRouter()

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
_lock = threading.Lock()
_calls: dict = defaultdict(deque)
LIMITS = {  # (Anzahl, Sekunden) je IP bzw. Konto
    "wunsch": (30, 3600),
    "entfernen": (5, 86400),
    "entfernen-gleich": (1, 3600),  # dieselbe Anfrage noch einmal zählt nicht
    "entfernen-link": (1, 3600),  # Bestätigungsmails je Eintrag
    "entfernen-mails": (60, 86400),  # alle Mails von Entfernen und Nachweis zusammen, damit niemand über uns Salons oder den Betreiber eindeckt
    "entfernen-obergrenze": (1, 86400),  # Hinweis an den Betreiber, dass die Obergrenze erreicht ist
    "code": (20, 3600),
    "einloesen": (10, 3600),
    "anfrage": (10, 3600),
    "nachweis": (5, 86400),
    "nachweis-gleich": (1, 3600),
    "nachweis-link": (1, 3600),  # Mails mit Link je Eintrag
}
_arbeit = ThreadPoolExecutor(max_workers=4, thread_name_prefix="verzeichnis")  # begrenzt; ein Neustart wartet, bis sie fertig sind
_wuensche: dict = {"tag": None, "schon": set()}  # je Person und Tag zählt ein Wunsch einmal; um Mitternacht vergessen


class _Bot:
    """Wer im Protokoll steht, wenn jemand über das Formular auf der Seite kommt (kein Konto)"""
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


def _frei(kind: str, who: str) -> bool:
    try:
        _limit(kind, who)
    except HTTPException:
        return False
    return True


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


def _formular(body: bytes) -> dict:
    return parse_qs(body.decode("utf-8", errors="replace")[:5000])


def _feld(form: dict, name: str, limit: int) -> str:
    return (form.get(name) or [""])[0].strip()[:limit]


def _melden(melde, *args) -> None:
    if _frei("entfernen-mails", "alle"):
        melde(*args)
    elif _frei("entfernen-obergrenze", "alle"):
        ent.obergrenze_melden()


def _adresse_pruefen(entry: dict, email: str, bremse: str, schicke) -> str:
    """Der Nachweis, gleich beim Entfernen und Übernehmen: Eine passende Adresse bekommt einen Link. Scheitert etwas, erfährt es der Betreiber trotzdem."""
    try:
        if not ent.eigene_domain(entry):
            return "keine_webseite"
        if not ent.adresse_passt(entry, email):
            return "passt_nicht"
        if not (_frei(bremse, entry["id"]) and _frei("entfernen-mails", "alle")):
            return "gebremst"
        return "link" if schicke(entry, email) else "nicht_verschickt"
    except Exception:
        traceback.print_exc()
        return "nicht_verschickt"


def _im_hintergrund(fn, *args) -> None:
    """Läuft weiter, auch wenn der Browser die Verbindung abbricht. Fehler stehen im Log."""

    def lauf() -> None:
        try:
            fn(*args)
        except Exception:
            traceback.print_exc()

    _arbeit.submit(lauf)


def _entfernen_bearbeiten(entry: dict, email: str, grund: str, art: str) -> None:
    """Im Hintergrund, weil das Lesen der Salon-Webseite Sekunden dauert: Im Echttest (01.11.2026) blieb die Seite stehen, und
    zehn Klicks in 15 Sekunden verbrauchten die Tagesgrenze."""
    ergebnis = "korrektur" if art == "korrektur" else _adresse_pruefen(entry, email, "entfernen-link", ent.link_schicken)
    protokoll.write(_Bot(), "Verzeichnis: Korrektur gemeldet" if art == "korrektur" else "Verzeichnis: Entfernen angefragt",
                    {"verzeichnisId": entry["id"], "name": entry.get("name")}, grund,
                    after={"kontakt": email, "ergebnis": ergebnis, "pfad": vz.pfad(entry)})
    _melden(ent.anfrage_melden, entry, email, grund, ergebnis)


def _entfernen_anfrage(entry_id: str, who: str, email: str, grund: str, aktion: str) -> HTMLResponse:
    from app import verzeichnis_seiten as seiten

    entry = _online_eintrag(entry_id)
    if not ent.adresse_gueltig(email):
        return HTMLResponse(seiten.render_anfrage("adresse_fehlt", entry), status_code=400)
    art = "korrektur" if aktion == "korrigieren" else "entfernen"
    if art == "korrektur" and not grund:
        return HTMLResponse(seiten.render_anfrage("grund_fehlt", entry), status_code=400)
    # Dieselbe Anfrage noch einmal (ungeduldig geklickt) bekommt dieselbe Antwort, zählt aber nicht und löst nichts aus
    gleich = f"{who}:{entry_id}:{email}:{art}"
    if _frei("entfernen-gleich", gleich):
        if not _frei("entfernen", who):
            _calls.pop(("entfernen-gleich", gleich), None)  # nicht bearbeitet: Auch der nächste Klick darf nicht „angekommen“ sagen
            return HTMLResponse(seiten.render_anfrage("zu_viele", entry), status_code=429)
        _im_hintergrund(_entfernen_bearbeiten, entry, email, grund, art)
    return HTMLResponse(seiten.render_anfrage(art, entry, email))


@router.post("/verzeichnis/{entry_id}/entfernen")
async def entfernen(entry_id: str, request: Request) -> HTMLResponse:
    """Das Formular allein ändert nichts am Eintrag: Die Antwort kommt sofort, geprüft wird im Hintergrund. Eine passende Adresse
    bekommt einen Link, sonst prüft der Betreiber."""
    form = _formular(await request.body())
    return await run_in_threadpool(_entfernen_anfrage, entry_id, _ip(request), _feld(form, "email", 201).lower(),
                                   _feld(form, "grund", 1000), _feld(form, "aktion", 20))


def _link_pruefen(entry_id: str, token: str) -> tuple:
    """(Eintrag, None) bei gültigem Link, sonst (None, Antwort)"""
    from app import verzeichnis_seiten as seiten

    entry = vz.store().hole(entry_id) if ID_RE.fullmatch(entry_id or "") else None
    if ent.link_gilt(entry, token):
        return entry, None
    if entry and entry.get("status") == "entfernt":
        return None, HTMLResponse(seiten.render_entfernt(entry.get("name", "")))
    return None, HTMLResponse(seiten.render_link_ungueltig(), status_code=410)


@router.get("/verzeichnis/{entry_id}/entfernen/bestaetigen")
def entfernen_knopf(entry_id: str, t: str = "") -> HTMLResponse:
    """Zeigt nur den Knopf und ändert nichts: Mail-Programme rufen Links zum Prüfen von selbst auf."""
    from app import verzeichnis_seiten as seiten

    entry, antwort = _link_pruefen(entry_id, t)
    if antwort:
        return antwort
    return HTMLResponse(seiten.render_entfernen_knopf(entry, t), headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


def _entfernen_bestaetigt(entry_id: str, token: str) -> HTMLResponse:
    from app import verzeichnis_seiten as seiten

    entry, antwort = _link_pruefen(entry_id, token)
    if antwort:
        return antwort
    ent.offline_nehmen(entry)
    protokoll.write(_Bot(), "Verzeichnis: vom Salon entfernt", {"verzeichnisId": entry_id, "name": entry.get("name")},
                    after={"nachweis": "Link an die Salon-Adresse", "pfad": vz.pfad(entry)})
    seiten.vergessen()
    _im_hintergrund(ent.entfernt_melden, entry)
    return HTMLResponse(seiten.render_entfernt(entry.get("name", "")))


@router.post("/verzeichnis/{entry_id}/entfernen/bestaetigen")
async def entfernen_bestaetigt(entry_id: str, request: Request) -> HTMLResponse:
    form = _formular(await request.body())
    return await run_in_threadpool(_entfernen_bestaetigt, entry_id, _feld(form, "t", 100))


# --- Übernahme: der Salon macht seine Seite zum Dranzeit-Laden (app/libs/uebernahme.py) -------------------------------


@router.get("/verzeichnis/{entry_id}/vorschau")
def vorschau(entry_id: str) -> JSONResponse:
    """Angaben einer Seite für den Einrichtungsassistenten – dieselben, die öffentlich auf der Seite stehen"""
    entry = _online_eintrag(entry_id)
    return JSONResponse({**ue.vorschau(entry), "domain": ent.eigene_domain(entry)}, headers={"Cache-Control": "no-store"})


class CodeRequest(BaseModel):
    code: str


class EinloesenRequest(BaseModel):
    code: str
    shopId: str


class AnfrageRequest(BaseModel):
    eintragId: str
    shopId: str


class NachweisRequest(BaseModel):
    eintragId: str
    email: str


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
def code_einloesen(body: EinloesenRequest, request: Request, background: BackgroundTasks, user: AuthorizedUser) -> dict:
    """Nach dem Anlegen des Ladens: Seite und Laden verknüpfen, ohne dass der Betreiber bestätigt"""
    _limit("code", _ip(request))
    _limit("einloesen", user.sub)
    shop = _eigener_laden(user, body.shopId)
    try:
        entry = ue.einloesen(body.code, shop["id"])
    except ue.Fehler as e:
        raise _ue_fehler(e) from e
    weg = "Link an die Salon-Adresse" if ue.per_mail(entry, body.code) else "Code aus dem Brief"
    protokoll.write(user, "Verzeichnis: per Code übernommen", {"verzeichnisId": entry["id"], "shopId": shop["id"], "name": shop.get("name")},
                    before={"name": entry.get("name"), "status": entry.get("status")}, after={"pfad": vz.pfad(entry), "nachweis": weg})
    from app import verzeichnis_seiten

    verzeichnis_seiten.vergessen()
    background.add_task(ue_mail.uebernommen_melden, entry, shop, getattr(user, "email", "") or "", weg)
    return {"ok": True, "pfad": vz.pfad(entry)}


def _nachweis_bearbeiten(entry: dict, email: str) -> None:
    """Im Hintergrund wie beim Entfernen, das Lesen der Salon-Webseite dauert Sekunden"""
    ergebnis = _adresse_pruefen(entry, email, "nachweis-link", ue_mail.link_schicken)
    protokoll.write(_Bot(), "Verzeichnis: Übernahme per E-Mail angefragt", {"verzeichnisId": entry["id"], "name": entry.get("name")},
                    after={"kontakt": email, "ergebnis": ergebnis, "pfad": vz.pfad(entry)})
    _melden(ue_mail.anfrage_melden, entry, email, ergebnis)


@router.post("/verzeichnis/uebernahme/nachweis")
def nachweis(body: NachweisRequest, request: Request) -> dict:
    """Ohne Konto: Das Formular allein ändert nichts. Die Antwort kommt sofort und nennt das Ergebnis nicht; eine passende Adresse
    bekommt einen Link mit Code, sonst prüft der Betreiber. Dieselbe Anfrage noch einmal zählt nicht und löst nichts aus."""
    entry = _online_eintrag(body.eintragId)
    email = body.email.strip().lower()[:201]
    if not ent.adresse_gueltig(email):
        raise HTTPException(status_code=400, detail="Bitte gib eine gültige E-Mail-Adresse an.")
    who = _ip(request)
    gleich = f"{who}:{entry['id']}:{email}"
    if _frei("nachweis-gleich", gleich):
        if not _frei("nachweis", who):
            _calls.pop(("nachweis-gleich", gleich), None)  # nicht bearbeitet: Auch der nächste Klick darf nicht „angekommen“ sagen
            raise HTTPException(status_code=429, detail="Zu viele Anfragen. Bitte später noch einmal.")
        _im_hintergrund(_nachweis_bearbeiten, entry, email)
    return {"ok": True}


@router.post("/verzeichnis/uebernahme/anfragen")
def anfragen(body: AnfrageRequest, background: BackgroundTasks, user: AuthorizedUser) -> dict:
    """Ohne Code und ohne passende Adresse: Der Inhaber fragt an, ob die Seite die seines Ladens wird. Der Betreiber bestätigt den
    Vorschlag im Betreiber-Bereich und bekommt dazu eine Mail. Dieselbe Anfrage noch einmal schickt keine zweite Mail."""
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
    from app.libs.mail import an_betreiber, esc, public_url

    adresse = lambda d: ", ".join(x for x in (d.get("street"), " ".join(y for y in (d.get("postalCode"), d.get("city")) if y)) if x)  # noqa: E731
    base = public_url()
    seite = f"{base}{vz.pfad(entry)}"
    laden = " · ".join(x for x in (shop.get("name"), adresse(shop), shop.get("phone"), email) if x)
    salon = " · ".join(x for x in (entry.get("name"), adresse(entry), entry.get("phone")) if x)
    pruefen = ("Gleiche Angaben beweisen nichts, der Assistent übernimmt sie aus der Seite. Ruf vor dem Bestätigen die Nummer von der Seite an. "
               "Stimmt es, bestätige im Betreiber-Bereich unter „Verzeichnis“, sonst lehne ab. Bis dahin bleibt die Seite grau.")
    absaetze = [
        "Ein Laden möchte eine Seite aus dem Salon-Verzeichnis übernehmen, ohne Code aus einem Brief und ohne Nachweis per E-Mail.",
        f"<strong>Laden:</strong> {esc(laden)}",
        f"<strong>Seite:</strong> <a href=\"{esc(seite)}\">{esc(salon)}</a>",
        pruefen,
    ]
    ziel = f"{base}/betreiber?reiter=verzeichnis"
    text = (f"Ein Laden möchte eine Seite aus dem Salon-Verzeichnis übernehmen, ohne Code aus einem Brief und ohne Nachweis per E-Mail.\n\nLaden: {laden}\n"
            f"Seite: {salon}\n{seite}\n\n{pruefen}\n\nBestätigen oder ablehnen: {ziel}\n")
    betreff = " ".join(f"Übernahme angefragt: {entry.get('name') or ''}".split())
    an_betreiber(betreff, "Übernahme angefragt", absaetze, text, "Im Betreiber-Bereich prüfen", ziel)
