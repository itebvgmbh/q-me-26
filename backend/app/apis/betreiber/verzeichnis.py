"""Betreiber-Bereich, Reiter Verzeichnis: Salons finden, anlegen, prüfen, veröffentlichen, offline nehmen, löschen.

Hängt am Unter-Router `admin` aus app/apis/betreiber (require_admin). Ablauf und Regeln: app/libs/verzeichnis.py,
Import: app/libs/verzeichnis_import.py, Seiten: app/verzeichnis_seiten.py. Jeder Eingriff steht im Protokoll.
"""

import re
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.auth import AuthorizedUser
from app.libs import brief
from app.libs import protokoll
from app.libs import uebernahme as ue
from app.libs import verzeichnis as vz
from app.libs.links import public_origin
from app.libs import verzeichnis_import as imp
from app.libs.konten import _plain

router = APIRouter()

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
PLACE_RE = re.compile(r"[A-Za-z0-9_-]{10,300}")
FELDER = ("name", "kategorie", "street", "postalCode", "city", "ortsteil", "bezirk", "phone", "website", "beschreibung",
          "schwerpunkte", "services", "businessHoursByDay", "ohneTermin")


def _shops() -> list:
    from app import seo

    return seo.load_shops()


def _vergessen() -> None:
    from app import verzeichnis_seiten

    verzeichnis_seiten.vergessen()


def _eintrag(entry_id: str) -> dict:
    if not ID_RE.fullmatch(entry_id or ""):
        raise HTTPException(status_code=404, detail="Diesen Eintrag gibt es nicht.")
    entry = vz.store().hole(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Diesen Eintrag gibt es nicht mehr.")
    return entry


def zeile(e: dict, shops_by_id: dict) -> dict:
    shop = shops_by_id.get(e.get("shopId") or "")
    keep = ("id", "status", "shopId", "googlePlaceId", "slug", "stadtSlug", "altePfade", "coordinates", "quelle",
            "wuensche", "vorschlag", "angelegtAm", "geaendertAm", "veroeffentlichtAm", "entferntAm") + FELDER
    row = {k: e.get(k) for k in keep}
    code = e.get("uebernahme") or {}
    row.update({
        "uebernahme": {k: code.get(k) for k in ("erstelltAm", "gueltigBis", "eingeloestAm")} if code else None,
        "pfad": vz.pfad(e) if e.get("slug") and e.get("stadtSlug") else "",
        "fehlt": [] if e.get("shopId") else vz.vollstaendigkeit(e),
        "shopName": (shop or {}).get("name", ""),
        "shopFehlt": bool(e.get("shopId")) and not shop,
        "wuensche": int(e.get("wuensche") or 0),
    })
    return row


@router.get("/betreiber/verzeichnis")
def liste() -> dict:
    """Alle Einträge (auch Seiten echter Läden) mit offenen Übernahme-Vorschlägen; führt den Abgleich aus"""
    shops = _shops()
    entries = vz.abgleich_ausfuehren(vz.store().alle(), shops)
    by_id = {s["id"]: s for s in shops}
    rows = sorted((zeile(e, by_id) for e in entries), key=lambda r: ((r.get("city") or "").lower(), (r.get("name") or "").lower()))
    return _plain({
        "eintraege": rows,
        "status": {"google": bool(imp.google_key()), "ai": imp.ai_configured()},
    })


# --- Finden und anlegen --------------------------------------------------------------------------------------------


class SucheRequest(BaseModel):
    query: str
    pageToken: str = ""


@router.post("/betreiber/verzeichnis/suche")
def suche(body: SucheRequest) -> dict:
    """Google-Textsuche; jeder Treffer mit dem Hinweis, ob er schon im Verzeichnis oder bei Dranzeit ist"""
    query = body.query.strip()
    if len(query) < 3:
        raise HTTPException(status_code=400, detail="Bitte etwas genauer suchen, z. B. „Friseur Prenzlauer Berg“.")
    result = imp.google_suche(query, body.pageToken.strip())
    entries, shops = vz.store().alle(), _shops()
    for t in result["treffer"]:
        t.update(imp.bekannt(t, entries, shops))
    return result


class ImportRequest(BaseModel):
    website: str = ""
    placeId: str = ""
    name: str = ""
    address: str = ""
    eintragId: str = ""  # vorhandenen Eintrag neu von der Webseite lesen


@router.post("/betreiber/verzeichnis/import")
def importieren(body: ImportRequest, user: AuthorizedUser) -> dict:
    """Webseite lesen und als Entwurf anlegen – oder einen Eintrag neu lesen (überschreibt seine Angaben)"""
    place_id = body.placeId.strip()
    if place_id and not PLACE_RE.fullmatch(place_id):
        raise HTTPException(status_code=400, detail="Unbekannter Google-Eintrag.")
    entries = vz.store().alle()
    alt = _eintrag(body.eintragId) if body.eintragId else None
    if not alt and place_id:
        doppelt = next((e for e in entries if e.get("googlePlaceId") == place_id), None)
        if doppelt:
            raise HTTPException(status_code=409, detail=f"Schon im Verzeichnis: {doppelt.get('name')}.")
    website = body.website.strip() or (alt or {}).get("website", "")
    profil = imp.profil_von_webseite(website, body.name.strip()[:120] or (alt or {}).get("name", ""), body.address.strip()[:200])
    imp.mit_lage(profil)
    if alt:
        changes = {**profil, "geaendertAm": vz.now()}
        changes.update(_neue_adresse(alt, {**alt, **profil}, entries))
        vz.store().aendere(alt["id"], changes)
        protokoll.write(user, "Verzeichnis: neu gelesen", {"verzeichnisId": alt["id"], "name": profil.get("name")},
                        after={"website": website})
        entry_id = alt["id"]
    else:
        if place_id:
            profil["googlePlaceId"] = place_id
        entry = vz.neuer_eintrag(profil, entries)
        entry_id = vz.store().neu(entry)
        protokoll.write(user, "Verzeichnis: angelegt", {"verzeichnisId": entry_id, "name": entry.get("name")},
                        after={"website": website, "pfad": vz.pfad(entry)})
    _vergessen()
    return _plain(zeile(vz.store().hole(entry_id), {s["id"]: s for s in _shops()}))


# --- Bearbeiten ----------------------------------------------------------------------------------------------------


class Leistung(BaseModel):
    name: str
    category: str = ""
    price: float = 0
    priceFrom: bool = False


class Pause(BaseModel):
    startTime: str
    endTime: str


class Tag(BaseModel):
    dayOfWeek: int
    isOpen: bool
    openTime: str = "09:00"
    closeTime: str = "18:00"
    breaks: List[Pause] = []


class EintragDaten(BaseModel):
    name: Optional[str] = None
    kategorie: Optional[str] = None
    street: Optional[str] = None
    postalCode: Optional[str] = None
    city: Optional[str] = None
    ortsteil: Optional[str] = None
    bezirk: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    beschreibung: Optional[str] = None
    schwerpunkte: Optional[List[str]] = None
    services: Optional[List[Leistung]] = None
    businessHoursByDay: Optional[List[Tag]] = None
    ohneTermin: Optional[str] = None
    slug: Optional[str] = None


def _text(value: str, limit: int) -> str:
    return re.sub(r"\s+", " ", value or "").strip()[:limit]


def pruefen(body: EintragDaten) -> dict:
    """Eingaben aus dem Betreiber-Bereich bereinigen; nur gesetzte Felder"""
    d = body.model_dump(exclude_none=True)
    out: dict = {}
    for key, limit in (("name", 80), ("street", 80), ("city", 60), ("ortsteil", 60), ("bezirk", 60), ("phone", 40), ("website", 300)):
        if key in d:
            out[key] = _text(d[key], limit)
    if "beschreibung" in d:
        out["beschreibung"] = _text(d["beschreibung"], 800)
    if "postalCode" in d:
        plz = _text(d["postalCode"], 10)
        if plz and not re.fullmatch(r"\d{5}", plz):
            raise HTTPException(status_code=400, detail="Die PLZ hat fünf Ziffern.")
        out["postalCode"] = plz
    if "kategorie" in d:
        if d["kategorie"] not in vz.KATEGORIEN:
            raise HTTPException(status_code=400, detail="Kategorie ist friseur oder barbershop.")
        out["kategorie"] = d["kategorie"]
    if "ohneTermin" in d:
        out["ohneTermin"] = d["ohneTermin"] if d["ohneTermin"] in ("ja", "nein") else ""
    if "website" in out and out["website"] and not re.match(r"^https?://", out["website"]):
        out["website"] = "https://" + out["website"]
    if "schwerpunkte" in d:
        out["schwerpunkte"] = [x for x in (_text(s, 30) for s in d["schwerpunkte"]) if x][:6]
    if "services" in d:
        out["services"] = imp.leistungen_bereinigen(
            [{"name": s["name"], "kategorie": s["category"], "preis_eur": s["price"], "preis_ab": s["priceFrom"]} for s in d["services"]]
        )
    if "businessHoursByDay" in d:
        tage = []
        for t in d["businessHoursByDay"]:
            if not 0 <= t["dayOfWeek"] <= 6 or t["dayOfWeek"] in {x["dayOfWeek"] for x in tage}:
                continue
            open_, close = vz.uhrzeit(t["openTime"]), vz.uhrzeit(t["closeTime"])
            if t["isOpen"] and (not open_ or not close or close <= open_):
                raise HTTPException(status_code=400, detail=f"Öffnungszeit am {vz.TAGE[t['dayOfWeek']].title()} prüfen.")
            breaks = []
            for b in t["breaks"]:
                s, e = vz.uhrzeit(b["startTime"]), vz.uhrzeit(b["endTime"])
                if s and e and open_ < s < e < close:
                    breaks.append({"startTime": s, "endTime": e})
            tage.append({"dayOfWeek": t["dayOfWeek"], "isOpen": t["isOpen"], "openTime": open_ or "09:00",
                         "closeTime": close or "18:00", "breaks": breaks})
        out["businessHoursByDay"] = sorted(tage, key=lambda x: x["dayOfWeek"]) if any(x["isOpen"] for x in tage) else []
    if "slug" in d:
        slug = vz.slugify(d["slug"], 70)
        if not slug:
            raise HTTPException(status_code=400, detail="Die Adresse der Seite braucht Buchstaben oder Ziffern.")
        out["slug"] = slug
    return out


def _neue_adresse(alt: dict, neu: dict, entries: list) -> dict:
    """Neue Seiten-Adresse, wenn sich Stadt, Kategorie oder (gewünscht) Slug ändern; die alte leitet weiter.
    Entwürfe ohne veröffentlichte Adresse bekommen beim Umbenennen still einen neuen Slug."""
    changes: dict = {}
    stadt_slug = vz.slugify(neu.get("city") or "")
    andere = [e for e in entries if e.get("id") != alt.get("id")]
    slug = neu.get("slug") or alt.get("slug") or ""
    veroeffentlicht = bool(alt.get("veroeffentlichtAm"))
    if not veroeffentlicht and neu.get("name") != alt.get("name") and neu.get("slug") == alt.get("slug"):
        slug = vz.eindeutiger_slug(neu.get("name", ""), vz.belegte_slugs(andere, stadt_slug), neu.get("ortsteil", ""))
    elif slug in vz.belegte_slugs(andere, stadt_slug) or not slug:
        slug = vz.eindeutiger_slug(slug or neu.get("name", ""), vz.belegte_slugs(andere, stadt_slug), neu.get("ortsteil", ""))
    neuer_pfad = vz.pfad({**neu, "stadtSlug": stadt_slug, "slug": slug})
    alter_pfad = vz.pfad(alt) if alt.get("slug") and alt.get("stadtSlug") else ""
    if slug != alt.get("slug") or stadt_slug != alt.get("stadtSlug"):
        changes.update({"slug": slug, "stadtSlug": stadt_slug})
    if veroeffentlicht and alter_pfad and alter_pfad != neuer_pfad:
        changes["altePfade"] = sorted(set(alt.get("altePfade") or []) | {alter_pfad})
    return changes


@router.post("/betreiber/verzeichnis/neu")
def neu_von_hand(body: EintragDaten, user: AuthorizedUser) -> dict:
    """Salon ohne Webseite: Angaben von Hand (z. B. vom Ladenschild). Lage von OpenStreetMap."""
    daten = pruefen(body)
    daten.pop("slug", None)
    if not daten.get("name") or not daten.get("city"):
        raise HTTPException(status_code=400, detail="Mindestens Name und Ort angeben.")
    imp.mit_lage(daten)
    entries = vz.store().alle()
    entry = vz.neuer_eintrag(daten, entries)
    entry_id = vz.store().neu(entry)
    protokoll.write(user, "Verzeichnis: von Hand angelegt", {"verzeichnisId": entry_id, "name": entry["name"]})
    _vergessen()
    return _plain(zeile(vz.store().hole(entry_id), {}))


@router.post("/betreiber/verzeichnis/{entry_id}")
def speichern(entry_id: str, body: EintragDaten, user: AuthorizedUser) -> dict:
    alt = _eintrag(entry_id)
    changes = pruefen(body)
    neu = {**alt, **changes}
    if alt.get("shopId"):
        # Seite eines Dranzeit-Ladens: Inhalt pflegt der Laden selbst; hier nur Seite und Text
        changes = {k: v for k, v in changes.items() if k in ("kategorie", "ortsteil", "bezirk", "beschreibung", "schwerpunkte", "slug")}
        neu = {**alt, **changes}
    adresse_neu = any(changes.get(k) != alt.get(k) for k in ("street", "postalCode", "city") if k in changes)
    if adresse_neu and not alt.get("shopId"):
        geo = vz.lage(neu.get("street", ""), neu.get("postalCode", ""), neu.get("city", ""))
        if geo:
            changes["coordinates"] = geo["coordinates"]
            if "ortsteil" not in changes:
                changes["ortsteil"] = geo["ortsteil"]
            if "bezirk" not in changes:
                changes["bezirk"] = geo["bezirk"]
            neu = {**neu, **changes}
    changes.update(_neue_adresse(alt, neu, vz.store().alle()))
    changes["geaendertAm"] = vz.now()
    vz.store().aendere(entry_id, changes)
    protokoll.write(user, "Verzeichnis: geändert", {"verzeichnisId": entry_id, "name": neu.get("name")},
                    before={k: alt.get(k) for k in changes if k not in ("geaendertAm",)},
                    after={k: v for k, v in changes.items() if k != "geaendertAm"})
    _vergessen()
    return _plain(zeile(vz.store().hole(entry_id), {s["id"]: s for s in _shops()}))


class StatusRequest(BaseModel):
    status: str


@router.post("/betreiber/verzeichnis/{entry_id}/status")
def status(entry_id: str, body: StatusRequest, user: AuthorizedUser) -> dict:
    """online (veröffentlichen) | offline | entwurf"""
    entry = _eintrag(entry_id)
    if body.status not in ("online", "offline", "entwurf"):
        raise HTTPException(status_code=400, detail="Status ist online, offline oder entwurf.")
    if body.status == "online" and not entry.get("shopId"):
        fehlt = [x for x, ok in (("Name", entry.get("name")), ("Ort", entry.get("city")), ("Straße", entry.get("street"))) if not ok]
        if fehlt:
            raise HTTPException(status_code=400, detail=f"Zum Veröffentlichen fehlt: {', '.join(fehlt)}.")
    changes = {"status": body.status, "geaendertAm": vz.now()}
    if body.status == "online" and not entry.get("veroeffentlichtAm"):
        changes["veroeffentlichtAm"] = vz.now()
    vz.store().aendere(entry_id, changes)
    protokoll.write(user, f"Verzeichnis: {body.status}", {"verzeichnisId": entry_id, "name": entry.get("name")},
                    before={"status": entry.get("status")}, after={"status": body.status, "pfad": vz.pfad(entry)})
    _vergessen()
    return {"status": body.status}


@router.post("/betreiber/verzeichnis/{entry_id}/loeschen")
def loeschen(entry_id: str, user: AuthorizedUser) -> dict:
    entry = _eintrag(entry_id)
    if entry.get("shopId") and any(s["id"] == entry["shopId"] for s in _shops()):
        raise HTTPException(status_code=409, detail="Die Seite eines Dranzeit-Ladens nimmst du offline statt sie zu löschen.")
    vz.store().loesche(entry_id)
    protokoll.write(user, "Verzeichnis: gelöscht", {"verzeichnisId": entry_id, "name": entry.get("name")},
                    before={k: entry.get(k) for k in ("name", "street", "postalCode", "city", "website", "status", "googlePlaceId")})
    _vergessen()
    return {"deleted": True}


# --- Übernahme -----------------------------------------------------------------------------------------------------


class ShopRequest(BaseModel):
    shopId: str


@router.post("/betreiber/verzeichnis/{entry_id}/uebernahme")
def uebernahme(entry_id: str, body: ShopRequest, user: AuthorizedUser) -> dict:
    """Vorschlag bestätigen: Der Eintrag wird die Seite des Ladens, die Adresse bleibt."""
    entry = _eintrag(entry_id)
    if (entry.get("vorschlag") or {}).get("shopId") != body.shopId:
        raise HTTPException(status_code=409, detail="Dieser Vorschlag ist nicht mehr aktuell. Bitte neu laden.")
    shop = next((s for s in _shops() if s["id"] == body.shopId), None)
    if not shop:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht mehr.")
    vz.verknuepfen(entry, shop["id"], vz.store().alle())
    protokoll.write(user, "Verzeichnis: Übernahme bestätigt", {"verzeichnisId": entry_id, "shopId": shop["id"], "name": shop.get("name")},
                    before={"name": entry.get("name"), "status": entry.get("status")}, after={"pfad": vz.pfad(entry)})
    _vergessen()
    return {"ok": True}


@router.post("/betreiber/verzeichnis/{entry_id}/code")
def uebernahme_code(entry_id: str, user: AuthorizedUser, request: Request) -> dict:
    """Übernahme-Code für den Brief an den Salon. Wird nur jetzt gezeigt (gespeichert ist nur der Hash); ein früherer gilt nicht mehr."""
    entry = _eintrag(entry_id)
    try:
        neu = ue.code_erzeugen(entry)
    except ue.Fehler as e:
        raise HTTPException(status_code=e.status, detail=e.text) from e
    protokoll.write(user, "Verzeichnis: Übernahme-Code erzeugt", {"verzeichnisId": entry_id, "name": entry.get("name")},
                    after={"gueltigBis": neu["gueltigBis"].isoformat()})
    return {"code": neu["code"], "link": ue.link(public_origin(request), neu["code"]), "gueltigBis": neu["gueltigBis"].isoformat()}


class BriefRequest(BaseModel):
    code: str


def _gruenderplaetze() -> int:
    from app.apis.billing import founders_left

    return founders_left()


@router.post("/betreiber/verzeichnis/{entry_id}/brief")
def uebernahme_brief(entry_id: str, body: BriefRequest, user: AuthorizedUser) -> Response:
    """Brief an den Salon als PDF. Braucht den Code im Klartext (gespeichert ist nur der Hash), darum nur direkt nach dem Erzeugen."""
    from app import seo

    entry = _eintrag(entry_id)
    try:
        if ue.pruefen(body.code)["id"] != entry_id:
            raise HTTPException(status_code=409, detail="Dieser Code gehört zu einem anderen Salon.")
    except ue.Fehler as e:
        raise HTTPException(status_code=e.status, detail=e.text) from e
    grund = brief.hindernis(entry)
    if grund:
        raise HTTPException(status_code=409, detail=grund)
    inhalt = brief.pdf(entry, body.code, ue._aware(entry["uebernahme"]["gueltigBis"]), seo.public_url(), _gruenderplaetze())
    protokoll.write(user, "Verzeichnis: Brief erzeugt", {"verzeichnisId": entry_id, "name": entry.get("name")})
    name = vz.slugify(entry.get("name") or "", 60) or "salon"
    return Response(inhalt, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="Dranzeit-Brief-{name}.pdf"',
        "Cache-Control": "private, no-store",
    })


@router.post("/betreiber/verzeichnis/{entry_id}/uebernahme-ablehnen")
def uebernahme_ablehnen(entry_id: str, body: ShopRequest, user: AuthorizedUser) -> dict:
    """Nicht derselbe Salon: Vorschlag verwerfen; der Laden bekommt beim nächsten Abgleich eine eigene Seite."""
    entry = _eintrag(entry_id)
    abgelehnt = sorted(set(entry.get("abgelehnt") or []) | {body.shopId})
    changes = {"vorschlag": None, "abgelehnt": abgelehnt, "geaendertAm": vz.now()}
    if (entry.get("anfrage") or {}).get("shopId") == body.shopId:
        changes["anfrage"] = None
    vz.store().aendere(entry_id, changes)
    protokoll.write(user, "Verzeichnis: Übernahme abgelehnt", {"verzeichnisId": entry_id, "shopId": body.shopId, "name": entry.get("name")})
    _vergessen()
    return {"ok": True}
