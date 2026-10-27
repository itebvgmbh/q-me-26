"""
Telefon-Assistent: Werkzeuge für die Sprach-KI, die die Anrufe eines Ladens annimmt (requirements/telefon-assistent.md).

Die Plattform (Probelauf: deploy/telefon-assistent.md) ruft diese Endpunkte während des Gesprächs auf. Anbieterneutral:
schlichtes JSON, Zeiten in deutscher Ortszeit. Jede Antwort hat "ok" und "ansage" – einen Satz, den der Assistent
so oder in der Sprache des Anrufers sagen kann; bei ok = false dazu "grund" als Kurzwort.

    POST /telefon/laden         Laden zum Anruf: Name, Adresse, Öffnungszeiten, Leistungen, Personen
    POST /telefon/freie-zeiten  nächste freie Termine für eine Leistung (wie die Online-Buchung, mit Vorlauf)
    POST /telefon/buchen        einen genannten Platz buchen – ist er weg, die nächsten zur Auswahl
    POST /telefon/wartezeit     wie lange es gerade dauert: frühester Platz für eine Nummer heute
    POST /telefon/nummer        Nummer ziehen: frühester Platz heute, wie Nummer ziehen online
    POST /telefon/aendern       eben gebuchten Termin bzw. gezogene Nummer: Namen berichtigen oder absagen

Welcher Laden: "angerufen" ist die gewählte Rufnummer, die zugehörige Zeile in telefon_leitungen/{Nummer}
vergibt der Betreiber-Bereich. Ohne Telefon (Probe im Browser) geht "laden_id" – nur für Läden mit Nummer.
Zugang: Kopfzeile "Authorization: Bearer <QME_TELEFON_TOKEN>" aus /etc/q-me.env; ohne Eintrag antwortet alles 503.

Freie Plätze rechnet dieselbe Berechnung wie "Früher dran" (app/apis/available_timeslots), heute für Nummern mit
der Prognose der Schlange (app/libs/queue_notify.py). Gebucht wird über app/libs/buchung.py: Ein Platz geht nur
einmal weg, auch wenn im selben Moment online oder am Tresen gebucht wird.
"""
import hmac
import os
from datetime import datetime, time, timedelta, timezone
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, field_validator

from app.apis.available_timeslots import load_timeslot_inputs, timeslots_for_day
from app.apis.cache import invalidate_shop_date_cache
from app.apis.firebase_utils import get_firestore_db
from app.libs import telefon as t
from app.libs.buchung import PlatzWeg, cancel_appointment, create_appointment
from app.libs.plans import PLANS, effective_plan, has_feature, is_suspended
from app.libs.queue_notify import project_lane
from app.libs.schedule import BERLIN, Placement, aware


def _zugang(authorization: Optional[str] = Header(default=None)) -> None:
    token = os.environ.get("QME_TELEFON_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="Telefon-Assistent ist nicht eingerichtet (QME_TELEFON_TOKEN fehlt).")
    given = (authorization or "").strip()
    if given[:7].lower() == "bearer ":
        given = given[7:].strip()
    if not hmac.compare_digest(given.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="Kein Zugang.")


router = APIRouter(dependencies=[Depends(_zugang)])

TAGE_TERMIN = 14        # so viele Tage ab dem Wunsch sucht freie-zeiten (wie Nummer ziehen online)
MAX_VORAUS_TAGE = 90    # Wünsche weiter in der Zukunft lehnt der Assistent ab
MAX_ANZAHL = 5
NUMMER_KANDIDATEN = 8   # Plätze zur Auswahl beim Nummer ziehen, falls der erste beim Speichern weg ist (wie im Frontend)
NUMMER_RUNDEN = 3
MAX_VORLAUF_MINUTEN = 24 * 60
AENDERN_MINUTEN = 30    # so lange nach dem Anlegen ändert der Assistent einen Termin noch – im selben Gespräch
EGAL ={"", "egal", "egal wer", "beliebig", "alle", "irgendwer", "any", "-", "null", "none"}


class Anruf(BaseModel):
    angerufen: Optional[str] = None   # gewählte Nummer, bei ElevenLabs {{system__called_number}}
    laden_id: Optional[str] = None    # ohne Telefon: Laden direkt


class ZeitenAnfrage(Anruf):
    leistung: str                     # ID oder Name aus /telefon/laden
    person: Optional[str] = None      # ID oder Name; leer oder "egal" = alle, die die Leistung anbieten
    ab: Optional[str] = None          # nicht früher als: "2026-10-29" oder "2026-10-29T15:00"
    anzahl: int = 3


class BuchenAnfrage(Anruf):
    leistung: str
    platz: str                        # "platz" aus freie-zeiten, unverändert
    name: str
    anrufer: Optional[str] = None     # Nummer des Anrufers, bei ElevenLabs {{system__caller_id}}


class WartezeitAnfrage(Anruf):
    leistung: Optional[str] = None    # ohne: die kürzeste Leistung
    person: Optional[str] = None


class NummerAnfrage(Anruf):
    leistung: str
    person: Optional[str] = None
    name: str
    anrufer: Optional[str] = None


class AendernAnfrage(Anruf):
    termin_id: str                    # "termin_id" aus buchen oder nummer, unverändert
    name: Optional[str] = None        # richtiger Name
    absagen: bool = False             # Termin bzw. Nummer zurückgeben

    @field_validator("absagen", mode="before")
    @classmethod
    def _ja_nein(cls, wert):
        """Vapi schickt leere Felder als "" – auch bei Ja/Nein"""
        if isinstance(wert, str):
            return wert.strip().casefold() in ("true", "ja", "yes", "1")
        return bool(wert)


class _Nein(Exception):
    """Geht nicht – ansage für den Anrufer, grund als Kurzwort für die Plattform."""

    def __init__(self, grund: str, ansage: str, **extra):
        super().__init__(ansage)
        self.grund, self.ansage, self.extra = grund, ansage, extra

    def antwort(self) -> dict:
        return {"ok": False, "grund": self.grund, "ansage": self.ansage, **self.extra}


Platz = Tuple[dict, datetime, datetime]  # Person, Beginn, Ende (Ortszeit ohne Zeitzone)


def _jetzt() -> datetime:
    """Jetzt als Ortszeit ohne Zeitzone – so rechnet available_timeslots (Server läuft in deutscher Zeit)"""
    return datetime.now(BERLIN).replace(tzinfo=None)


# --- Laden, Leistung, Person -------------------------------------------------------------------------------------------

def _laden(db, anfrage: Anruf) -> Tuple[str, dict]:
    shop_id = None
    nummer = t.e164(anfrage.angerufen)
    if nummer:
        snap = db.collection(t.LEITUNGEN).document(nummer).get()
        if snap.exists:
            shop_id = (snap.to_dict() or {}).get("shopId")
    if not shop_id and anfrage.laden_id and t.ID_RE.fullmatch(anfrage.laden_id):
        if next(iter(db.collection(t.LEITUNGEN).where("shopId", "==", anfrage.laden_id).limit(1).stream()), None):
            shop_id = anfrage.laden_id
    if not shop_id:
        raise _Nein("kein_laden", "Diese Nummer gehört zu keinem Laden.")
    snap = db.collection("shops").document(shop_id).get()
    shop = (snap.to_dict() or {}) if snap.exists else None
    if shop is None:
        raise _Nein("kein_laden", "Diesen Laden gibt es nicht mehr.")
    if is_suspended(shop):
        raise _Nein("gesperrt", "Dieser Laden nimmt gerade keine Buchungen an.")
    return shop_id, shop


def _finde(items: List[dict], wert: Optional[str]) -> Optional[dict]:
    """Nach ID, sonst nach Name (Groß-/Kleinschreibung egal), sonst ein eindeutiger Teil des Namens"""
    wert = str(wert or "").strip()
    if not wert:
        return None
    by_id = next((i for i in items if i["id"] == wert), None)
    if by_id:
        return by_id
    key = wert.casefold()
    exact = [i for i in items if i["name"].casefold() == key]
    if exact:
        return exact[0]
    part = [i for i in items if key in i["name"].casefold() or (i["name"] and i["name"].casefold() in key)]
    return part[0] if len(part) == 1 else None


def _leistungen(db, shop_id: str) -> List[dict]:
    """Angebotene Leistungen (gelöschte nicht), wie offeredServices im Frontend"""
    items = []
    for snap in db.collection("services").where("shopId", "==", shop_id).stream():
        s = snap.to_dict() or {}
        if not s.get("archived"):
            items.append({**s, "id": snap.id, "name": str(s.get("name") or "").strip()})
    return sorted(items, key=lambda s: s["name"].casefold())


def _leistung(db, shop_id: str, wert: Optional[str]) -> dict:
    alle = _leistungen(db, shop_id)
    hit = _finde(alle, wert)
    if hit:
        return hit
    if not alle:
        raise _Nein("keine_leistungen", "Für diesen Laden sind noch keine Leistungen eingetragen.")
    namen = ", ".join(s["name"] for s in alle)
    raise _Nein("leistung_unbekannt", f"Diese Leistung gibt es hier nicht. Angeboten werden: {namen}.",
                leistungen=[s["name"] for s in alle])


def _personen(db, shop_id: str) -> List[dict]:
    """Aktive Personen des Ladens, wie useStaffData im Frontend"""
    items = []
    for snap in db.collection("staff").where("shopId", "==", shop_id).stream():
        s = snap.to_dict() or {}
        if s.get("isActive"):
            items.append({**s, "id": snap.id, "name": str(s.get("name") or "").strip() or "Team"})
    return _mit_rufnamen(sorted(items, key=lambda s: s["name"].casefold()))


def _mit_rufnamen(personen: List[dict]) -> List[dict]:
    """Zum Ansagen nur der Vorname ("bei Stefan"), der volle Name nur, wenn zwei denselben Vornamen haben"""
    vornamen = [p["name"].split()[0].casefold() for p in personen]
    for p, vorname in zip(personen, vornamen):
        p["rufname"] = p["name"].split()[0] if vornamen.count(vorname) == 1 else p["name"]
    return personen


def _wer(db, shop_id: str, leistung: dict, person: Optional[str]) -> List[dict]:
    """Gewünschte Person oder bei "egal" alle, die die Leistung anbieten (keiner eingetragen: alle) – wie PublicJoinQueue"""
    aktiv = _personen(db, shop_id)
    if not aktiv:
        raise _Nein("niemand", "In diesem Laden ist gerade niemand eingetragen, der Kunden annimmt.")
    wunsch = str(person or "").strip()
    if wunsch.casefold() not in EGAL and "{{" not in wunsch:
        hit = _finde(aktiv, wunsch)
        if not hit:
            namen = ", ".join(p["name"] for p in aktiv)
            raise _Nein("person_unbekannt", f"Diese Person gibt es hier nicht. Hier arbeiten: {namen}.", personen=[p["name"] for p in aktiv])
        return [hit]
    anbieter = [p for p in aktiv if leistung["id"] in (p.get("serviceIds") or [])]
    return anbieter or aktiv


def _name(wert: str) -> str:
    name = " ".join(str(wert or "").split())[:80]
    if not name or "{{" in name:
        raise _Nein("name_fehlt", "Für die Buchung fehlt noch der Name.")
    return name


def _vorlauf_minuten(shop: dict) -> int:
    """Vorlaufzeit für Online-Termine (shops.timeSlotBuffer in Millisekunden) – wie onlineLeadMinutes, booking-rules.ts"""
    try:
        ms = float(shop.get("timeSlotBuffer") or 0)
    except (TypeError, ValueError):
        return 0
    return min(MAX_VORLAUF_MINUTEN, round(ms / 60000)) if ms > 0 else 0


def _monatsgrenze(db, shop_id: str, shop: dict, jetzt: datetime) -> None:
    """Gratis-Tarif: höchstens so viele Kunden im Monat (Nummern und Termine ohne abgesagte) – wie useMonthlyUsage
    (frontend/src/utils/plan-usage.ts), dort gibt es dann online keine Nummern mehr."""
    grenze = PLANS[effective_plan(shop)]["max_customers_per_month"]
    if grenze is None:
        return
    start = datetime(jetzt.year, jetzt.month, 1, tzinfo=BERLIN)
    end = datetime(jetzt.year + (jetzt.month == 12), jetzt.month % 12 + 1, 1, tzinfo=BERLIN)
    query = (db.collection("appointments").where("shopId", "==", shop_id).where("startTime", ">=", start)
             .where("startTime", "<", end).limit(2000))
    if sum(1 for snap in query.stream() if (snap.to_dict() or {}).get("status") != "cancelled") >= grenze:
        raise _Nein("monat_voll", "Über Dranzeit gehen in diesem Monat keine Nummern mehr. Einfach direkt im Laden vorbeikommen.")


# --- Freie Plätze -------------------------------------------------------------------------------------------------------

def _hinter_der_schlange(free: list, appointments: list, jetzt: datetime) -> list:
    """Heute zählt der Stand am Tresen: Hängt die Person hinterher, kommt eine neue Nummer hinter die Wartenden statt
    auf eine Zeit, die schon überholt ist – wie buildDayContext mit projectAt (booking-rules.ts)."""
    now = aware(jetzt)
    lane = [a for a in appointments if isinstance(a.get("startTime"), datetime)
            and aware(a["startTime"]).astimezone(BERLIN).date() == jetzt.date()]
    windows = list(project_lane(lane, now).values())
    return [s for s in free if not any(t.ueberschneidet(aware(s.start_time), aware(s.end_time), w0, w1) for w0, w1 in windows)]


def _plaetze(db, shop_id: str, shop: dict, leistung: dict, personen: List[dict], jetzt: datetime,
             ab: Optional[datetime], anzahl: int, tage: int, nummer: bool) -> List[Platz]:
    """Die nächsten freien Plätze je Person (bis anzahl Stück), zusammen nach Beginn sortiert.
    Termine mit der Vorlaufzeit für Online-Termine, Nummern ohne Vorlauf und heute hinter der Schlange."""
    vorlauf = 0 if nummer else _vorlauf_minuten(shop)
    earliest = max(ab or jetzt, jetzt + timedelta(minutes=vorlauf))
    first_day = earliest.date()
    last_day = first_day + timedelta(days=tage - 1)
    found: List[Platz] = []
    for person in personen:
        inputs = load_timeslot_inputs(db, shop_id, person["id"], [leistung["id"]], first_day, last_day)
        mine: List[Platz] = []
        day = first_day
        while day <= last_day and len(mine) < anzahl:
            slots = timeslots_for_day(inputs, leistung["id"], datetime.combine(day, time())) or []
            free = [s for s in slots if s.is_available and s.start_time > jetzt and s.start_time >= earliest]
            if nummer and day == jetzt.date():
                free = _hinter_der_schlange(free, inputs.appointments, jetzt)
            mine += [(person, s.start_time, s.end_time) for s in free[: anzahl - len(mine)]]
            day += timedelta(days=1)
        found += mine
    return sorted(found, key=lambda p: (p[1], p[0]["name"].casefold()))


def _je_uhrzeit(plaetze: List[Platz], anzahl: int) -> List[Platz]:
    """Bei mehreren Personen jede Uhrzeit nur einmal – am Telefon zählt die Zeit"""
    seen, result = set(), []
    for p in plaetze:
        if p[1] not in seen:
            seen.add(p[1])
            result.append(p)
    return result[:anzahl]


def _noch_frei(db, shop_id: str, leistung: dict, person_id: str, start: datetime) -> Optional[Tuple[datetime, datetime]]:
    """Frisch gerechnet: Ist der Platz nach den Regeln noch frei? Dann (Beginn, Ende), sonst None – wie _slot_still_free"""
    inputs = load_timeslot_inputs(db, shop_id, person_id, [leistung["id"]], start.date(), start.date())
    for slot in timeslots_for_day(inputs, leistung["id"], datetime.combine(start.date(), time())) or []:
        if slot.is_available and slot.start_time == start:
            return slot.start_time, slot.end_time
    return None


def _platz(p: Platz, jetzt: datetime) -> dict:
    person, start, end = p
    return {"platz": t.platz_kennung(person["id"], start), "zeit": t.zeit_text(start, jetzt), "person": person["rufname"],
            "start": start.isoformat(timespec="minutes"), "ende": end.isoformat(timespec="minutes")}


def _aufzaehlung(plaetze: List[Platz], jetzt: datetime) -> str:
    return "; ".join(f"{t.zeit_text(s, jetzt)} bei {p['rufname']}" for p, s, _ in plaetze)


def _preis(value) -> str:
    try:
        euro = float(value)
    except (TypeError, ValueError):
        return ""
    if euro <= 0:
        return ""
    return f"{euro:.0f} €" if euro == int(euro) else f"{euro:.2f} €".replace(".", ",")


def _anlegen(db, shop_id: str, leistung: dict, name: str, anrufer: Optional[str], art: str, candidates: List[Placement]) -> dict:
    """Wie eine Buchung ohne Konto (isAnonymous, mit Tagesnummer), gekennzeichnet "per Telefon" (source)"""
    phone = t.e164(anrufer)
    data = {
        "shopId": shop_id, "serviceId": leistung["id"], "status": "scheduled", "type": art, "isAnonymous": True,
        "customerName": name, **({"customerPhone": phone} if phone else {}), "checkEarlierOptions": False, "source": "telefon",
    }
    created = create_appointment(db, data, candidates, needs_code=True)
    for day in {d for c in candidates for d in c.days()}:
        invalidate_shop_date_cache(shop_id, day, verbose=False)
    return created


def _eigener_termin(appt: Optional[dict], shop_id: str) -> None:
    """Ändern darf der Assistent nur, was er eben in diesem Laden angelegt hat und was noch nicht dran war –
    Termine aus anderen Gesprächen nicht, auch wenn ein Anrufer eine Kennung nennt."""
    if appt is None or appt.get("shopId") != shop_id or appt.get("source") != "telefon":
        raise _Nein("termin_unbekannt", "Diesen Termin finde ich nicht.")
    created = appt.get("createdAt")
    if not isinstance(created, datetime) or datetime.now(timezone.utc) - aware(created) > timedelta(minutes=AENDERN_MINUTEN):
        raise _Nein("zu_spaet", "Diesen Termin kann ich am Telefon nicht mehr ändern. Bitte im Laden Bescheid sagen.")
    if appt.get("status") == "cancelled":
        raise _Nein("abgesagt", "Dieser Termin ist schon abgesagt.")
    if appt.get("status") != "scheduled":
        raise _Nein("schon_dran", "Dieser Termin läuft schon. Bitte im Laden Bescheid sagen.")


def _frueher_dran(shop_id: str, staff_id: str) -> None:
    """Platz frei: "Früher dran" gleich neu verteilen (wie nach /nummer/absagen)"""
    try:
        from app.apis.check_slots import trigger_check_in_background

        trigger_check_in_background(shop_id, staff_id)
    except Exception as e:
        print(f"Früher-dran-Prüfung nach Absage am Telefon nicht angestoßen: {e}")


# --- Endpunkte ----------------------------------------------------------------------------------------------------------

@router.post("/telefon/laden")
def laden(anfrage: Anruf) -> dict:
    """Zu Beginn des Gesprächs: alles, was der Assistent über den Laden wissen muss"""
    db = get_firestore_db()
    try:
        shop_id, shop = _laden(db, anfrage)
    except _Nein as nein:
        return nein.antwort()
    name = str(shop.get("name") or "").strip() or "der Laden"
    jetzt = _jetzt()
    print(f"Telefon {shop_id}: Gespräch beginnt")
    return {
        "ok": True,
        "laden_id": shop_id,
        "name": name,
        "jetzt": f"{t.WOCHENTAGE[jetzt.weekday()]}, {jetzt.day}. {t.MONATE[jetzt.month - 1]} {jetzt.year}, {t.uhrzeit(jetzt)}",
        "adresse": t.adresse(shop),
        "telefon": str(shop.get("phone") or ""),
        "webseite": str(shop.get("website") or ""),
        "beschreibung": str(shop.get("description") or "")[:600],
        "oeffnungszeiten": t.oeffnungszeiten(shop),
        "leistungen": [{"id": s["id"], "name": s["name"], "minuten": int(s.get("duration") or 0), "preis": _preis(s.get("price"))}
                       for s in _leistungen(db, shop_id)],
        "personen": [{"id": p["id"], "name": p["name"], "rufname": p["rufname"]} for p in _personen(db, shop_id)],
        "termine": has_feature(shop, "termine"),
        "ansage": f"Hallo, hier ist der KI-Assistent von {name}.",
    }


@router.post("/telefon/freie-zeiten")
def freie_zeiten(anfrage: ZeitenAnfrage) -> dict:
    db, jetzt = get_firestore_db(), _jetzt()
    try:
        shop_id, shop = _laden(db, anfrage)
        if not has_feature(shop, "termine"):
            raise _Nein("keine_termine", "Termine vergibt dieser Laden nicht im Voraus, nur Nummern für die Schlange von heute.")
        leistung = _leistung(db, shop_id, anfrage.leistung)
        personen = _wer(db, shop_id, leistung, anfrage.person)
        ab = t.ab_zeitpunkt(anfrage.ab)
        if ab and ab > jetzt + timedelta(days=MAX_VORAUS_TAGE):
            raise _Nein("zu_weit", f"So weit im Voraus geht es nicht, höchstens {MAX_VORAUS_TAGE} Tage.")
        anzahl = max(1, min(MAX_ANZAHL, anfrage.anzahl))
        plaetze = _je_uhrzeit(_plaetze(db, shop_id, shop, leistung, personen, jetzt, ab, anzahl, TAGE_TERMIN, nummer=False), anzahl)
    except _Nein as nein:
        return nein.antwort()
    wen = f" bei {personen[0]['rufname']}" if len(personen) == 1 else ""
    if not plaetze:
        von = t.tag_text((ab or jetzt).date(), jetzt.date())
        return {"ok": True, "leistung": leistung["name"], "zeiten": [],
                "ansage": f"In den {TAGE_TERMIN} Tagen ab {von} ist für {leistung['name']}{wen} nichts frei."}
    return {"ok": True, "leistung": leistung["name"], "zeiten": [_platz(p, jetzt) for p in plaetze],
            "ansage": f"Frei für {leistung['name']}: {_aufzaehlung(plaetze, jetzt)}."}


@router.post("/telefon/buchen")
def buchen(anfrage: BuchenAnfrage) -> dict:
    db, jetzt = get_firestore_db(), _jetzt()
    try:
        shop_id, shop = _laden(db, anfrage)
        if not has_feature(shop, "termine"):
            raise _Nein("keine_termine", "Termine vergibt dieser Laden nicht im Voraus, nur Nummern für die Schlange von heute.")
        leistung = _leistung(db, shop_id, anfrage.leistung)
        name = _name(anfrage.name)
        platz = t.platz_aus_kennung(anfrage.platz)
        if platz is None:
            raise _Nein("platz_unlesbar", "Die Zeit ist nicht angekommen. Bitte die freien Zeiten noch einmal abfragen.")
        person_id, start = platz
        person = next((p for p in _personen(db, shop_id) if p["id"] == person_id), None)
        if person is None:
            raise _Nein("person_unbekannt", "Diese Person nimmt hier gerade keine Termine an. Bitte die freien Zeiten noch einmal abfragen.")
        if start < jetzt + timedelta(minutes=_vorlauf_minuten(shop)) or start <= jetzt:
            raise PlatzWeg("Diese Zeit ist zu kurzfristig.")
        frei = _noch_frei(db, shop_id, leistung, person_id, start)
        if frei is None:
            raise PlatzWeg("Der Platz ist gerade weggegangen.")
        termin = _anlegen(db, shop_id, leistung, name, anfrage.anrufer, "booked", [Placement(person_id, aware(frei[0]), aware(frei[1]))])
    except _Nein as nein:
        return nein.antwort()
    except PlatzWeg:
        # Nächste freie Zeiten ab der gewünschten, bei allen, die die Leistung anbieten
        try:
            weiter = _je_uhrzeit(_plaetze(db, shop_id, shop, leistung, _wer(db, shop_id, leistung, None), jetzt, start, 3, TAGE_TERMIN, nummer=False), 3)
        except _Nein:
            weiter = []
        ansage = "Diese Zeit ist leider nicht mehr frei."
        ansage += f" Frei sind noch: {_aufzaehlung(weiter, jetzt)}." if weiter else " In den nächsten Tagen ist nichts mehr frei."
        return {"ok": False, "grund": "platz_weg", "ansage": ansage, "zeiten": [_platz(p, jetzt) for p in weiter]}
    zeit = t.zeit_text(start, jetzt)
    code = termin.get("referenceCode")
    print(f"Telefon {shop_id}: Termin {termin['id']} gebucht, {start:%d.%m. %H:%M} bei {person_id}")
    return {"ok": True, "termin_id": termin["id"], "nummer": code, "zeit": zeit, "person": person["rufname"], "leistung": leistung["name"],
            "ansage": f"Gebucht: {zeit} bei {person['rufname']}, {leistung['name']}." + (f" Die Nummer für den Aufruf ist {code}." if code else "")}


@router.post("/telefon/wartezeit")
def wartezeit(anfrage: WartezeitAnfrage) -> dict:
    db, jetzt = get_firestore_db(), _jetzt()
    try:
        shop_id, shop = _laden(db, anfrage)
        if anfrage.leistung and "{{" not in anfrage.leistung:
            leistung = _leistung(db, shop_id, anfrage.leistung)
        else:
            alle = _leistungen(db, shop_id)
            if not alle:
                raise _Nein("keine_leistungen", "Für diesen Laden sind noch keine Leistungen eingetragen.")
            leistung = min(alle, key=lambda s: int(s.get("duration") or 0) or 9999)
        personen = _wer(db, shop_id, leistung, anfrage.person)
        plaetze = _plaetze(db, shop_id, shop, leistung, personen, jetzt, None, 1, 1, nummer=True)
    except _Nein as nein:
        return nein.antwort()
    if not plaetze:
        ansage = f"Heute ist für {leistung['name']} kein Platz mehr frei."
        if has_feature(shop, "termine"):
            ansage += " Ein Termin an einem anderen Tag geht."
        return {"ok": True, "frei": False, "leistung": leistung["name"], "ansage": ansage}
    person, start, _ = plaetze[0]
    minuten = t.minuten_bis(start, jetzt)
    if minuten <= 5:
        ansage = f"Für {leistung['name']} ist gerade frei, bei {person['rufname']} ab {t.uhrzeit(start)}."
    else:
        ansage = f"Für {leistung['name']} ist der nächste Platz heute gegen {t.uhrzeit(start)} bei {person['rufname']}, also in etwa {t.minuten_text(minuten)}."
    return {"ok": True, "frei": True, "minuten": minuten, "zeit": f"heute gegen {t.uhrzeit(start)}", "person": person["rufname"],
            "leistung": leistung["name"], "ansage": ansage}


@router.post("/telefon/nummer")
def nummer(anfrage: NummerAnfrage) -> dict:
    db, jetzt = get_firestore_db(), _jetzt()
    try:
        shop_id, shop = _laden(db, anfrage)
        leistung = _leistung(db, shop_id, anfrage.leistung)
        personen = _wer(db, shop_id, leistung, anfrage.person)
        name = _name(anfrage.name)
        _monatsgrenze(db, shop_id, shop, jetzt)
        termin = None
        for _ in range(NUMMER_RUNDEN):
            plaetze = _plaetze(db, shop_id, shop, leistung, personen, jetzt, None, NUMMER_KANDIDATEN, 1, nummer=True)
            if not plaetze:
                raise _Nein("voll", f"Heute ist für {leistung['name']} kein Platz mehr frei.")
            try:
                termin = _anlegen(db, shop_id, leistung, name, anfrage.anrufer, "queue",
                                  [Placement(p["id"], aware(s), aware(e)) for p, s, e in plaetze])
                break
            except PlatzWeg:
                continue
        if termin is None:
            raise _Nein("ansturm", "Gerade ziehen sehr viele eine Nummer. Bitte gleich noch einmal versuchen.")
    except _Nein as nein:
        return nein.antwort()
    start = aware(termin["startTime"]).astimezone(BERLIN).replace(tzinfo=None)
    person = next((p for p in personen if p["id"] == termin["staffId"]), {"name": "Team", "rufname": "Team"})
    minuten = t.minuten_bis(start, jetzt)
    code = termin.get("referenceCode")
    print(f"Telefon {shop_id}: Nummer {code} gezogen, {start:%H:%M} bei {termin['staffId']}")
    return {"ok": True, "termin_id": termin["id"], "nummer": code, "zeit": f"heute gegen {t.uhrzeit(start)}", "minuten": minuten,
            "person": person["rufname"], "leistung": leistung["name"],
            "ansage": f"Die Nummer ist {code}. Dran heute gegen {t.uhrzeit(start)} bei {person['rufname']}, "
                      + ("also gleich." if minuten <= 5 else f"in etwa {t.minuten_text(minuten)}.")}


@router.post("/telefon/aendern")
def aendern(anfrage: AendernAnfrage) -> dict:
    """Im selben Gespräch: Name falsch verstanden oder doch keine Zeit. Kein zweites Mal buchen – dann ist der Platz
    vom ersten Termin belegt (Testanruf 27.10.2026). Andere Zeit: hier absagen, dann neu buchen."""
    db, jetzt = get_firestore_db(), _jetzt()
    try:
        shop_id, _ = _laden(db, anfrage)
        if not t.ID_RE.fullmatch(str(anfrage.termin_id or "")):
            raise _Nein("termin_unbekannt", "Diesen Termin finde ich nicht.")
        if anfrage.absagen:
            appt = cancel_appointment(db, anfrage.termin_id, lambda a: _eigener_termin(a, shop_id))
        else:
            name = _name(anfrage.name)
            ref = db.collection("appointments").document(anfrage.termin_id)
            snap = ref.get()
            _eigener_termin((snap.to_dict() or {}) if snap.exists else None, shop_id)
            ref.update({"customerName": name, "updatedAt": datetime.now(timezone.utc)})
            print(f"Telefon {shop_id}: Name an Termin {anfrage.termin_id} berichtigt")
            return {"ok": True, "name": name, "ansage": f"Geändert: Der Termin steht jetzt auf den Namen {name}."}
    except _Nein as nein:
        return nein.antwort()
    start = aware(appt["startTime"]).astimezone(BERLIN).replace(tzinfo=None)
    invalidate_shop_date_cache(shop_id, start.date().isoformat(), verbose=False)
    _frueher_dran(shop_id, appt.get("staffId"))
    print(f"Telefon {shop_id}: Termin {anfrage.termin_id} abgesagt")
    if appt.get("type") == "queue":
        return {"ok": True, "ansage": f"Die Nummer {appt.get('referenceCode')} ist zurückgegeben."}
    person = next((p["rufname"] for p in _personen(db, shop_id) if p["id"] == appt.get("staffId")), "")
    return {"ok": True, "ansage": f"Abgesagt: {t.zeit_text(start, jetzt)}" + (f" bei {person}." if person else ".")}
