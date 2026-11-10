"""
Termin-API für Läden (requirements/termin-api.md): Kunden, Leistungen, freie Zeiten und Termine für eigene Programme
eines Ladens – Webseite, Kasse, Agentur. Eigene FastAPI-App, eingehängt unter /api/v1 (main.py), mit eigener
Beschreibung unter /api/v1/docs.

Zugang: Kopfzeile "Authorization: Bearer dz_…" mit einem Schlüssel, den der Inhaber unter „Laden“ → „Schnittstelle
(API)“ erzeugt (app/libs/api_schluessel.py, app/apis/api_zugang). Ein Schlüssel gilt für genau einen Laden; alles
andere ist für ihn nicht da (404). Tarif ab Solo (Baustein "api", app/libs/plans.py), gesperrte Läden nie.

Gebucht wird über dieselben Bausteine wie online, am Tresen und am Telefon: freie Plätze nach den Regeln
(app/libs/online_platz.py), Belegung in einer Transaktion (app/libs/buchung.py), Verschieben und Absagen wie im
Kalender (app/libs/team_termine.py). Ein Platz geht so nur einmal weg.
"""
import re
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime, time, timedelta, timezone
from typing import List, Literal, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.docs import get_redoc_html
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import store
from app.libs import api_schluessel as ak
from app.libs import team_laden as tl
from app.libs import webhooks as wh
from app.libs.buchung import PlatzWeg, cancel_appointment, create_appointment
from app.libs.online_platz import freier_platz, naechste_plaetze, ortszeit, person_fuer_leistung, vorlauf_minuten
from app.libs.plans import has_feature, is_suspended
from app.libs.schedule import BERLIN, Placement, aware
from app.libs.team_notify import notice_fields
from app.libs.team_termine import TerminFehler, nach_dem_schreiben, termin_aendern
from app.libs.telefon import adresse, e164
from app.libs.throttle import throttle

MAX_ANFRAGEN = 120          # je Minute und Schlüssel
MAX_ZEITRAUM = timedelta(days=42)
MAX_VORAUS = timedelta(days=400)
ALTERNATIVEN = 3
ID = r"^[A-Za-z0-9_-]{1,64}$"
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

STATUS = {"scheduled": "geplant", "in-progress": "laeuft", "completed": "fertig", "cancelled": "abgesagt"}
ART = {"booked": "termin", "queue": "nummer"}

# Leitfaden für Entwickler: steht unter /api/v1/docs und /api/v1/redoc, im Repo lesbar als leitfaden.md
BESCHREIBUNG = (Path(__file__).parent / "leitfaden.md").read_text(encoding="utf-8")
ZEIT = {"format": "date-time"}


# --- Antworten (für die Beschreibung; die Endpunkte geben genau diese Felder zurück) --------------------------------------

class FreieZeit(BaseModel):
    start: str = Field(json_schema_extra=ZEIT, examples=["2026-11-20T10:30:00+01:00"])
    ende: str = Field(json_schema_extra=ZEIT, examples=["2026-11-20T11:00:00+01:00"])
    person_id: str


class Fehlerinhalt(BaseModel):
    code: str = Field(examples=["platz_weg"], description="Danach entscheiden; Liste im Leitfaden unter „Fehlercodes“")
    meldung: str = Field(examples=["Diese Zeit ist nicht frei."], description="Deutscher Text für Menschen")
    alternativen: Optional[List[FreieZeit]] = Field(default=None, description="nur bei platz_weg mit regeln = online")
    details: Optional[List[dict]] = Field(default=None, description="nur bei ungueltig: welches Feld, was falsch ist")


class Fehler(BaseModel):
    fehler: Fehlerinhalt


class Laden(BaseModel):
    id: str
    name: str
    adresse: str
    telefon: str
    webseite: str
    zeitzone: str = Field(examples=["Europe/Berlin"])
    vorlauf_minuten: int = Field(description="So kurzfristig bucht online niemand (regeln = online)")
    frueher_dran: bool = Field(description="Tarif enthält „Früher dran“")


class Person(BaseModel):
    id: str
    name: str
    aktiv: bool
    leistung_ids: List[str] = Field(description="leer: bietet alle Leistungen an")


class Leistung(BaseModel):
    id: str
    name: str
    beschreibung: str
    kategorie: str
    dauer_minuten: int
    ruestzeit_minuten: int = Field(description="Zeit danach, in der die Person nicht frei ist")
    preis: float = Field(description="Euro")
    archiviert: bool = Field(description="gelöscht, nicht mehr buchbar")


class Kunde(BaseModel):
    id: str
    name: str
    email: str
    telefon: str = Field(description="wenn lesbar im Format +49…")
    konto_verbunden: bool = Field(description="mit einem Dranzeit-Konto verbunden: Voraussetzung für „Früher dran“-Angebote")
    quelle: str = Field(description="api, telefon oder leer (in Dranzeit angelegt)")
    angelegt: Optional[str] = Field(default=None, json_schema_extra=ZEIT)


class Termin(BaseModel):
    id: str
    status: str = Field(description="geplant, laeuft, fertig oder abgesagt", examples=["geplant"])
    art: str = Field(description="termin oder nummer (in Dranzeit gezogene Nummer der Warteschlange)", examples=["termin"])
    leistung_id: Optional[str] = None
    person_id: Optional[str] = None
    kunde_id: Optional[str] = Field(default=None, description="Eintrag der Kundenliste; leer bei Nummern ohne Eintrag")
    kunde_name: str
    start: Optional[str] = Field(default=None, json_schema_extra=ZEIT)
    ende: Optional[str] = Field(default=None, json_schema_extra=ZEIT)
    nummer: Optional[str] = Field(default=None, description="Aufrufnummer, wenn der Termin eine hat")
    preis: Optional[float] = Field(default=None, description="Euro, beim Buchen aus der Leistung übernommen")
    frueher_dran: bool
    frueher_dran_erreichbar: bool = Field(description="„Früher dran“ an und der Kunde hat ein verbundenes Konto")
    quelle: str = Field(description="api, telefon oder leer (online, Tresen, Kalender)")
    angelegt: Optional[str] = Field(default=None, json_schema_extra=ZEIT)
    geaendert: Optional[str] = Field(default=None, json_schema_extra=ZEIT, description="zum Abgleichen: ändert sich bei jeder Änderung")


def _fehler(*faelle: Tuple[int, str]) -> dict:
    return {status: {"model": Fehler, "description": text} for status, text in faelle}


IMMER = _fehler((401, "kein_zugang: Schlüssel fehlt, falsch oder widerrufen"), (403, "tarif oder gesperrt"),
                (422, "ungueltig: Anfrage unvollständig oder falsch"), (429, "zu_viele: mehr als 120 Anfragen in einer Minute"))
NICHT_DA = _fehler((404, "gibt es in diesem Laden nicht"))
BUCHEN = _fehler((400, "Person, Kunde oder Zeitraum passt nicht"), (404, "gibt es in diesem Laden nicht"),
                 (409, "platz_weg, zu_kurzfristig oder nicht_offen"))

app = FastAPI(
    title="Dranzeit-API", version="1.0.0", description=BESCHREIBUNG,
    docs_url="/docs", redoc_url=None, openapi_url="/openapi.json",
    servers=[{"url": "https://dranzeit.de/api/v1", "description": "Dranzeit"}], root_path_in_servers=False,
    responses=IMMER,
    openapi_tags=[
        {"name": "Laden", "description": "Der Laden zum Schlüssel und sein Team"},
        {"name": "Leistungen", "description": "Was der Laden anbietet, mit Dauer und Preis"},
        {"name": "Kunden", "description": "Die Kundenliste des Ladens"},
        {"name": "Termine", "description": "Freie Zeiten, buchen, verschieben, absagen"},
        {"name": "Webhooks", "description": "Dranzeit meldet jede Änderung an Terminen an dein Programm"},
    ],
)


# ReDoc in fester Version: das von FastAPI vorgegebene redoc@next ist inzwischen ein ES-Modul und bleibt im Browser leer
REDOC_JS = "https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"


@app.get("/redoc", include_in_schema=False)
def redoc(request: Request):
    wurzel = request.scope.get("root_path", "").rstrip("/")
    return get_redoc_html(openapi_url=f"{wurzel}/openapi.json", title="Dranzeit-API", redoc_js_url=REDOC_JS)


# --- Fehler -------------------------------------------------------------------------------------------------------------

class ApiFehler(Exception):
    def __init__(self, status: int, code: str, meldung: str, **extra):
        super().__init__(meldung)
        self.status, self.code, self.meldung, self.extra = status, code, meldung, extra


@app.exception_handler(ApiFehler)
def _api_fehler(_: Request, e: ApiFehler) -> JSONResponse:
    return JSONResponse(status_code=e.status, content={"fehler": {"code": e.code, "meldung": e.meldung, **e.extra}})


@app.exception_handler(RequestValidationError)
def _ungueltig(_: Request, e: RequestValidationError) -> JSONResponse:
    details = [{"feld": ".".join(str(x) for x in err.get("loc", ())[1:]), "meldung": err.get("msg", "")} for err in e.errors()]
    return JSONResponse(status_code=422, content={"fehler": {"code": "ungueltig", "meldung": "Die Anfrage ist unvollständig oder ungültig.",
                                                            "details": details}})


def _nicht_da(was: str) -> ApiFehler:
    texte = {"leistung": "Diese Leistung gibt es hier nicht.", "kunde": "Diesen Kunden gibt es hier nicht.",
             "termin": "Diesen Termin gibt es hier nicht."}
    return ApiFehler(404, f"{was}_unbekannt", texte[was])


# --- Zugang -------------------------------------------------------------------------------------------------------------

@dataclass
class Zugang:
    shop_id: str
    shop: dict
    db: object
    schluessel_id: str = ""


_bearer = HTTPBearer(auto_error=False, description="Schlüssel aus Dranzeit → Laden → Schnittstelle (API)")


def zugang(request: Request, cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> Zugang:
    schluessel = cred.credentials.strip() if cred else ""
    db = store.db() if schluessel else None
    gefunden = ak.pruefen(db, schluessel) if db is not None else None
    if not gefunden:
        raise ApiFehler(401, "kein_zugang", "Der Schlüssel fehlt, ist falsch oder wurde widerrufen.")
    schluessel_id, eintrag = gefunden
    try:
        throttle(request, "api", max_hits=MAX_ANFRAGEN, wer=schluessel_id)
    except HTTPException:
        raise ApiFehler(429, "zu_viele", f"Mehr als {MAX_ANFRAGEN} Anfragen in einer Minute. Bitte kurz warten.")
    snap = db.collection("shops").document(eintrag.get("shopId", "")).get()
    shop = (snap.to_dict() or {}) if snap.exists else None
    if shop is None:
        raise ApiFehler(401, "kein_zugang", "Den Laden zu diesem Schlüssel gibt es nicht mehr.")
    if is_suspended(shop):
        raise ApiFehler(403, "gesperrt", "Dieser Laden ist gesperrt.")
    if not has_feature(shop, "api"):
        raise ApiFehler(403, "tarif", "Die Schnittstelle gibt es ab dem Tarif Solo.")
    return Zugang(eintrag["shopId"], shop, db, schluessel_id)


# --- Zeiten -------------------------------------------------------------------------------------------------------------

def _ein(wert: datetime) -> datetime:
    """Zeit aus einer Anfrage: ohne Zeitzone deutsche Zeit"""
    return (wert.replace(tzinfo=BERLIN) if wert.tzinfo is None else wert).astimezone(timezone.utc)


def _aus(wert) -> Optional[str]:
    return aware(wert).astimezone(BERLIN).isoformat() if isinstance(wert, datetime) else None


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


# --- Laden, Personen, Leistungen ----------------------------------------------------------------------------------------

def _zahl(wert):
    try:
        zahl = float(wert or 0)
    except (TypeError, ValueError):
        return 0
    return int(zahl) if zahl == int(zahl) else zahl


def _leistung_aus(sid: str, s: dict) -> dict:
    return {"id": sid, "name": str(s.get("name") or ""), "beschreibung": str(s.get("description") or ""),
            "kategorie": str(s.get("category") or ""), "dauer_minuten": int(s.get("duration") or 0),
            "ruestzeit_minuten": int(s.get("setupTime") or 0), "preis": _zahl(s.get("price")), "archiviert": bool(s.get("archived"))}


def _leistung(z: Zugang, service_id: str, archivierte: bool = False) -> dict:
    snap = z.db.collection("services").document(service_id).get()
    s = (snap.to_dict() or {}) if snap.exists else {}
    if s.get("shopId") != z.shop_id or (s.get("archived") and not archivierte):
        raise _nicht_da("leistung")
    return s


def _personen(z: Zugang) -> List[Tuple[str, dict]]:
    alle = [(d.id, d.to_dict() or {}) for d in z.db.collection("staff").where("shopId", "==", z.shop_id).stream()]
    return sorted(alle, key=lambda e: str(e[1].get("name") or "").casefold())


def _aktiv(person: dict) -> bool:
    return person.get("isActive") is not False


def _person(z: Zugang, person_id: str) -> dict:
    snap = z.db.collection("staff").document(person_id).get()
    p = (snap.to_dict() or {}) if snap.exists else {}
    if p.get("shopId") != z.shop_id or not _aktiv(p):
        raise ApiFehler(400, "person_unbekannt", "Diese Person gibt es hier nicht oder sie nimmt keine Termine an.")
    return p


def _anbieter(z: Zugang, service_id: str, person_id: Optional[str]) -> List[str]:
    """Wer die Leistung anbietet: die genannte Person (sonst 400) oder alle aktiven, nach Namen"""
    if person_id:
        _person(z, person_id)
        if not person_fuer_leistung(z.db, z.shop_id, person_id, service_id):
            raise ApiFehler(400, "person_bietet_nicht_an", "Diese Person bietet die Leistung nicht an.")
        return [person_id]
    return [pid for pid, p in _personen(z)
            if _aktiv(p) and (not p.get("serviceIds") or service_id in p["serviceIds"])]


class LeistungNeu(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [
        {"name": "Erstberatung", "dauer_minuten": 30, "preis": 0, "beschreibung": "Kostenlose Beratung vor der ersten Behandlung"}]})

    name: str = Field(min_length=1, max_length=120)
    dauer_minuten: int = Field(ge=5, le=600)
    preis: float = Field(default=0, ge=0, le=100000, description="Euro")
    ruestzeit_minuten: int = Field(default=0, ge=0, le=240, description="Zeit danach, in der die Person nicht frei ist")
    beschreibung: Optional[str] = Field(default=None, max_length=1000)
    kategorie: Optional[str] = Field(default=None, max_length=80)
    person_ids: List[str] = Field(default_factory=list, description="Personen, die die Leistung anbieten")

    @field_validator("name")
    @classmethod
    def _name(cls, wert: str) -> str:
        wert = " ".join(wert.split())[:80]
        if not wert:
            raise ValueError("Name fehlt")
        return wert


@app.get("/laden", tags=["Laden"], summary="Der Laden zu diesem Schlüssel", response_model=Laden)
def laden(z: Zugang = Depends(zugang)) -> dict:
    return {"id": z.shop_id, "name": str(z.shop.get("name") or ""), "adresse": adresse(z.shop),
            "telefon": str(z.shop.get("phone") or ""), "webseite": str(z.shop.get("website") or ""),
            "zeitzone": "Europe/Berlin", "vorlauf_minuten": vorlauf_minuten(z.shop),
            "frueher_dran": has_feature(z.shop, "frueherDran")}


@app.get("/personen", tags=["Laden"], summary="Personen im Team", response_model=List[Person])
def personen(z: Zugang = Depends(zugang)) -> list:
    """`leistung_ids` leer heißt: bietet alle Leistungen an."""
    return [{"id": pid, "name": str(p.get("name") or ""), "aktiv": _aktiv(p), "leistung_ids": list(p.get("serviceIds") or [])}
            for pid, p in _personen(z)]


@app.get("/leistungen", tags=["Leistungen"], summary="Leistungen auslesen", response_model=List[Leistung])
def leistungen(archivierte: bool = Query(False, description="auch gelöschte (ausgeblendete)"), z: Zugang = Depends(zugang)) -> list:
    alle = [(d.id, d.to_dict() or {}) for d in z.db.collection("services").where("shopId", "==", z.shop_id).stream()]
    return [_leistung_aus(sid, s) for sid, s in sorted(alle, key=lambda e: str(e[1].get("name") or "").casefold())
            if archivierte or not s.get("archived")]


@app.get("/leistungen/{leistung_id}", tags=["Leistungen"], summary="Eine Leistung", response_model=Leistung, responses=NICHT_DA)
def leistung(leistung_id: str, z: Zugang = Depends(zugang)) -> dict:
    return _leistung_aus(leistung_id, _leistung(z, leistung_id, archivierte=True))


@app.post("/leistungen", tags=["Leistungen"], summary="Leistung anlegen", status_code=201, response_model=Leistung,
          responses=_fehler((400, "person_unbekannt")))
def leistung_anlegen(body: LeistungNeu, z: Zugang = Depends(zugang)) -> dict:
    """Mit `person_ids` bieten diese Personen die Leistung gleich an. Wer bisher alle Leistungen anbietet (leere
    `leistung_ids`), bietet auch die neue an."""
    personen_refs = []
    for pid in dict.fromkeys(body.person_ids):
        snap = z.db.collection("staff").document(pid).get() if pid else None
        if snap is None or not snap.exists or (snap.to_dict() or {}).get("shopId") != z.shop_id:
            raise ApiFehler(400, "person_unbekannt", "Diese Person gibt es hier nicht.")
        personen_refs.append((snap.reference, snap.to_dict() or {}))
    daten = {"shopId": z.shop_id, "name": body.name, "duration": body.dauer_minuten, "price": body.preis,
             "setupTime": body.ruestzeit_minuten,
             **({"description": body.beschreibung.strip()} if body.beschreibung and body.beschreibung.strip() else {}),
             **({"category": body.kategorie.strip()} if body.kategorie and body.kategorie.strip() else {})}
    neu = tl.leistung_anlegen(z.db, daten)
    for ref, person in personen_refs:
        angeboten = list(person.get("serviceIds") or [])
        if angeboten and neu["id"] not in angeboten:
            ref.update({"serviceIds": angeboten + [neu["id"]], "updatedAt": _jetzt()})
    print(f"API {z.shop_id}: Leistung {neu['id']} angelegt")
    return _leistung_aus(neu["id"], neu)


# --- Kunden -------------------------------------------------------------------------------------------------------------

class KundeNeu(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"name": "Alex Muster", "email": "alex@example.com", "telefon": "0151 2345678"}]})

    name: str = Field(min_length=1, max_length=120)
    email: Optional[str] = Field(default=None, max_length=200)
    telefon: Optional[str] = Field(default=None, max_length=40)

    @field_validator("name")
    @classmethod
    def _name(cls, wert: str) -> str:
        wert = " ".join(wert.split())[:80]
        if not wert:
            raise ValueError("Name fehlt")
        return wert

    @field_validator("email")
    @classmethod
    def _email(cls, wert: Optional[str]) -> Optional[str]:
        wert = (wert or "").strip().lower()
        if wert and not EMAIL.fullmatch(wert):
            raise ValueError("keine gültige E-Mail-Adresse")
        return wert or None

    @field_validator("telefon")
    @classmethod
    def _telefon(cls, wert: Optional[str]) -> Optional[str]:
        return (wert or "").strip() or None


def _kunde_aus(kid: str, k: dict) -> dict:
    return {"id": kid, "name": str(k.get("name") or ""), "email": str(k.get("email") or ""), "telefon": str(k.get("phone") or ""),
            "konto_verbunden": bool(k.get("userId")), "quelle": str(k.get("source") or ""), "angelegt": _aus(k.get("createdAt"))}


def _alle_kunden(z: Zugang) -> List[Tuple[str, dict]]:
    return [(d.id, d.to_dict() or {}) for d in z.db.collection("customers").where("shopId", "==", z.shop_id).stream()]


def _kunde(z: Zugang, kunde_id: str) -> dict:
    snap = z.db.collection("customers").document(kunde_id).get()
    k = (snap.to_dict() or {}) if snap.exists else {}
    if k.get("shopId") != z.shop_id:
        raise _nicht_da("kunde")
    return k


def _kunde_finden(z: Zugang, email: Optional[str], telefon: Optional[str]) -> Optional[Tuple[str, dict]]:
    """Vorhandener Eintrag mit derselben E-Mail, sonst derselben Rufnummer (Schreibweise egal)"""
    alle = _alle_kunden(z)
    if email:
        for kid, k in alle:
            if str(k.get("email") or "").strip().lower() == email:
                return kid, k
    nummer = e164(telefon)
    if nummer:
        for kid, k in alle:
            if e164(k.get("phone")) == nummer:
                return kid, k
    return None


def _kunde_neu(z: Zugang, body: KundeNeu) -> Tuple[str, dict]:
    """Neuer Eintrag in der Kundenliste, noch nicht gespeichert"""
    ref = z.db.collection("customers").document()
    jetzt = _jetzt()
    telefon = e164(body.telefon) or body.telefon or ""
    return ref.id, {"id": ref.id, "shopId": z.shop_id, "name": body.name, "email": body.email or "", "phone": telefon,
                    "isActive": False, "source": "api", "createdAt": jetzt, "updatedAt": jetzt}


def _speichern(z: Zugang, kid: str, eintrag: dict) -> None:
    z.db.collection("customers").document(kid).set(eintrag)


@app.get("/kunden", tags=["Kunden"], summary="Kunden suchen", response_model=List[Kunde])
def kunden(email: Optional[str] = None, telefon: Optional[str] = None,
           name: Optional[str] = Query(None, description="Teil des Namens, Groß-/Kleinschreibung egal"),
           z: Zugang = Depends(zugang)) -> list:
    treffer = _alle_kunden(z)
    if email:
        treffer = [(i, k) for i, k in treffer if str(k.get("email") or "").strip().lower() == email.strip().lower()]
    if telefon:
        nummer = e164(telefon)
        treffer = [(i, k) for i, k in treffer if nummer and e164(k.get("phone")) == nummer]
    if name:
        teil = name.strip().casefold()
        treffer = [(i, k) for i, k in treffer if teil in str(k.get("name") or "").casefold()]
    treffer.sort(key=lambda e: str(e[1].get("name") or "").casefold())
    return [_kunde_aus(i, k) for i, k in treffer[:1000]]


@app.get("/kunden/{kunde_id}", tags=["Kunden"], summary="Ein Kunde", response_model=Kunde, responses=NICHT_DA)
def kunde(kunde_id: str, z: Zugang = Depends(zugang)) -> dict:
    return _kunde_aus(kunde_id, _kunde(z, kunde_id))


@app.post("/kunden", tags=["Kunden"], summary="Kunden anlegen", status_code=201, response_model=Kunde,
          responses={200: {"model": Kunde, "description": "gab es schon (gleiche E-Mail oder Rufnummer)"}})
def kunde_anlegen(body: KundeNeu, response: Response, z: Zugang = Depends(zugang)) -> dict:
    """Gibt es die E-Mail oder Rufnummer im Laden schon, kommt der vorhandene Eintrag zurück (200 statt 201)."""
    vorhanden = _kunde_finden(z, body.email, body.telefon)
    if vorhanden:
        response.status_code = 200
        return _kunde_aus(*vorhanden)
    kid, eintrag = _kunde_neu(z, body)
    _speichern(z, kid, eintrag)
    print(f"API {z.shop_id}: Kunde {kid} angelegt")
    return _kunde_aus(kid, eintrag)


# --- Freie Zeiten -------------------------------------------------------------------------------------------------------

def _frei_aus(plaetze) -> list:
    return [{"start": _aus(aware(s)), "ende": _aus(aware(e)), "person_id": pid} for pid, s, e in plaetze]


def _naechste(z: Zugang, service_id: str, staff_ids: List[str], ab: Optional[datetime], anzahl: int, tage: int) -> list:
    jetzt_ort = datetime.now(BERLIN).replace(tzinfo=None)
    ab_ort = ortszeit(ab) if ab else None
    return naechste_plaetze(z.db, z.shop_id, z.shop, service_id, staff_ids, jetzt_ort, ab_ort, anzahl, tage, nummer=False)[:anzahl]


@app.get("/freie-zeiten", tags=["Termine"], summary="Freie Zeiten wie online", response_model=List[FreieZeit],
         responses=_fehler((400, "person_unbekannt oder person_bietet_nicht_an"), (404, "leistung_unbekannt")))
def freie_zeiten(leistung_id: str, person_id: Optional[str] = None,
                 ab: Optional[datetime] = Query(None, description="frühestens ab (Standard: jetzt)"),
                 tage: int = Query(7, ge=1, le=31), anzahl: int = Query(20, ge=1, le=100),
                 z: Zugang = Depends(zugang)) -> list:
    """Nach den Regeln der Online-Buchung, mit der Vorlaufzeit des Ladens. Ohne `person_id` bei allen, die die Leistung
    anbieten; gleiche Zeit bei mehreren Personen steht mehrfach da."""
    _leistung(z, leistung_id)
    staff_ids = _anbieter(z, leistung_id, person_id)
    return _frei_aus(_naechste(z, leistung_id, staff_ids, _ein(ab) if ab else None, anzahl, tage))


# --- Termine ------------------------------------------------------------------------------------------------------------

class TerminNeu(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [
        {"leistung_id": "LEISTUNG_ID", "start": "2026-11-20T10:30:00+01:00",
         "kunde": {"name": "Alex Muster", "email": "alex@example.com"}, "frueher_dran": True},
        {"leistung_id": "LEISTUNG_ID", "start": "2026-11-20T19:00:00+01:00", "person_id": "PERSON_ID", "kunde_id": "KUNDE_ID",
         "regeln": "tresen"}]})

    leistung_id: str = Field(pattern=ID)
    start: datetime
    person_id: Optional[str] = Field(default=None, pattern=ID, description="Pflicht bei regeln = tresen")
    kunde_id: Optional[str] = Field(default=None, pattern=ID, description="Eintrag aus der Kundenliste")
    kunde: Optional[KundeNeu] = Field(default=None, description="statt kunde_id: vorhandenen Eintrag nehmen oder neu anlegen")
    frueher_dran: bool = Field(default=False, description="Kunde will vorgezogen werden, wenn früher etwas frei wird")
    regeln: Literal["online", "tresen"] = "online"


class TerminVerschieben(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"start": "2026-11-21T09:00:00+01:00"}]})

    start: datetime
    person_id: Optional[str] = Field(default=None, pattern=ID, description="ohne: dieselbe Person")
    regeln: Literal["online", "tresen"] = "online"
    kunde_benachrichtigen: bool = True


class TerminAbsagen(BaseModel):
    kunde_benachrichtigen: bool = True
    durch_kunde: bool = Field(default=False, description="Kunde sagt selbst ab: Team bekommt Bescheid, der Kunde keine Nachricht")


class Kundenindex:
    """customerId am Termin → Eintrag der Kundenliste: die ID des Eintrags oder das damit verbundene Konto"""

    def __init__(self, kunden: List[Tuple[str, dict]]):
        self.by_id = dict(kunden)
        self.by_user = {k["userId"]: (i, k) for i, k in kunden if k.get("userId")}

    def zu(self, customer_id) -> Tuple[Optional[str], dict]:
        if customer_id in self.by_id:
            return customer_id, self.by_id[customer_id]
        return self.by_user.get(customer_id, (None, {}))


def _termin_aus(tid: str, a: dict, index: Kundenindex) -> dict:
    kid, k = index.zu(a.get("customerId"))
    frueher = bool(a.get("checkEarlierOptions"))
    return {"id": tid, "status": STATUS.get(a.get("status"), a.get("status")), "art": ART.get(a.get("type") or "booked", a.get("type")),
            "leistung_id": a.get("serviceId"), "person_id": a.get("staffId"), "kunde_id": kid,
            "kunde_name": str(a.get("customerName") or ""), "start": _aus(a.get("startTime")), "ende": _aus(a.get("endTime")),
            "nummer": a.get("referenceCode"), "preis": a.get("price"), "frueher_dran": frueher,
            "frueher_dran_erreichbar": frueher and bool(k.get("userId")) and k.get("userId") == a.get("customerId"),
            "quelle": str(a.get("source") or ""), "angelegt": _aus(a.get("createdAt")), "geaendert": _aus(a.get("updatedAt"))}


def _termin(z: Zugang, termin_id: str) -> dict:
    snap = z.db.collection("appointments").document(termin_id).get()
    a = (snap.to_dict() or {}) if snap.exists else {}
    if a.get("shopId") != z.shop_id:
        raise _nicht_da("termin")
    return a


def termin_fuer_ereignis(db, shop_id: str, termin_id: str, appt: dict, cache: dict) -> dict:
    """Der Termin im Body eines Webhooks, mit denselben Feldern wie GET /termine/{id} (app/libs/webhooks.py).
    cache: Kundenindex je Laden, für mehrere Ereignisse auf einmal"""
    if shop_id not in cache:
        cache[shop_id] = Kundenindex(_alle_kunden(Zugang(shop_id, {}, db, "")))
    return Termin(**_termin_aus(termin_id, appt, cache[shop_id])).model_dump()


def _antwort(z: Zugang, termin_id: str) -> dict:
    return _termin_aus(termin_id, _termin(z, termin_id), Kundenindex(_alle_kunden(z)))


def _platz_weg(z: Zugang, e: Optional[PlatzWeg], online: bool, service_id: str, staff_ids: List[str], ab: datetime) -> ApiFehler:
    if e is not None and e.window is not None:
        von, bis = e.window.start.astimezone(BERLIN), e.window.end.astimezone(BERLIN)
        meldung = f"Da ist schon ein Termin ({von:%H:%M}–{bis:%H:%M})."
    else:
        meldung = "Diese Zeit ist nicht frei."
    if not online:
        return ApiFehler(409, "platz_weg", meldung)
    try:
        weiter = _frei_aus(_naechste(z, service_id, staff_ids, ab, ALTERNATIVEN, 14)) if staff_ids else []
    except Exception as fehler:  # die Absage zählt, die Vorschläge sind Beiwerk
        print(f"API {z.shop_id}: keine Alternativen: {fehler}")
        weiter = []
    return ApiFehler(409, "platz_weg", meldung, alternativen=weiter)


def _nicht_zu_frueh(z: Zugang, start: datetime, online: bool) -> None:
    jetzt = _jetzt()
    if start <= jetzt or (online and start <= jetzt + timedelta(minutes=vorlauf_minuten(z.shop))):
        raise ApiFehler(409, "zu_kurzfristig", "Diese Zeit ist zu kurzfristig oder schon vorbei.")
    if start > jetzt + MAX_VORAUS:
        raise ApiFehler(400, "zu_weit", "So weit im Voraus geht es nicht.")


def _dauer(s: dict) -> timedelta:
    return timedelta(minutes=int(s.get("duration") or 30) + int(s.get("setupTime") or 0))


@app.get("/termine", tags=["Termine"], summary="Termine in einem Zeitraum", response_model=List[Termin],
         responses=_fehler((400, "zeitraum")))
def termine(von: Optional[datetime] = Query(None, description="Beginn ab (Standard: heute 0 Uhr)"),
            bis: Optional[datetime] = Query(None, description="Beginn vor (Standard: von + 7 Tage, höchstens 42 Tage)"),
            kunde_id: Optional[str] = None, status: Optional[Literal["geplant", "laeuft", "fertig", "abgesagt"]] = None,
            z: Zugang = Depends(zugang)) -> list:
    anfang = _ein(von) if von else datetime.combine(datetime.now(BERLIN).date(), time(), tzinfo=BERLIN).astimezone(timezone.utc)
    ende = _ein(bis) if bis else anfang + timedelta(days=7)
    if not anfang < ende <= anfang + MAX_ZEITRAUM:
        raise ApiFehler(400, "zeitraum", "Ungültiger Zeitraum: bis muss nach von liegen, höchstens 42 Tage.")
    abfrage = (z.db.collection("appointments").where("shopId", "==", z.shop_id)
               .where("startTime", ">=", anfang).where("startTime", "<", ende))
    index = Kundenindex(_alle_kunden(z))
    liste = [_termin_aus(d.id, d.to_dict() or {}, index) for d in abfrage.stream()]
    liste = [t for t in liste if (not kunde_id or t["kunde_id"] == kunde_id) and (not status or t["status"] == status)]
    return sorted(liste, key=lambda t: (t["start"] or "", t["id"]))


@app.get("/termine/{termin_id}", tags=["Termine"], summary="Ein Termin", response_model=Termin, responses=NICHT_DA)
def termin(termin_id: str, z: Zugang = Depends(zugang)) -> dict:
    return _antwort(z, termin_id)


@app.post("/termine", tags=["Termine"], summary="Termin anlegen", status_code=201, response_model=Termin, responses=BUCHEN)
def termin_anlegen(body: TerminNeu, z: Zugang = Depends(zugang)) -> dict:
    """Das Ende ergibt sich aus Dauer und Rüstzeit der Leistung. Das Team bekommt Bescheid wie bei einer Online-Buchung."""
    service = _leistung(z, body.leistung_id)
    neuer_kunde = None
    if body.kunde_id:
        kid, k = body.kunde_id, _kunde(z, body.kunde_id)
    elif body.kunde:
        gefunden = _kunde_finden(z, body.kunde.email, body.kunde.telefon)
        if gefunden:
            kid, k = gefunden
        else:
            kid, k = _kunde_neu(z, body.kunde)
            neuer_kunde = k
    else:
        raise ApiFehler(400, "kunde_fehlt", "Bitte kunde_id oder kunde (Name, E-Mail, Telefon) angeben.")
    if body.frueher_dran and not has_feature(z.shop, "frueherDran"):
        raise ApiFehler(403, "tarif", "„Früher dran“ gibt es in diesem Tarif nicht.")
    online = body.regeln == "online"
    start = _ein(body.start)
    if online:
        staff_ids = _anbieter(z, body.leistung_id, body.person_id)
        _nicht_zu_frueh(z, start, online)
        plaetze = [Placement(pid, *frei) for pid in staff_ids if (frei := freier_platz(z.db, z.shop_id, body.leistung_id, pid, start))]
    else:
        if not body.person_id:
            raise ApiFehler(400, "person_fehlt", "Bei regeln = tresen bitte person_id angeben.")
        _person(z, body.person_id)
        staff_ids = [body.person_id]
        _nicht_zu_frueh(z, start, online)
        plaetze = [Placement(body.person_id, start, start + _dauer(service))]
    jetzt = _jetzt()
    telefon = k.get("phone")
    daten = {
        "shopId": z.shop_id, "serviceId": body.leistung_id, "status": "scheduled", "type": "booked", "isAnonymous": False,
        # Mit verbundenem Konto gehört der Termin dem Konto, wie am Tresen (appointmentCustomerId im Frontend)
        "customerId": k.get("userId") or kid, "customerName": str(k.get("name") or "") or "Unbekannter Kunde",
        **({"customerPhone": telefon} if telefon else {}), "price": service.get("price") or 0,
        "checkEarlierOptions": body.frueher_dran, **({"checkEarlierOptionsCreatedAt": jetzt} if body.frueher_dran else {}),
        "source": "api", **notice_fields({}, "new", jetzt),
    }
    if not plaetze:
        raise _platz_weg(z, None, online, body.leistung_id, staff_ids, start)
    try:
        created = create_appointment(z.db, daten, plaetze, needs_code=False)
    except PlatzWeg as e:
        raise _platz_weg(z, e, online, body.leistung_id, staff_ids, start)
    if neuer_kunde:
        _speichern(z, kid, neuer_kunde)
    nach_dem_schreiben(created["id"], None, created, frei=body.frueher_dran, benachrichtigen=True)
    print(f"API {z.shop_id}: Termin {created['id']} {aware(created['startTime']).astimezone(BERLIN):%d.%m. %H:%M} bei {created['staffId']} ({body.regeln})")
    return _termin_aus(created["id"], created, Kundenindex([(kid, k)]))


def _offen(a: dict) -> None:
    if a.get("status") != "scheduled":
        raise ApiFehler(409, "nicht_offen", "Dieser Termin läuft schon, ist fertig oder abgesagt.")


@app.post("/termine/{termin_id}/verschieben", tags=["Termine"], summary="Termin verschieben", response_model=Termin,
          responses=BUCHEN)
def termin_verschieben(termin_id: str, body: TerminVerschieben, z: Zugang = Depends(zugang)) -> dict:
    """Neue Zeit, optional bei einer anderen Person. Der Kunde bekommt Bescheid wie bei einer Verschiebung im Kalender."""
    a = _termin(z, termin_id)
    _offen(a)
    online = body.regeln == "online"
    person_id = body.person_id or a.get("staffId") or ""
    service_id = a.get("serviceId", "")
    start = _ein(body.start)
    if online:
        staff_ids = _anbieter(z, service_id, person_id)
        _nicht_zu_frueh(z, start, online)
        frei = freier_platz(z.db, z.shop_id, service_id, person_id, start, ohne=termin_id)
        if not frei:
            raise _platz_weg(z, None, online, service_id, staff_ids, start)
        ende = frei[1]
    else:
        _person(z, person_id)
        _nicht_zu_frueh(z, start, online)
        snap = z.db.collection("services").document(service_id).get()
        if snap.exists:
            ende = start + _dauer(snap.to_dict() or {})
        else:
            ende = start + (aware(a["endTime"]) - aware(a["startTime"]))
    try:
        termin_aendern(z.db, termin_id, {"startTime": start, "endTime": ende, "staffId": person_id},
                       kunde_benachrichtigen=body.kunde_benachrichtigen)
    except PlatzWeg as e:
        raise _platz_weg(z, e, online, service_id, [person_id], start)
    except TerminFehler as e:
        raise ApiFehler(e.status, "ungueltig", str(e.text))
    print(f"API {z.shop_id}: Termin {termin_id} verschoben auf {start.astimezone(BERLIN):%d.%m. %H:%M} bei {person_id}")
    return _antwort(z, termin_id)


@app.post("/termine/{termin_id}/absagen", tags=["Termine"], summary="Termin absagen", response_model=Termin,
          responses=_fehler((404, "termin_unbekannt"), (409, "nicht_offen")))
def termin_absagen(termin_id: str, body: TerminAbsagen, z: Zugang = Depends(zugang)) -> dict:
    """Der Laden sagt ab: Der Kunde bekommt Bescheid (abschaltbar). Mit `durch_kunde` hat der Kunde selbst abgesagt,
    etwa auf der Webseite: Dann bekommt das Team Bescheid. Zweimal absagen ist kein Fehler."""
    a = _termin(z, termin_id)
    if a.get("status") == "cancelled":
        return _antwort(z, termin_id)
    _offen(a)
    if body.durch_kunde:
        def pruefen(aktuell: Optional[dict]) -> None:
            if not aktuell or aktuell.get("shopId") != z.shop_id:
                raise _nicht_da("termin")
            _offen(aktuell)

        vorher = cancel_appointment(z.db, termin_id, pruefen, by_customer=True)
        nach_dem_schreiben(termin_id, vorher, {**vorher, "status": "cancelled"}, frei=True, benachrichtigen=True)
    else:
        termin_aendern(z.db, termin_id, {"status": "cancelled"}, kunde_benachrichtigen=body.kunde_benachrichtigen)
    print(f"API {z.shop_id}: Termin {termin_id} abgesagt" + (" (durch den Kunden)" if body.durch_kunde else ""))
    return _antwort(z, termin_id)


# --- Webhooks -----------------------------------------------------------------------------------------------------------

Ereignis = Literal["termin.angelegt", "termin.verschoben", "termin.abgesagt", "termin.geaendert"]


class WebhookNeu(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"url": "https://example.com/dranzeit/webhook"}]})

    url: str = Field(max_length=500, description="https-Adresse im öffentlichen Internet")
    ereignisse: Optional[List[Ereignis]] = Field(default=None, description="ohne: alle")


class Webhook(BaseModel):
    id: str
    url: str
    ereignisse: List[str]
    angelegt: Optional[str] = Field(default=None, json_schema_extra=ZEIT)


class WebhookAngelegt(Webhook):
    geheimnis: str = Field(description="Zum Prüfen der Signatur. Wird nur dieses eine Mal angezeigt.")


class WebhookTest(BaseModel):
    ok: bool
    status: Optional[int] = Field(default=None, description="HTTP-Status deiner Gegenstelle")
    fehler: Optional[str] = None


class Zustellung(BaseModel):
    id: str = Field(description="steht auch in der Kopfzeile Dranzeit-Zustellung")
    ereignis_id: Optional[str] = Field(default=None, description="id im Body; gleich bei jedem Versuch")
    typ: str
    termin_id: Optional[str] = None
    status: str = Field(description="offen, zugestellt, fehlgeschlagen oder verworfen")
    versuche: int
    letzter_status: Optional[int] = None
    letzter_fehler: Optional[str] = None
    angelegt: Optional[str] = Field(default=None, json_schema_extra=ZEIT)
    naechster_versuch: Optional[str] = Field(default=None, json_schema_extra=ZEIT)
    zugestellt: Optional[str] = Field(default=None, json_schema_extra=ZEIT)


def _webhook_fehler(e: wh.WebhookFehler) -> ApiFehler:
    return ApiFehler(e.status, e.code, e.meldung)


@app.get("/webhooks", tags=["Webhooks"], summary="Webhooks des Ladens", response_model=List[Webhook])
def webhooks(z: Zugang = Depends(zugang)) -> list:
    return [wh.oeffentlich(i, w) for i, w in wh.des_ladens(z.db, z.shop_id)]


@app.post("/webhooks", tags=["Webhooks"], summary="Webhook anlegen", status_code=201, response_model=WebhookAngelegt,
          responses=_fehler((400, "url_ungueltig oder zu_viele_webhooks")))
def webhook_anlegen(body: WebhookNeu, z: Zugang = Depends(zugang)) -> dict:
    """Ab jetzt meldet Dranzeit jede Änderung an Terminen des Ladens an diese Adresse. Termine, die es vorher schon gab,
    lösen erst bei ihrer nächsten Änderung etwas aus. Der Webhook gehört zum Schlüssel: Widerrufen nimmt ihn mit."""
    try:
        eintrag, geheimnis = wh.anlegen(z.db, z.shop_id, z.schluessel_id, body.url, body.ereignisse, _jetzt())
    except wh.WebhookFehler as e:
        raise _webhook_fehler(e)
    print(f"API {z.shop_id}: Webhook {eintrag['id']} angelegt")
    return {**eintrag, "geheimnis": geheimnis}


@app.delete("/webhooks/{webhook_id}", tags=["Webhooks"], summary="Webhook löschen", status_code=204, responses=NICHT_DA)
def webhook_loeschen(webhook_id: str, z: Zugang = Depends(zugang)) -> Response:
    try:
        wh.loeschen(z.db, z.shop_id, webhook_id)
    except wh.WebhookFehler as e:
        raise _webhook_fehler(e)
    print(f"API {z.shop_id}: Webhook {webhook_id} gelöscht")
    return Response(status_code=204)


@app.post("/webhooks/{webhook_id}/test", tags=["Webhooks"], summary="ping schicken", response_model=WebhookTest, responses=NICHT_DA)
def webhook_testen(webhook_id: str, z: Zugang = Depends(zugang)) -> dict:
    """Schickt sofort ein Ereignis `ping`, signiert wie jedes andere, und sagt, was deine Gegenstelle geantwortet hat."""
    try:
        return wh.testen(z.db, z.shop_id, webhook_id, _jetzt())
    except wh.WebhookFehler as e:
        raise _webhook_fehler(e)


@app.get("/webhooks/{webhook_id}/zustellungen", tags=["Webhooks"], summary="Letzte Zustellungen", response_model=List[Zustellung],
         responses=NICHT_DA)
def webhook_zustellungen(webhook_id: str, z: Zugang = Depends(zugang)) -> list:
    """Die letzten 50, neueste zuerst. Erledigte bleiben 7 Tage."""
    try:
        return wh.zustellungen(z.db, z.shop_id, webhook_id)
    except wh.WebhookFehler as e:
        raise _webhook_fehler(e)
