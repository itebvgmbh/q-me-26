"""
Tests für den Telefon-Assistenten (app/apis/telefon, app/libs/telefon.py, app/libs/buchung.py) mit nachgebauter
Datenbank. Ohne Firebase-Zugang und ohne pytest lauffähig:

    cd backend && uv run python tests/test_telefon.py

Die Zeit steht fest: "jetzt" ist ein Mittwoch in einer Woche um 10:07 Uhr, der Laden hat jeden Tag 9 bis 18 Uhr offen.
"""
import itertools
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import FakeDb, Query, Ref  # noqa: E402  (setzt auch den Pfad zum Backend)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.telefon as tel  # noqa: E402
from app.libs import buchung, schedule  # noqa: E402
from app.libs import telefon as t  # noqa: E402

BERLIN = schedule.BERLIN
_today = datetime.now(BERLIN).date()
TAG = _today + timedelta(days=7 + (2 - _today.weekday()) % 7)  # ein Mittwoch, mindestens eine Woche voraus
JETZT = datetime.combine(TAG, datetime.min.time()).replace(hour=10, minute=7)
NUMMER = "+493012345678"


def at(hhmm: str, day: date = TAG) -> datetime:
    """Zeitpunkt an einem Tag, wie Firestore ihn zurückgibt (UTC)"""
    h, m = map(int, hhmm.split(":"))
    return datetime(day.year, day.month, day.day, h, m, tzinfo=BERLIN).astimezone(timezone.utc)


# --- Datenbank mit Transaktionen und automatischen IDs -------------------------------------------------------------

_ids = itertools.count(1)


class AutoQuery(Query):
    def where(self, field, op, value):
        q = super().where(field, op, value)
        return AutoQuery(q.db, q.coll, q.filters, q.order, q.max_rows)

    def limit(self, n):
        q = super().limit(n)
        return AutoQuery(q.db, q.coll, q.filters, q.order, q.max_rows)

    def document(self, doc_id=None):
        return Ref(self.db, self.coll, doc_id or f"neu{next(_ids)}")


class Transaction:
    def __init__(self):
        self.writes = []

    def set(self, ref, values, merge=False):
        self.writes.append(lambda: ref.set(dict(values), merge=merge))

    def update(self, ref, values):
        self.writes.append(lambda: ref.update(dict(values)))


class Db(FakeDb):
    def collection(self, name):
        self.data.setdefault(name, {})
        return AutoQuery(self, name)

    def transaction(self, max_attempts=5):
        return Transaction()


def transactional(fn):
    """Wie google.cloud.firestore.transactional: Fehler = nichts geschrieben, sonst alle Schreibvorgänge"""
    def run(tx):
        result = fn(tx)
        for write in tx.writes:
            write()
        return result
    return run


def offen(von="09:00", bis="18:00"):
    return [{"dayOfWeek": d, "isOpen": True, "openTime": von, "closeTime": bis} for d in range(7)]


def arbeitet(von="09:00", bis="18:00"):
    return [{"dayOfWeek": d, "isWorking": True, "startTime": von, "endTime": bis} for d in range(7)]


def daten():
    future = datetime.now(timezone.utc) + timedelta(days=30)
    return {
        "shops": {"laden": {"name": "Salon Schnitt", "street": "Hauptstr. 1", "postalCode": "10115", "city": "Berlin",
                            "businessHoursByDay": offen(), "trialEndsAt": future}},
        "staff": {
            "robin": {"shopId": "laden", "name": "Robin", "isActive": True, "workingHours": arbeitet(), "serviceIds": ["schnitt"]},
            "kim": {"shopId": "laden", "name": "Kim", "isActive": True, "workingHours": arbeitet(), "serviceIds": ["schnitt", "bart"]},
            "weg": {"shopId": "laden", "name": "Ehemalig", "isActive": False, "workingHours": arbeitet(), "serviceIds": ["schnitt"]},
        },
        "services": {
            "schnitt": {"shopId": "laden", "name": "Herrenschnitt", "duration": 30, "setupTime": 0, "price": 25},
            "bart": {"shopId": "laden", "name": "Bart", "duration": 15, "setupTime": 0, "price": 12.5},
            "alt": {"shopId": "laden", "name": "Dauerwelle", "duration": 90, "archived": True},
        },
        "appointments": {},
        "breaks": {},
        "recurring-breaks": {},
        t.LEITUNGEN: {NUMMER: {"shopId": "laden", "nummer": NUMMER}},
    }


def setup(store=None):
    store = store if store is not None else daten()
    db = Db(store)
    tel.get_firestore_db = lambda: db
    tel._jetzt = lambda: JETZT
    tel.invalidate_shop_date_cache = lambda *a, **k: 0
    tel._frueher_dran = lambda *a: None
    buchung.firestore.transactional = transactional
    buchung.random = random.Random(7)
    return db, store


def anruf(**extra):
    return {"angerufen": "030 12345678", **extra}


# --- Rufnummern, Zeiten, Öffnungszeiten ------------------------------------------------------------------------------

def test_rufnummern_in_einer_schreibweise():
    for raw in ("030 12345678", "+49 30 12345678", "+49 (0)30 1234-5678", "004930 12345678", "493012345678"):
        assert t.e164(raw) == NUMMER, raw
    for raw in ("", None, "anonymous", "{{system__caller_id}}", "123", "+0301234567"):
        assert t.e164(raw) is None, raw
    assert t.e164("0151 2345678") == "+491512345678"


def test_zeiten_zum_vorlesen():
    assert t.zeit_text(JETZT.replace(hour=14, minute=30), JETZT) == "heute um 14 Uhr 30"
    assert t.zeit_text(JETZT + timedelta(days=1), JETZT).startswith("morgen um 10 Uhr 7")
    samstag = JETZT + timedelta(days=3)
    assert t.tag_text(samstag.date(), JETZT.date()) == f"Samstag, {samstag.day}. {t.MONATE[samstag.month - 1]}"
    assert t.uhrzeit(JETZT.replace(hour=9, minute=5)) == "9 Uhr 5" and t.uhrzeit(JETZT.replace(hour=15, minute=0)) == "15 Uhr"
    assert t.minuten_text(1) == "eine Minute" and t.minuten_text(75) == "eine Stunde und 15 Minuten"
    assert t.minuten_bis(JETZT + timedelta(seconds=61), JETZT) == 2
    assert t.minuten_bis(JETZT - timedelta(minutes=5), JETZT) == 0


def test_platz_kennung_hin_und_zurueck():
    start = JETZT.replace(hour=14, minute=30)
    assert t.platz_aus_kennung(t.platz_kennung("robin", start)) == ("robin", start)
    for kaputt in ("", "robin", "robin@morgen", "rob in@2026-10-29T14:30", "@2026-10-29T14:30"):
        assert t.platz_aus_kennung(kaputt) is None, kaputt
    assert t.ab_zeitpunkt("2026-10-29") == datetime(2026, 10, 29)
    assert t.ab_zeitpunkt("2026-10-29 15:00") == datetime(2026, 10, 29, 15, 0)
    assert t.ab_zeitpunkt("nächste Woche") is None


def test_oeffnungszeiten_ab_montag_mit_pause_und_ruhetag():
    days = offen()
    days[0] = {"dayOfWeek": 0, "isOpen": False}
    days[3]["breaks"] = [{"startTime": "13:00", "endTime": "14:00"}]
    lines = t.oeffnungszeiten({"businessHoursByDay": days})
    assert lines[0] == "Montag 9 bis 18 Uhr" and lines[6] == "Sonntag geschlossen", lines
    assert lines[2] == "Mittwoch 9 bis 18 Uhr, Pause 13 bis 14 Uhr", lines
    assert t.oeffnungszeiten({"businessHours": "9:00-17:00"}) == ["täglich 9 bis 17 Uhr"]
    assert t.oeffnungszeiten({"businessHours": "9:30-17:00"}) == ["täglich 9 Uhr 30 bis 17 Uhr"]
    assert t.oeffnungszeiten({}) == []


class Wuerfel:
    """Liefert die Zahlen der Reihe nach statt zufällig"""

    def __init__(self, *zahlen):
        self.zahlen = list(zahlen)

    def randint(self, low, high):
        return self.zahlen.pop(0)


def test_tagesnummern_zweistellig_dann_dreistellig():
    rng = random.Random(1)
    assert 10 <= int(buchung.pick_reference_code({"10", "11"}, rng)) <= 99
    assert 100 <= int(buchung.pick_reference_code({str(n) for n in range(10, 70)}, rng)) <= 999, "ab 60 vergebenen dreistellig"
    assert buchung.pick_reference_code({"42"}, Wuerfel(42, 55)) == "55"


# --- Zugang -----------------------------------------------------------------------------------------------------------

def test_zugang_nur_mit_schluessel():
    setup()
    app = FastAPI()
    app.include_router(tel.router, prefix="/routes")
    client = TestClient(app)
    os.environ.pop("QME_TELEFON_TOKEN", None)
    assert client.post("/routes/telefon/laden", json=anruf()).status_code == 503
    os.environ["QME_TELEFON_TOKEN"] = "geheim-und-lang"
    assert client.post("/routes/telefon/laden", json=anruf()).status_code == 401
    assert client.post("/routes/telefon/laden", json=anruf(), headers={"Authorization": "Bearer falsch"}).status_code == 401
    r = client.post("/routes/telefon/laden", json=anruf(), headers={"Authorization": "Bearer geheim-und-lang"})
    assert r.status_code == 200 and r.json()["name"] == "Salon Schnitt", r.text
    os.environ.pop("QME_TELEFON_TOKEN", None)


# --- Laden zum Anruf --------------------------------------------------------------------------------------------------

def test_laden_ueber_die_gewaehlte_nummer():
    setup()
    info = tel.laden(tel.Anruf(**anruf()))
    assert info["ok"] and info["laden_id"] == "laden" and info["ansage"] == "Hallo, hier ist der KI-Assistent von Salon Schnitt."
    assert info["adresse"] == "Hauptstr. 1, 10115 Berlin"
    assert [s["name"] for s in info["leistungen"]] == ["Bart", "Herrenschnitt"], "gelöschte Leistung fehlt"
    assert info["leistungen"][0]["preis"] == "12,50 €" and info["leistungen"][1]["preis"] == "25 €"
    assert [p["name"] for p in info["personen"]] == ["Kim", "Robin"], "deaktivierte Person fehlt"
    assert info["termine"] is True and len(info["oeffnungszeiten"]) == 7


def test_laden_id_nur_fuer_laeden_mit_nummer():
    _, store = setup()
    assert tel.laden(tel.Anruf(laden_id="laden"))["ok"]
    store["shops"]["anders"] = {"name": "Ohne Telefon"}
    nein = tel.laden(tel.Anruf(laden_id="anders"))
    assert not nein["ok"] and nein["grund"] == "kein_laden"
    assert tel.laden(tel.Anruf(angerufen="030 999999", laden_id="{{laden_id}}"))["grund"] == "kein_laden"


def test_gesperrter_laden_nimmt_nichts_an():
    _, store = setup()
    store["shops"]["laden"]["suspended"] = {"at": JETZT}
    nein = tel.freie_zeiten(tel.ZeitenAnfrage(**anruf(), leistung="Herrenschnitt"))
    assert not nein["ok"] and nein["grund"] == "gesperrt"


# --- Freie Zeiten -----------------------------------------------------------------------------------------------------

def test_freie_zeiten_egal_wer_jede_uhrzeit_einmal():
    setup()
    r = tel.freie_zeiten(tel.ZeitenAnfrage(**anruf(), leistung="herrenschnitt"))
    assert r["ok"], r
    assert [(z["start"][11:], z["person"]) for z in r["zeiten"]] == [("10:15", "Kim"), ("10:30", "Kim"), ("10:45", "Kim")], r["zeiten"]
    assert r["ansage"] == "Frei für Herrenschnitt: heute um 10 Uhr 15 bei Kim; heute um 10 Uhr 30 bei Kim; heute um 10 Uhr 45 bei Kim."


def test_freie_zeiten_bei_einer_person_ab_wunschzeit():
    _, store = setup()
    store["appointments"]["a"] = {"shopId": "laden", "staffId": "robin", "status": "scheduled", "startTime": at("15:00"), "endTime": at("16:00")}
    r = tel.freie_zeiten(tel.ZeitenAnfrage(**anruf(), leistung="schnitt", person="robin", ab=f"{TAG}T14:30", anzahl=2))
    assert [z["start"][11:] for z in r["zeiten"]] == ["14:30", "16:00"], r["zeiten"]
    assert r["zeiten"][0]["platz"] == f"robin@{TAG}T14:30"
    nein = tel.freie_zeiten(tel.ZeitenAnfrage(**anruf(), leistung="schnitt", person="Alex"))
    assert nein["grund"] == "person_unbekannt" and nein["personen"] == ["Kim", "Robin"]


def test_vorlauf_fuer_online_termine_gilt_auch_am_telefon():
    _, store = setup()
    store["shops"]["laden"]["timeSlotBuffer"] = 2 * 60 * 60 * 1000
    r = tel.freie_zeiten(tel.ZeitenAnfrage(**anruf(), leistung="schnitt", anzahl=1))
    assert r["zeiten"][0]["start"][11:] == "12:15", r["zeiten"]


def test_unbekannte_leistung_nennt_die_angebotenen():
    setup()
    nein = tel.freie_zeiten(tel.ZeitenAnfrage(**anruf(), leistung="Färben"))
    assert nein["grund"] == "leistung_unbekannt" and nein["leistungen"] == ["Bart", "Herrenschnitt"]
    assert tel.freie_zeiten(tel.ZeitenAnfrage(**anruf(), leistung="Dauerwelle"))["grund"] == "leistung_unbekannt", "gelöscht"


def test_ohne_termine_im_tarif_nur_nummern():
    _, store = setup()
    store["shops"]["laden"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)  # Gratis
    assert tel.freie_zeiten(tel.ZeitenAnfrage(**anruf(), leistung="schnitt"))["grund"] == "keine_termine"
    assert tel.nummer(tel.NummerAnfrage(**anruf(), leistung="schnitt", name="Alex"))["ok"]


# --- Buchen -----------------------------------------------------------------------------------------------------------

def test_buchen_wie_ohne_konto_mit_tagesnummer_und_belegung():
    _, store = setup()
    r = tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="Herrenschnitt", platz=f"robin@{TAG}T10:30", name=" Alex  Muster ",
                                     anrufer="0151 2345678"))
    assert r["ok"], r
    termin = store["appointments"][r["termin_id"]]
    assert termin["startTime"] == at("10:30") and termin["endTime"] == at("11:00") and termin["staffId"] == "robin"
    assert termin["type"] == "booked" and termin["isAnonymous"] is True and termin["source"] == "telefon"
    assert termin["customerName"] == "Alex Muster" and termin["customerPhone"] == "+491512345678"
    assert termin["checkEarlierOptions"] is False and "customerId" not in termin
    code = termin["referenceCode"]
    assert 10 <= int(code) <= 99 and r["nummer"] == code
    assert store["shop_days"][f"laden_{TAG}"]["codes"] == [code]
    assert r["termin_id"] in store["schedules"][f"robin_{TAG}"]["slots"]
    kurz = store["public_appointments"][r["termin_id"]]
    assert kurz["referenceCode"] == code and kurz["shopDay"] == f"laden_{TAG}" and kurz["startTime"] == at("10:30"), kurz
    assert "customerName" not in kurz and "customerPhone" not in kurz, "Name und Nummer nicht öffentlich"
    assert r["ansage"] == f"Gebucht: heute um 10 Uhr 30 bei Robin, Herrenschnitt. Die Nummer für den Aufruf ist {code}."


def test_platz_weg_bietet_die_naechsten_an():
    _, store = setup()
    assert tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="Alex"))["ok"]
    zweiter = tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="Sam"))
    assert not zweiter["ok"] and zweiter["grund"] == "platz_weg", zweiter
    assert f"robin@{TAG}T10:30" not in [z["platz"] for z in zweiter["zeiten"]] and zweiter["zeiten"], zweiter
    assert len(store["appointments"]) == 1


def test_belegung_schuetzt_auch_wenn_die_berechnung_es_noch_nicht_weiss():
    # Der Tresen hat 10:30 gerade gebucht: steht in der Belegung, der Termin selbst ist schon gespeichert,
    # die Berechnung der freien Zeiten lief aber vorher (hier nachgestellt: sie sagt "frei")
    _, store = setup()
    store["appointments"]["T"] = {"shopId": "anderer", "staffId": "robin", "status": "scheduled", "startTime": at("10:30"), "endTime": at("11:00")}
    store["schedules"] = {f"robin_{TAG}": {"slots": {"T": {"start": at("10:30"), "end": at("11:00")}}}}
    r = tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="Alex"))
    assert not r["ok"] and r["grund"] == "platz_weg", r
    assert list(store["appointments"]) == ["T"]


def test_buchen_ohne_name_oder_mit_kaputtem_platz():
    setup()
    assert tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="  "))["grund"] == "name_fehlt"
    assert tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz="morgen 10 Uhr", name="Alex"))["grund"] == "platz_unlesbar"
    assert tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"weg@{TAG}T10:30", name="Alex"))["grund"] == "person_unbekannt"
    vorbei = tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T09:30", name="Alex"))
    assert vorbei["grund"] == "platz_weg", "Zeit ist schon vorbei"


# --- Im selben Gespräch ändern ----------------------------------------------------------------------------------------

def test_name_berichtigen_ohne_zweite_buchung():
    _, store = setup()
    r = tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="Hella Tittmann"))
    neu = tel.aendern(tel.AendernAnfrage(**anruf(), termin_id=r["termin_id"], name=" Ella  Tittmann "))
    assert neu["ok"] and neu["ansage"] == "Geändert: Der Termin steht jetzt auf den Namen Ella Tittmann.", neu
    assert store["appointments"][r["termin_id"]]["customerName"] == "Ella Tittmann" and len(store["appointments"]) == 1
    assert store["appointments"][r["termin_id"]]["status"] == "scheduled"
    assert tel.aendern(tel.AendernAnfrage(**anruf(), termin_id=r["termin_id"], name=""))["grund"] == "name_fehlt"
    # Vapi schickt leere Felder als "" mit, auch bei Ja/Nein
    leer = tel.AendernAnfrage(**anruf(), termin_id=r["termin_id"], name="Ella", absagen="")
    assert leer.absagen is False and tel.AendernAnfrage(**anruf(), termin_id="x", absagen="true").absagen is True


def test_absagen_gibt_den_platz_frei():
    _, store = setup()
    r = tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="Alex"))
    weg = tel.aendern(tel.AendernAnfrage(**anruf(), termin_id=r["termin_id"], absagen=True))
    assert weg["ok"] and weg["ansage"] == "Abgesagt: heute um 10 Uhr 30 bei Robin.", weg
    assert store["appointments"][r["termin_id"]]["status"] == "cancelled"
    assert store["public_appointments"][r["termin_id"]]["status"] == "cancelled"
    assert r["termin_id"] not in store["schedules"][f"robin_{TAG}"]["slots"]
    assert tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="Alex"))["ok"], "Platz wieder frei"
    assert tel.aendern(tel.AendernAnfrage(**anruf(), termin_id=r["termin_id"], absagen=True))["grund"] == "abgesagt"
    nummer = tel.nummer(tel.NummerAnfrage(**anruf(), leistung="Bart", name="Sam"))
    zurueck = tel.aendern(tel.AendernAnfrage(**anruf(), termin_id=nummer["termin_id"], absagen=True))
    assert zurueck["ansage"] == f"Die Nummer {nummer['nummer']} ist zurückgegeben.", zurueck


def test_aendern_nur_eigene_frische_termine():
    _, store = setup()
    store["appointments"]["online"] = {"shopId": "laden", "staffId": "robin", "status": "scheduled", "customerName": "Kim",
                                       "startTime": at("15:00"), "endTime": at("15:30"), "createdAt": datetime.now(timezone.utc)}
    assert tel.aendern(tel.AendernAnfrage(**anruf(), termin_id="online", absagen=True))["grund"] == "termin_unbekannt"
    assert tel.aendern(tel.AendernAnfrage(**anruf(), termin_id="gibtsnicht", name="Alex"))["grund"] == "termin_unbekannt"
    assert tel.aendern(tel.AendernAnfrage(**anruf(), termin_id="../shops/laden", name="Alex"))["grund"] == "termin_unbekannt"
    r = tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="Alex"))
    termin = store["appointments"][r["termin_id"]]
    store["shops"]["anders"] = {"name": "Anderer Laden"}
    store[t.LEITUNGEN]["+493099999999"] = {"shopId": "anders"}
    assert tel.aendern(tel.AendernAnfrage(angerufen="030 99999999", termin_id=r["termin_id"], absagen=True))["grund"] == "termin_unbekannt"
    termin["createdAt"] = datetime.now(timezone.utc) - timedelta(minutes=tel.AENDERN_MINUTEN + 1)
    assert tel.aendern(tel.AendernAnfrage(**anruf(), termin_id=r["termin_id"], absagen=True))["grund"] == "zu_spaet"
    termin["createdAt"] = datetime.now(timezone.utc)
    termin["status"] = "in-progress"
    assert tel.aendern(tel.AendernAnfrage(**anruf(), termin_id=r["termin_id"], name="Sam"))["grund"] == "schon_dran"
    assert store["appointments"]["online"]["status"] == "scheduled" and termin["customerName"] == "Alex"


def test_tagesnummer_nicht_doppelt():
    # 12 steht in shop_days, 42 nur an einem abgesagten Termin von vor den Tagesnummern – beide sind vergeben
    _, store = setup()
    store["appointments"]["alt"] = {"shopId": "laden", "staffId": "kim", "status": "cancelled", "referenceCode": "42",
                                    "startTime": at("09:00"), "endTime": at("09:30")}
    store["shop_days"] = {f"laden_{TAG}": {"codes": ["12"]}}
    buchung.random = Wuerfel(42, 12, 55)
    r = tel.buchen(tel.BuchenAnfrage(**anruf(), leistung="schnitt", platz=f"robin@{TAG}T10:30", name="Alex"))
    assert r["nummer"] == "55" and store["shop_days"][f"laden_{TAG}"]["codes"] == ["12", "55"], r


# --- Schlange: Wartezeit und Nummer -----------------------------------------------------------------------------------

def _schlange_hinkt(store):
    """Robin: 9:50 aufgerufen (30 Min., läuft bis mindestens 10:20), dahinter wartet die Nummer von 10:00"""
    store["appointments"]["dran"] = {"shopId": "laden", "staffId": "robin", "status": "in-progress", "type": "queue",
                                     "startTime": at("09:45"), "endTime": at("10:15"), "lastCalledAt": at("09:50")}
    store["appointments"]["wartet"] = {"shopId": "laden", "staffId": "robin", "status": "scheduled", "type": "queue",
                                       "startTime": at("10:00"), "endTime": at("10:30")}


def test_nummer_kommt_hinter_die_wartenden():
    _, store = setup()
    _schlange_hinkt(store)
    r = tel.nummer(tel.NummerAnfrage(**anruf(), leistung="schnitt", person="Robin", name="Alex", anrufer="{{system__caller_id}}"))
    assert r["ok"], r
    termin = store["appointments"][r["termin_id"]]
    # 10:30 wäre nach Plan frei, aber Robin hängt hinterher: Die Wartende von 10:00 ist erst bis ca. 10:50 dran
    assert termin["startTime"] == at("11:00") and termin["type"] == "queue" and "customerPhone" not in termin, termin
    assert r["zeit"] == "heute gegen 11 Uhr" and r["minuten"] == 53
    assert r["ansage"] == f"Die Nummer ist {r['nummer']}. Dran heute gegen 11 Uhr bei Robin, in etwa 53 Minuten."
    gleich = tel.nummer(tel.NummerAnfrage(**anruf(), leistung="Bart", person="egal", name="Sam"))
    assert gleich["ansage"].endswith("bei Kim, in etwa 8 Minuten."), gleich


def test_nummer_egal_wer_nimmt_den_schnellsten():
    _, store = setup()
    _schlange_hinkt(store)
    r = tel.nummer(tel.NummerAnfrage(**anruf(), leistung="schnitt", name="Alex"))
    assert store["appointments"][r["termin_id"]]["staffId"] == "kim" and r["zeit"] == "heute gegen 10 Uhr 15", r


def test_nummer_nimmt_den_naechsten_wenn_der_erste_beim_speichern_weg_ist():
    _, store = setup()
    store["appointments"]["T"] = {"shopId": "x", "staffId": "kim", "status": "scheduled", "startTime": at("10:15"), "endTime": at("10:45")}
    store["schedules"] = {f"kim_{TAG}": {"slots": {"T": {"start": at("10:15"), "end": at("10:45")}}}}
    r = tel.nummer(tel.NummerAnfrage(**anruf(), leistung="schnitt", person="kim", name="Alex"))
    assert r["ok"] and store["appointments"][r["termin_id"]]["startTime"] == at("10:45"), r


def test_wartezeit_wie_nummer_ziehen():
    _, store = setup()
    _schlange_hinkt(store)
    r = tel.wartezeit(tel.WartezeitAnfrage(**anruf(), leistung="Herrenschnitt", person="Robin"))
    assert r["frei"] and r["minuten"] == 53 and r["zeit"] == "heute gegen 11 Uhr", r
    assert r["ansage"] == "Für Herrenschnitt ist der nächste Platz heute gegen 11 Uhr bei Robin, also in etwa 53 Minuten."
    kurz = tel.wartezeit(tel.WartezeitAnfrage(**anruf()))
    assert kurz["leistung"] == "Bart" and kurz["person"] == "Kim" and kurz["ansage"].startswith("Für Bart ist der nächste Platz heute gegen 10 Uhr 15")


def test_heute_voll():
    _, store = setup()
    for s in store["staff"].values():
        s["workingHours"] = arbeitet("09:00", "10:30")
    r = tel.wartezeit(tel.WartezeitAnfrage(**anruf(), leistung="schnitt"))
    assert r["ok"] and not r["frei"] and r["ansage"] == "Heute ist für Herrenschnitt kein Platz mehr frei. Ein Termin an einem anderen Tag geht."
    store["appointments"]["k"] = {"shopId": "laden", "staffId": "kim", "status": "scheduled", "startTime": at("10:15"), "endTime": at("10:45")}
    store["appointments"]["r"] = {"shopId": "laden", "staffId": "robin", "status": "scheduled", "startTime": at("10:15"), "endTime": at("10:45")}
    assert tel.nummer(tel.NummerAnfrage(**anruf(), leistung="schnitt", name="Alex"))["grund"] == "voll"


def test_gratis_tarif_hoechstens_100_kunden_im_monat():
    _, store = setup()
    store["shops"]["laden"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)  # Gratis
    for i in range(99):
        store["appointments"][f"m{i}"] = {"shopId": "laden", "staffId": "andere", "status": "completed", "startTime": at("09:00"), "endTime": at("09:30")}
    store["appointments"]["abgesagt"] = {"shopId": "laden", "staffId": "andere", "status": "cancelled", "startTime": at("09:00"), "endTime": at("09:30")}
    assert tel.nummer(tel.NummerAnfrage(**anruf(), leistung="schnitt", name="Alex"))["ok"], "Nummer 100 geht noch"
    voll = tel.nummer(tel.NummerAnfrage(**anruf(), leistung="schnitt", name="Sam"))
    assert not voll["ok"] and voll["grund"] == "monat_voll", voll


if __name__ == "__main__":
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith("test_") and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"OK   {name}")
        except AssertionError as e:
            failed += 1
            print(f"FEHL {name}: {e}")
    print(f"{len(tests) - failed}/{len(tests)} bestanden")
    sys.exit(1 if failed else 0)
