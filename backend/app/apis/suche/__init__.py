"""
Läden finden (frontend/src/pages/Finden.tsx), öffentlich, ohne Anmeldung:

    GET /suche/laeden                       alle Läden für Liste und Karte, dazu die Salons ohne Dranzeit (grau)
    GET /suche/frei?ids=a,b&leistung=…&gruppe=…   je Laden: wie viele warten, wann man mit einer Nummer ungefähr
                                            dran wäre, die nächsten freien Termine (7 Tage) – für die gesuchte
                                            Leistung bzw. Leistungsgruppe
    GET /suche/ort?q=13507                  Postleitzahl, Ort oder Adresse → Mittelpunkt (OpenStreetMap, gemerkt)

Die Liste ist klein genug, dass der Browser Filter, Entfernung und Kartenausschnitt selbst rechnet (sofort, ohne
Laden). Teuer sind nur die freien Zeiten; die fragt die Seite für die gezeigten Läden (höchstens MAX_IDS) und das
Backend merkt sie sich eine Minute. Freie Zeiten nach denselben Regeln wie beim Buchen und am Telefon
(app/libs/online_platz.py: Vorlauf für Termine, Nummern hinter der Schlange).

Jede Leistung bekommt ihre Leistungsgruppe mit (app/libs/leistungsgruppen.py: vom Inhaber festgelegt oder per
Stichwort), Salons ohne Dranzeit die Gruppen ihrer Leistungen – so findet „Herrenhaarschnitt“ auch den
„Maschinenschnitt“ eines Barbiers.

Vorschläge beim Tippen kommen aus eigenen Listen (Läden, Leistungen, Berliner Bezirke und Ortsteile im Frontend):
Nominatim erlaubt keine Suche bei jedem Tastendruck. Nur wer etwas anderes abschickt (PLZ, Straße, andere Stadt),
löst hier eine Abfrage aus – höchstens eine je Sekunde für das ganze Backend (app/libs/verzeichnis.osm_suche).
"""
import logging
import re
import unicodedata
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response

from app import seo, store
from app.libs import laeden as ld
from app.libs import leistungsgruppen as lg
from app.libs.plans import has_feature
from app.libs.schedule import BERLIN, aware
from app.libs.throttle import throttle

log = logging.getLogger(__name__)

router = APIRouter()

MAX_IDS = 12
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
LADEN_FELDER = ("name", "logoUrl", "street", "postalCode", "city", "industry", "phone", "businessHoursByDay")
MAX_ORTE_GEMERKT = 2000
_orte: dict = {}


def norm(text: str) -> str:
    """Für Vergleiche: klein, ohne Akzente, ä→ae (wie normSuche in frontend/src/utils/suche.ts)"""
    t = (text or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def passt(text: str, suche: str) -> bool:
    """Alle Wörter der Suche kommen im Text vor (Wortanfang reicht nicht: „schnitt“ findet „Herrenhaarschnitt“)"""
    woerter = norm(suche).split()
    t = norm(text)
    return bool(woerter) and all(w in t for w in woerter)


def _leistungen(db, shop_id: str) -> list:
    return [{"id": d.id, **(d.to_dict() or {})} for d in db.collection("services").where("shopId", "==", shop_id).stream()]


def _personen(db, shop_id: str) -> list:
    return [(d.id, d.to_dict() or {}) for d in db.collection("staff").where("shopId", "==", shop_id).stream()]


def _leistung_kurz(s: dict, kontext: str = "") -> dict:
    # kontext (Ladenname): ein Schnitt ohne Angabe beim Barbier ist ein Herrenschnitt
    return {"id": s["id"], "name": s["name"], "price": s.get("price") or 0, "duration": s.get("duration") or 0,
            "category": s.get("category") or "", "gruppe": lg.wirksam(s, kontext)}


def _verzeichnis() -> dict:
    """Seiten aus dem Salon-Verzeichnis (Lage, Ortsteil, Bezirk); ohne Verzeichnis geht die Suche trotzdem"""
    try:
        from app import verzeichnis_seiten

        return verzeichnis_seiten.daten()
    except Exception:
        log.exception("Suche: Verzeichnis nicht lesbar")
        return {"seiten": []}


def laeden_daten() -> dict:
    def load():
        db = store.db()
        seiten = _verzeichnis()["seiten"]
        nach_laden = {s["shopId"]: s for s in seiten if s.get("typ") == "laden"}
        laeden = []
        for shop in ld.alle_laeden(db):
            if shop.get("suspended") or shop.get("unlisted") or not shop.get("name"):
                continue
            seite = nach_laden.get(shop["id"], {})
            lage = shop.get("coordinates") or seite.get("coordinates") or {}
            # Wie in der Leistungsverwaltung (ServiceForm): nur der Name des Ladens, damit beide dasselbe zeigen
            leistungen = [_leistung_kurz(s, shop["name"]) for s in _leistungen(db, shop["id"])
                          if not s.get("archived") and s.get("name")]
            laeden.append({
                "id": shop["id"], **{k: shop[k] for k in LADEN_FELDER if shop.get(k) is not None},
                "ortsteil": seite.get("ortsteil") or "", "bezirk": seite.get("bezirk") or "",
                "lat": lage.get("latitude"), "lng": lage.get("longitude"),
                "termine": has_feature(shop, "termine"), "pfad": seite.get("pfad") or "",
                "leistungen": sorted(leistungen, key=lambda s: norm(s["name"])),
            })
        salons = []
        for s in seiten:
            lage = s.get("coordinates") or {}
            if s.get("typ") != "eintrag" or lage.get("latitude") is None:
                continue
            namen = [x.get("name") for x in (s.get("services") or []) if isinstance(x, dict) and x.get("name")][:40]
            kategorie = s.get("kategorie") or "friseur"
            salons.append({
                "id": s["id"], "name": s["name"], "kategorie": kategorie,
                **{k: s.get(k) or "" for k in ("street", "postalCode", "city", "ortsteil", "bezirk", "pfad")},
                "lat": lage["latitude"], "lng": lage["longitude"],
                "leistungen": namen, "gruppen": lg.salon_gruppen(namen, kategorie, s["name"]),
            })
        return {"laeden": laeden, "salons": salons}

    return seo._cached("suche:laeden", load)


@router.get("/suche/laeden")
def suche_laeden(response: Response) -> dict:
    response.headers["Cache-Control"] = f"public, max-age={seo.CACHE_SECONDS}"
    return laeden_daten()


def standard_leistung(leistungen: list, suche: str = "", gruppe: str = "") -> dict | None:
    """Für die freien Zeiten: die gesuchte Leistung, sonst die übliche (Herrenschnitt, dann ein anderer Schnitt außer für
    Kinder, dann etwas mit Haar), sonst die erste.

    Mit Leistungsgruppe wie passendeLeistung in frontend/src/utils/suche.ts: erst genau diese Gruppe (vor mitzählenden
    wie „Haarschnitt“), dann wessen Name den Text enthält, dann mindestens 15 Minuten, die kürzeste, die günstigere."""
    menge = lg.menge(gruppe) if gruppe else set()
    in_gruppe = [s for s in leistungen if s.get("gruppe") in menge]
    if in_gruppe:
        def rang_gruppe(s: dict):
            dauer = s.get("duration") or 0
            return (s.get("gruppe") != gruppe, not passt(s["name"], suche), max(dauer, 10) < 15, dauer, s.get("price") or 0,
                    norm(s["name"]))

        return sorted(in_gruppe, key=rang_gruppe)[0]
    if suche:
        treffer = [s for s in leistungen if passt(f"{s['name']} {s.get('category') or ''}", suche)]
        if treffer:
            return treffer[0]
    if not leistungen:
        return None

    def rang(s: dict):
        n = norm(s["name"])
        kinder = "kinder" in n or "kids" in n
        stufe = 0 if "herren" in n and "schnitt" in n else 1 if "schnitt" in n and not kinder else 2 if "haar" in n and not kinder else 3
        return (stufe, max(s.get("duration") or 0, 10) < 15, s.get("duration") or 0, n)

    return sorted(leistungen, key=rang)[0]


def _anbieter(db, shop_id: str, service_id: str) -> list:
    return [pid for pid, p in sorted(_personen(db, shop_id), key=lambda x: x[0])
            if p.get("isActive") is not False and (not p.get("serviceIds") or service_id in p["serviceIds"])]


def _iso(dt: datetime) -> str:
    return aware(dt).astimezone(BERLIN).isoformat()


def frei_fuer(shop_id: str, laden: dict, suche: str = "", now: datetime | None = None, gruppe: str = "") -> dict:
    """warten, leistung, nummer (ungefähre Zeit, wann man heute dran wäre) und termine (die nächsten drei)"""
    from app.libs.online_platz import naechste_plaetze

    out: dict = {"warten": seo.waiting_now(shop_id), "leistung": None, "nummer": None, "termine": []}
    leistung = standard_leistung(laden.get("leistungen") or [], suche, gruppe)
    if not leistung:
        return out
    out["leistung"] = leistung
    db = store.db()
    shop = ld.laden_roh(db, shop_id) or {}
    staff = _anbieter(db, shop_id, leistung["id"])
    if not staff:
        return out
    jetzt = (now or datetime.now(BERLIN)).astimezone(BERLIN).replace(tzinfo=None)
    nummer = naechste_plaetze(db, shop_id, shop, leistung["id"], staff, jetzt, None, 1, 1, nummer=True)
    if nummer:
        out["nummer"] = _iso(nummer[0][1])
    if has_feature(shop, "termine"):
        gesehen = set()
        for pid, start, _ende in naechste_plaetze(db, shop_id, shop, leistung["id"], staff, jetzt, None, 3, 7, nummer=False):
            if start in gesehen:
                continue
            gesehen.add(start)
            out["termine"].append({"start": _iso(start), "personId": pid})
            if len(out["termine"]) == 3:
                break
    return out


@router.get("/suche/frei")
def suche_frei(ids: str, response: Response, leistung: str = "", gruppe: str = "") -> dict:
    response.headers["Cache-Control"] = "public, max-age=30"
    suche = norm(leistung)[:60]
    gruppe = gruppe if gruppe in lg.keys() else ""
    gefragt = [i for i in dict.fromkeys(ids.split(",")) if ID.match(i)][:MAX_IDS]
    bekannt = {l["id"]: l for l in laeden_daten()["laeden"]}
    ergebnis = {}
    for shop_id in gefragt:
        if shop_id not in bekannt:
            continue
        try:
            ergebnis[shop_id] = seo._cached(f"suche:frei:{shop_id}:{suche}:{gruppe}",
                                            lambda i=shop_id: frei_fuer(i, bekannt[i], suche, gruppe=gruppe))
        except Exception:
            log.exception("Suche: freie Zeiten für %s nicht berechnet", shop_id)
    return {"frei": ergebnis}


def ort_aus_osm(daten: list) -> dict | None:
    if not daten:
        return None
    hit = daten[0]
    a = hit.get("address") or {}
    try:
        lat, lng = round(float(hit["lat"]), 5), round(float(hit["lon"]), 5)
    except (KeyError, TypeError, ValueError):
        return None
    stadt = a.get("city") or a.get("town") or a.get("village") or a.get("municipality") or ""
    teil = a.get("suburb") or a.get("city_district") or a.get("quarter") or ""
    plz = a.get("postcode") or ""
    strasse = " ".join(x for x in (a.get("road"), a.get("house_number")) if x)
    name = ", ".join(x for x in (strasse, " ".join(x for x in (plz, teil or stadt) if x)) if x) or hit.get("name") or ""
    return {"name": name, "lat": lat, "lng": lng}


@router.get("/suche/ort")
def suche_ort(q: str, http: Request, response: Response) -> dict:
    """PLZ, Ort oder Adresse in Deutschland → Mittelpunkt. 404, wenn OpenStreetMap nichts findet."""
    from app.libs import verzeichnis as vz

    text = re.sub(r"\s+", " ", q or "").strip()[:120]
    if len(text) < 2:
        raise HTTPException(status_code=400, detail="Bitte einen Ort oder eine Postleitzahl eingeben.")
    key = text.lower()
    if key not in _orte:
        throttle(http, "ortsuche", max_hits=30)
        params = {"countrycodes": "de", "format": "jsonv2", "addressdetails": 1, "limit": 1}
        if re.fullmatch(r"\d{5}", text):
            params["postalcode"] = text
        else:
            params["q"] = text
        daten = vz.osm_suche(params)
        if daten is None:
            raise HTTPException(status_code=503, detail="Die Ortssuche ist gerade nicht erreichbar.")
        if len(_orte) >= MAX_ORTE_GEMERKT:
            _orte.clear()
        _orte[key] = ort_aus_osm(daten)
    gefunden = _orte[key]
    if not gefunden:
        raise HTTPException(status_code=404, detail="Diesen Ort haben wir nicht gefunden.")
    response.headers["Cache-Control"] = "public, max-age=86400"
    return gefunden
