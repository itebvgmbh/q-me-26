"""
Tests für die Termin-API der Läden (app/schnittstelle, app/libs/api_schluessel.py, app/apis/api_zugang) mit
nachgebauter Datenbank wie tests/test_telefon.py: Laden jeden Tag 9 bis 18 Uhr, Robin (Herrenschnitt) und Kim
(Herrenschnitt, Bart). Ohne Datenbank und ohne pytest lauffähig:

    cd backend && .venv/bin/python tests/test_termin_api.py
"""
import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_telefon import TAG, Db, at, daten, transactional  # noqa: E402  (setzt auch den Pfad zum Backend)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.schnittstelle as api  # noqa: E402
from app import store as speicher  # noqa: E402
from app.libs import api_schluessel as ak  # noqa: E402
from app.libs import buchung, live  # noqa: E402

ZUKUNFT = datetime.now(timezone.utc) + timedelta(days=30)


def zeit(text: str) -> datetime:
    """Zeit aus einer Antwort der API: immer mit Zeitzone"""
    wert = datetime.fromisoformat(text)
    assert wert.tzinfo is not None, text
    return wert


def setup(store=None):
    store = store if store is not None else daten()
    store["shops"]["laden"]["owner"] = "chefin"
    db = Db(store)
    speicher.db = lambda: db
    import app.apis.firebase_utils as fu
    import app.apis.cache as cache
    import app.apis.check_slots as cs
    import app.libs.notify_worker as nw

    fu.get_firestore_db = lambda: db
    buchung.store.transactional = transactional
    rec = SimpleNamespace(geleert=[], frueher=[], geweckt=[])
    cache.invalidate_shop_date_cache = lambda shop, tag, staff_id=None, verbose=True: rec.geleert.append((shop, tag))
    cs.trigger_check_in_background = lambda shop_id=None, staff_id=None: rec.frueher.append((shop_id, staff_id))
    nw.wake = lambda: rec.geweckt.append(1)
    live.verteiler = SimpleNamespace(melden=lambda kanal: 0)
    _, schluessel = ak.anlegen(db, "laden", "Webseite", "chefin")
    client = TestClient(api.app)
    client.headers["Authorization"] = f"Bearer {schluessel}"
    return client, db, store, rec


def fehler(r, status: int, code: str) -> None:
    assert r.status_code == status, (r.status_code, r.text)
    assert r.json()["fehler"]["code"] == code, r.text
    assert r.json()["fehler"]["meldung"], r.text


def kunde(client, **extra) -> str:
    r = client.post("/kunden", json={"name": "Alex Muster", "email": "alex@example.com", **extra})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def buchen(client, uhrzeit="10:30", day=TAG, **extra):
    body = {"leistung_id": "schnitt", "start": at(uhrzeit, day).isoformat(), **extra}
    if "kunde_id" not in extra and "kunde" not in extra:
        body["kunde"] = {"name": "Sam Beispiel"}
    return client.post("/termine", json=body)


# --- Zugang -----------------------------------------------------------------------------------------------------------

def test_zugang_nur_mit_gueltigem_schluessel():
    client, db, store, _ = setup()
    assert client.get("/laden").status_code == 200
    r = client.get("/laden")
    assert r.json()["id"] == "laden" and r.json()["name"] == "Salon Schnitt" and r.json()["zeitzone"] == "Europe/Berlin"
    ohne = TestClient(api.app)
    fehler(ohne.get("/laden"), 401, "kein_zugang")
    for falsch in ("quatsch", "dz_0123456789abcdef_falschesgeheimnis1234567", client.headers["Authorization"][7:] + "x"):
        fehler(ohne.get("/laden", headers={"Authorization": f"Bearer {falsch}"}), 401, "kein_zugang")
    eintrag = next(iter(store["api_schluessel"]))
    ak.widerrufen(db, "laden", eintrag)
    fehler(client.get("/laden"), 401, "kein_zugang")


def test_schluessel_nur_gehasht_mit_letzter_nutzung():
    client, _, store, _ = setup()
    schluessel = client.headers["Authorization"][7:]
    assert schluessel.startswith("dz_")
    (eintrag,) = store["api_schluessel"].values()
    assert schluessel not in str(eintrag), "Schlüssel im Klartext gespeichert"
    assert eintrag["hash"] == hashlib.sha256(schluessel.encode()).hexdigest() and eintrag["shopId"] == "laden"
    assert not eintrag.get("lastUsedAt")
    client.get("/laden")
    assert isinstance(eintrag.get("lastUsedAt") or store["api_schluessel"][next(iter(store["api_schluessel"]))]["lastUsedAt"], datetime)


def test_tarif_ab_solo_und_gesperrter_laden():
    client, _, store, _ = setup()
    store["shops"]["laden"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)  # Gratis
    fehler(client.get("/laden"), 403, "tarif")
    store["shops"]["laden"]["billing"] = {"plan": "solo", "status": "active"}
    assert client.get("/laden").status_code == 200
    store["shops"]["laden"]["suspended"] = True
    fehler(client.get("/laden"), 403, "gesperrt")


def test_fremder_laden_bleibt_unsichtbar():
    store = daten()
    store["shops"]["laden2"] = {"name": "Anderer", "owner": "fremd", "trialEndsAt": ZUKUNFT}
    store["services"]["fremdleistung"] = {"shopId": "laden2", "name": "Fremd", "duration": 30, "price": 10}
    store["staff"]["fremdperson"] = {"shopId": "laden2", "name": "Fremd", "isActive": True, "serviceIds": []}
    store["customers"] = {"fremdkunde": {"shopId": "laden2", "name": "Fremd", "email": "f@example.com"}}
    store["appointments"]["fremdtermin"] = {"shopId": "laden2", "staffId": "fremdperson", "serviceId": "fremdleistung",
                                            "status": "scheduled", "type": "booked", "startTime": at("10:00"), "endTime": at("10:30")}
    client, _, _, _ = setup(store)
    fehler(client.get("/leistungen/fremdleistung"), 404, "leistung_unbekannt")
    fehler(client.get("/kunden/fremdkunde"), 404, "kunde_unbekannt")
    fehler(client.get("/termine/fremdtermin"), 404, "termin_unbekannt")
    fehler(client.post("/termine/fremdtermin/absagen", json={}), 404, "termin_unbekannt")
    fehler(client.post("/termine/fremdtermin/verschieben", json={"start": at("12:00").isoformat()}), 404, "termin_unbekannt")
    fehler(buchen(client, kunde_id="fremdkunde"), 404, "kunde_unbekannt")
    fehler(buchen(client, regeln="tresen", person_id="fremdperson"), 400, "person_unbekannt")
    assert [k["id"] for k in client.get("/kunden").json()] == []
    assert "fremdperson" not in [p["id"] for p in client.get("/personen").json()]
    assert store["appointments"]["fremdtermin"]["status"] == "scheduled"


# --- Leistungen und Personen --------------------------------------------------------------------------------------------

def test_leistungen_auslesen():
    client, _, _, _ = setup()
    r = client.get("/leistungen")
    assert [s["name"] for s in r.json()] == ["Bart", "Herrenschnitt"], r.text
    bart = r.json()[0]
    assert bart == {"id": "bart", "name": "Bart", "beschreibung": "", "kategorie": "", "dauer_minuten": 15,
                    "ruestzeit_minuten": 0, "preis": 12.5, "archiviert": False}
    assert "Dauerwelle" in [s["name"] for s in client.get("/leistungen", params={"archivierte": "true"}).json()]
    assert client.get("/leistungen/schnitt").json()["preis"] == 25


def test_leistung_anlegen_mit_personen():
    client, _, store, _ = setup()
    r = client.post("/leistungen", json={"name": " Färben ", "dauer_minuten": 60, "preis": 49.9, "ruestzeit_minuten": 10,
                                         "beschreibung": "mit Beratung", "person_ids": ["robin"]})
    assert r.status_code == 201, r.text
    neu = r.json()
    gespeichert = store["services"][neu["id"]]
    assert gespeichert["shopId"] == "laden" and gespeichert["name"] == "Färben" and gespeichert["duration"] == 60
    assert gespeichert["price"] == 49.9 and gespeichert["setupTime"] == 10 and gespeichert["description"] == "mit Beratung"
    assert neu["id"] in store["staff"]["robin"]["serviceIds"] and neu["id"] not in store["staff"]["kim"]["serviceIds"]
    vorher = dict(store["services"])
    assert client.post("/leistungen", json={"name": "Nix", "dauer_minuten": 0}).status_code == 422
    assert client.post("/leistungen", json={"dauer_minuten": 30}).status_code == 422
    fehler(client.post("/leistungen", json={"name": "Fremd", "dauer_minuten": 30, "person_ids": ["gibtsnicht"]}), 400, "person_unbekannt")
    assert store["services"] == vorher, "bei Fehlern nichts angelegt"


def test_personen_auslesen():
    client, _, _, _ = setup()
    personen = {p["id"]: p for p in client.get("/personen").json()}
    assert personen["kim"] == {"id": "kim", "name": "Kim", "aktiv": True, "leistung_ids": ["schnitt", "bart"]}
    assert personen["weg"]["aktiv"] is False


# --- Kunden -------------------------------------------------------------------------------------------------------------

def test_kunde_anlegen_ohne_doppel():
    client, _, store, _ = setup()
    r = client.post("/kunden", json={"name": " Alex  Muster ", "email": "Alex@Example.com", "telefon": "0151 2345678"})
    assert r.status_code == 201, r.text
    k = r.json()
    assert k["name"] == "Alex Muster" and k["email"] == "alex@example.com" and k["telefon"] == "+491512345678"
    assert k["konto_verbunden"] is False and k["quelle"] == "api"
    eintrag = store["customers"][k["id"]]
    assert eintrag["shopId"] == "laden" and eintrag["source"] == "api" and eintrag["isActive"] is False
    nochmal = client.post("/kunden", json={"name": "Alex M.", "email": "alex@example.com"})
    assert nochmal.status_code == 200 and nochmal.json()["id"] == k["id"], nochmal.text
    per_telefon = client.post("/kunden", json={"name": "Alex", "telefon": "+49 151 2345678"})
    assert per_telefon.status_code == 200 and per_telefon.json()["id"] == k["id"]
    assert len(store["customers"]) == 1
    assert client.post("/kunden", json={"email": "x@example.com"}).status_code == 422
    assert client.post("/kunden", json={"name": "X", "email": "keine-adresse"}).status_code == 422


def test_kunden_suchen_und_lesen():
    client, _, _, _ = setup()
    kid = kunde(client, telefon="0151 2345678")
    kunde(client, name="Kara Weber", email="kara@example.com")
    assert [k["id"] for k in client.get("/kunden", params={"email": "ALEX@example.com"}).json()] == [kid]
    assert [k["id"] for k in client.get("/kunden", params={"telefon": "01512345678"}).json()] == [kid]
    assert [k["name"] for k in client.get("/kunden", params={"name": "weber"}).json()] == ["Kara Weber"]
    assert [k["name"] for k in client.get("/kunden").json()] == ["Alex Muster", "Kara Weber"]
    assert client.get(f"/kunden/{kid}").json()["email"] == "alex@example.com"
    fehler(client.get("/kunden/gibtsnicht"), 404, "kunde_unbekannt")


# --- Freie Zeiten -------------------------------------------------------------------------------------------------------

def test_freie_zeiten_wie_online():
    client, _, _, _ = setup()
    r = client.get("/freie-zeiten", params={"leistung_id": "schnitt", "ab": at("09:00").isoformat(), "anzahl": 3})
    assert r.status_code == 200, r.text
    zeiten = r.json()
    assert len(zeiten) == 3 and zeit(zeiten[0]["start"]) == at("09:00") and zeit(zeiten[0]["ende"]) == at("09:30")
    assert {z["person_id"] for z in zeiten} <= {"robin", "kim"}
    nur_kim = client.get("/freie-zeiten", params={"leistung_id": "schnitt", "person_id": "kim", "ab": at("17:00").isoformat()}).json()
    assert nur_kim and {z["person_id"] for z in nur_kim} == {"kim"} and zeit(nur_kim[0]["start"]) == at("17:00")
    assert all(zeit(z["start"]) < at("18:00") or zeit(z["start"]).date() > TAG for z in nur_kim), "nach Ladenschluss"
    fehler(client.get("/freie-zeiten", params={"leistung_id": "gibtsnicht"}), 404, "leistung_unbekannt")
    fehler(client.get("/freie-zeiten", params={"leistung_id": "bart", "person_id": "robin"}), 400, "person_bietet_nicht_an")


# --- Termine anlegen ----------------------------------------------------------------------------------------------------

def test_termin_online_fuer_kunden_aus_der_liste():
    client, _, store, rec = setup()
    kid = kunde(client, telefon="0151 2345678")
    r = buchen(client, kunde_id=kid, person_id="robin")
    assert r.status_code == 201, r.text
    t = r.json()
    a = store["appointments"][t["id"]]
    assert a["shopId"] == "laden" and a["staffId"] == "robin" and a["serviceId"] == "schnitt" and a["source"] == "api"
    assert a["startTime"] == at("10:30") and a["endTime"] == at("11:00") and a["type"] == "booked" and a["status"] == "scheduled"
    assert a["customerId"] == kid and a["customerName"] == "Alex Muster" and a["customerPhone"] == "+491512345678"
    assert a["price"] == 25 and a["checkEarlierOptions"] is False and "referenceCode" not in a
    assert a["teamNotice"] == "new", "Team bekommt Bescheid wie bei einer Online-Buchung"
    assert t["id"] in store["schedules"][f"robin_{TAG}"]["slots"]
    assert t["status"] == "geplant" and t["art"] == "termin" and t["kunde_id"] == kid and t["person_id"] == "robin"
    assert zeit(t["start"]) == at("10:30") and zeit(t["ende"]) == at("11:00") and t["quelle"] == "api"
    assert ("laden", TAG.isoformat()) in rec.geleert and rec.geweckt
    assert client.get(f"/termine/{t['id']}").json() == t


def test_termin_online_ohne_person_nimmt_die_naechste_freie():
    client, _, store, _ = setup()
    assert buchen(client, person_id="robin").status_code == 201
    r = buchen(client)
    assert r.status_code == 201 and r.json()["person_id"] == "kim", r.text
    voll = buchen(client)
    fehler(voll, 409, "platz_weg")
    alternativen = voll.json()["fehler"]["alternativen"]
    assert alternativen and zeit(alternativen[0]["start"]) >= at("11:00"), voll.text
    assert len(store["appointments"]) == 2


def test_online_nur_in_den_oeffnungszeiten_tresen_auch_ausserhalb():
    client, _, store, _ = setup()
    fehler(buchen(client, "19:00", person_id="robin"), 409, "platz_weg")
    r = buchen(client, "19:00", person_id="robin", regeln="tresen")
    assert r.status_code == 201, r.text
    assert zeit(r.json()["ende"]) == at("19:30") and store["appointments"][r.json()["id"]]["staffId"] == "robin"
    fehler(buchen(client, "19:15", person_id="robin", regeln="tresen"), 409, "platz_weg")
    fehler(buchen(client, "20:00", regeln="tresen"), 400, "person_fehlt")
    assert buchen(client, "19:15", person_id="kim", regeln="tresen").status_code == 201
    assert client.post("/termine", json={"leistung_id": "schnitt", "start": at("10:00").isoformat(), "kunde": {"name": "X"},
                                         "regeln": "irgendwie"}).status_code == 422


def test_termin_mit_neuem_kunden_legt_eintrag_an():
    client, _, store, _ = setup()
    r = buchen(client, kunde={"name": "Sam Beispiel", "telefon": "0170 1234567"}, person_id="robin")
    assert r.status_code == 201, r.text
    (kid, eintrag), = store["customers"].items()
    assert eintrag["source"] == "api" and eintrag["phone"] == "+491701234567" and r.json()["kunde_id"] == kid
    assert store["appointments"][r.json()["id"]]["customerId"] == kid
    zweiter = buchen(client, "11:00", kunde={"name": "Sam", "telefon": "+49 170 1234567"}).json()
    assert zweiter["kunde_id"] == kid
    fehler(buchen(client, "11:00", person_id=zweiter["person_id"], kunde={"name": "Neu", "email": "neu@example.com"}), 409, "platz_weg")
    assert len(store["customers"]) == 1, "Platz weg: kein Eintrag zurückgelassen"


def test_termin_prueft_kunde_leistung_und_vorlauf():
    client, _, store, _ = setup()
    fehler(client.post("/termine", json={"leistung_id": "schnitt", "start": at("10:00").isoformat()}), 400, "kunde_fehlt")
    fehler(buchen(client, kunde_id="gibtsnicht"), 404, "kunde_unbekannt")
    fehler(buchen(client, leistung_id="alt"), 404, "leistung_unbekannt")
    fehler(buchen(client, leistung_id="bart", person_id="robin"), 400, "person_bietet_nicht_an")
    gestern = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    for regeln in ("online", "tresen"):
        r = client.post("/termine", json={"leistung_id": "schnitt", "start": gestern, "person_id": "robin", "kunde": {"name": "X"}, "regeln": regeln})
        fehler(r, 409, "zu_kurzfristig")
    store["shops"]["laden"]["timeSlotBuffer"] = 2 * 60 * 60 * 1000
    bald = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    fehler(client.post("/termine", json={"leistung_id": "schnitt", "start": bald, "kunde": {"name": "X"}}), 409, "zu_kurzfristig")
    assert store["appointments"] == {} and not store.get("customers")


def test_ohne_zeitzone_gilt_deutsche_zeit():
    client, _, store, _ = setup()
    r = client.post("/termine", json={"leistung_id": "schnitt", "start": f"{TAG.isoformat()}T10:30", "kunde": {"name": "X"}})
    assert r.status_code == 201, r.text
    assert store["appointments"][r.json()["id"]]["startTime"] == at("10:30")


def test_frueher_dran():
    store = daten()
    store["customers"] = {"k1": {"shopId": "laden", "name": "Kara Konto", "email": "kara@example.com", "userId": "konto1", "isActive": True}}
    client, _, store, rec = setup(store)
    r = buchen(client, kunde_id="k1", person_id="robin", frueher_dran=True)
    assert r.status_code == 201, r.text
    a = store["appointments"][r.json()["id"]]
    assert a["checkEarlierOptions"] is True and isinstance(a["checkEarlierOptionsCreatedAt"], datetime)
    assert a["customerId"] == "konto1", "Termin gehört dem verbundenen Konto, wie am Tresen"
    assert r.json()["frueher_dran"] is True and r.json()["frueher_dran_erreichbar"] is True and r.json()["kunde_id"] == "k1"
    assert ("laden", "robin") in rec.frueher, "„Früher dran“ sucht gleich nach einem Platz"
    ohne_konto = buchen(client, "12:00", kunde={"name": "Neu"}, frueher_dran=True)
    assert ohne_konto.json()["frueher_dran"] is True and ohne_konto.json()["frueher_dran_erreichbar"] is False
    store["shops"]["laden"]["billing"] = {"plan": "solo", "status": "active"}
    store["shops"]["laden"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)
    assert buchen(client, "13:00", frueher_dran=True).status_code == 201, "Solo hat „Früher dran“"


# --- Verschieben und absagen ------------------------------------------------------------------------------------------

def test_verschieben_online_auch_ueber_den_eigenen_alten_platz():
    client, _, store, rec = setup()
    tid = buchen(client, person_id="robin").json()["id"]
    r = client.post(f"/termine/{tid}/verschieben", json={"start": at("10:45").isoformat()})
    assert r.status_code == 200, r.text
    a = store["appointments"][tid]
    assert a["startTime"] == at("10:45") and a["endTime"] == at("11:15") and a["staffId"] == "robin"
    assert a["customerNotice"] == "moved" and a["customerNoticePreviousStart"] == at("10:30")
    assert store["schedules"][f"robin_{TAG}"]["slots"][tid]["start"] == at("10:45")
    assert zeit(r.json()["start"]) == at("10:45") and ("laden", "robin") in rec.frueher
    zu_kim = client.post(f"/termine/{tid}/verschieben", json={"start": at("14:00").isoformat(), "person_id": "kim"})
    assert zu_kim.status_code == 200 and store["appointments"][tid]["staffId"] == "kim", zu_kim.text
    assert tid not in store["schedules"][f"robin_{TAG}"]["slots"]


def test_verschieben_ohne_nachricht_und_nach_tresen_regeln():
    client, _, store, _ = setup()
    tid = buchen(client, person_id="robin").json()["id"]
    buchen(client, "12:00", person_id="robin")
    fehler(client.post(f"/termine/{tid}/verschieben", json={"start": at("12:00").isoformat()}), 409, "platz_weg")
    fehler(client.post(f"/termine/{tid}/verschieben", json={"start": at("19:00").isoformat()}), 409, "platz_weg")
    r = client.post(f"/termine/{tid}/verschieben", json={"start": at("19:00").isoformat(), "regeln": "tresen", "kunde_benachrichtigen": False})
    assert r.status_code == 200, r.text
    assert store["appointments"][tid]["startTime"] == at("19:00") and "customerNotice" not in store["appointments"][tid]
    fehler(client.post(f"/termine/{tid}/verschieben", json={"start": at("12:15").isoformat(), "regeln": "tresen"}), 409, "platz_weg")
    store["appointments"][tid]["status"] = "in-progress"
    fehler(client.post(f"/termine/{tid}/verschieben", json={"start": at("15:00").isoformat()}), 409, "nicht_offen")


def test_absagen_durch_den_laden():
    client, _, store, rec = setup()
    tid = buchen(client, person_id="robin").json()["id"]
    r = client.post(f"/termine/{tid}/absagen", json={})
    assert r.status_code == 200 and r.json()["status"] == "abgesagt", r.text
    a = store["appointments"][tid]
    assert a["status"] == "cancelled" and a["customerNotice"] == "cancelled"
    assert tid not in store["schedules"][f"robin_{TAG}"]["slots"] and store["public_appointments"][tid]["status"] == "cancelled"
    assert ("laden", "robin") in rec.frueher, "frei gewordener Platz geht an „Früher dran“"
    assert client.post(f"/termine/{tid}/absagen", json={}).status_code == 200, "zweimal absagen ist kein Fehler"
    still = buchen(client, "12:00").json()["id"]
    client.post(f"/termine/{still}/absagen", json={"kunde_benachrichtigen": False})
    assert store["appointments"][still]["status"] == "cancelled" and "customerNotice" not in store["appointments"][still]
    fertig = buchen(client, "13:00").json()["id"]
    store["appointments"][fertig]["status"] = "completed"
    fehler(client.post(f"/termine/{fertig}/absagen", json={}), 409, "nicht_offen")


def test_absagen_durch_den_kunden_meldet_es_dem_team():
    client, _, store, _ = setup()
    tid = buchen(client, person_id="robin").json()["id"]
    store["appointments"][tid].update(teamNotice=None, teamNoticeAt=None)  # „Neue Buchung“ ist raus
    r = client.post(f"/termine/{tid}/absagen", json={"durch_kunde": True})
    assert r.status_code == 200, r.text
    a = store["appointments"][tid]
    assert a["status"] == "cancelled" and a["teamNotice"] == "cancelled" and not a.get("customerNotice")
    assert tid not in store["schedules"][f"robin_{TAG}"]["slots"]


# --- Termine auflisten ------------------------------------------------------------------------------------------------

def test_termine_auflisten():
    client, _, _, _ = setup()
    kid = kunde(client)
    zwei = buchen(client, "14:00", kunde_id=kid).json()["id"]
    eins = buchen(client, "10:00").json()["id"]
    spaeter = buchen(client, "10:00", day=TAG + timedelta(days=3)).json()["id"]
    von, bis = at("00:00").isoformat(), at("00:00", TAG + timedelta(days=1)).isoformat()
    r = client.get("/termine", params={"von": von, "bis": bis})
    assert [t["id"] for t in r.json()] == [eins, zwei], r.text
    assert [t["id"] for t in client.get("/termine", params={"von": von, "bis": bis, "kunde_id": kid}).json()] == [zwei]
    alle = client.get("/termine", params={"von": von, "bis": at("00:00", TAG + timedelta(days=7)).isoformat()}).json()
    assert spaeter in [t["id"] for t in alle]
    client.post(f"/termine/{eins}/absagen", json={})
    assert [t["id"] for t in client.get("/termine", params={"von": von, "bis": bis, "status": "abgesagt"}).json()] == [eins]
    fehler(client.get("/termine", params={"von": bis, "bis": von}), 400, "zeitraum")
    fehler(client.get("/termine", params={"von": von, "bis": at("00:00", TAG + timedelta(days=60)).isoformat()}), 400, "zeitraum")


# --- Bremse und Beschreibung -------------------------------------------------------------------------------------------

def test_bremse_je_schluessel():
    client, _, _, _ = setup()
    vorher = api.MAX_ANFRAGEN
    api.MAX_ANFRAGEN = 3
    try:
        for _ in range(3):
            assert client.get("/laden").status_code == 200
        fehler(client.get("/laden"), 429, "zu_viele")
        anderer, _ = setup()[0], None
        assert anderer.get("/laden").status_code == 200, "anderer Schlüssel hat seine eigene Bremse"
    finally:
        api.MAX_ANFRAGEN = vorher


def test_beschreibung_zum_ausprobieren():
    client = TestClient(api.app)
    schema = client.get("/openapi.json").json()
    assert {"/termine", "/termine/{termin_id}/verschieben", "/termine/{termin_id}/absagen", "/kunden", "/leistungen",
            "/freie-zeiten"} <= set(schema["paths"])
    assert client.get("/docs").status_code == 200


def test_beschreibung_reicht_einem_fremden_entwickler():
    """Wer nur die Beschreibung hat (Swagger, ReDoc, Postman, Code-Generator), weiß, was zurückkommt und was schiefgehen kann"""
    client = TestClient(api.app)
    schema = client.get("/openapi.json").json()
    assert schema["servers"] == [{"url": "https://dranzeit.de/api/v1", "description": "Dranzeit"}], "absolute Adresse für Postman und Generatoren"
    redoc = client.get("/redoc").text
    assert "redoc@next" not in redoc and "redoc@2.1.5" in redoc, "redoc@next läuft nicht mehr im Browser (import.meta)"
    assert "/openapi.json" in redoc
    text = schema["info"]["description"]
    for abschnitt in ("Erste Schritte", "Früher dran", "Änderungen abgleichen", "Fehlercodes", "Testen", "Noch nicht dabei"):
        assert abschnitt in text, abschnitt
    teile = schema["components"]["schemas"]

    def antwort(pfad, methode, status):
        inhalt = schema["paths"][pfad][methode]["responses"][status]["content"]["application/json"]["schema"]
        return inhalt.get("$ref") or inhalt.get("items", {}).get("$ref")

    assert antwort("/termine", "post", "201").endswith("/Termin")
    assert antwort("/termine", "get", "200").endswith("/Termin")
    assert antwort("/freie-zeiten", "get", "200").endswith("/FreieZeit")
    assert antwort("/kunden", "post", "201").endswith("/Kunde") and antwort("/leistungen", "get", "200").endswith("/Leistung")
    assert {"id", "status", "start", "ende", "kunde_id", "frueher_dran", "frueher_dran_erreichbar", "geaendert"} <= set(teile["Termin"]["properties"])
    for pfad, ops in schema["paths"].items():
        for methode, op in ops.items():
            for status in ("401", "403", "429"):
                assert antwort(pfad, methode, status).endswith("/Fehler"), (pfad, methode, status)
    assert antwort("/termine", "post", "409").endswith("/Fehler") and antwort("/termine/{termin_id}", "get", "404").endswith("/Fehler")
    assert antwort("/termine", "post", "422").endswith("/Fehler"), "422 im Format der API, nicht im FastAPI-Format"
    assert teile["TerminNeu"].get("examples") and teile["KundeNeu"].get("examples") and teile["LeistungNeu"].get("examples")


# --- Schlüssel verwalten (Inhaber, mit Anmeldung) ---------------------------------------------------------------------

def inhaber_client(store, uid):
    import app.apis.api_zugang as zugang
    from databutton_app.mw.auth_mw import get_authorized_user

    app = FastAPI()
    app.include_router(zugang.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=f"{uid}@example.com", email_verified=True)
    return TestClient(app)


def test_schluessel_verwalten_nur_der_inhaber():
    api_client, _, store, _ = setup()
    store["staff"]["robin"]["userId"] = "robin-konto"
    c = inhaber_client(store, "chefin")
    r = c.post("/routes/team/laeden/laden/api-schluessel", json={"name": "Kasse"})
    assert r.status_code == 200, r.text
    neu = r.json()
    assert neu["schluessel"].startswith("dz_") and neu["eintrag"]["name"] == "Kasse"
    liste = c.get("/routes/team/laeden/laden/api-schluessel").json()["schluessel"]
    assert sorted(e["name"] for e in liste) == ["Kasse", "Webseite"]
    assert all(set(e) == {"id", "name", "anfang", "angelegt", "zuletzt_benutzt"} for e in liste), liste
    assert neu["schluessel"] not in str(liste) and liste[0]["anfang"].startswith("dz_")
    mit_neuem = TestClient(api.app, headers={"Authorization": f"Bearer {neu['schluessel']}"})
    assert mit_neuem.get("/laden").status_code == 200
    team = inhaber_client(store, "robin-konto")
    assert team.get("/routes/team/laeden/laden/api-schluessel").status_code == 403
    assert team.post("/routes/team/laeden/laden/api-schluessel", json={"name": "X"}).status_code == 403
    assert team.post(f"/routes/team/laeden/laden/api-schluessel/{neu['eintrag']['id']}/widerrufen").status_code == 403
    assert c.post(f"/routes/team/laeden/laden/api-schluessel/{neu['eintrag']['id']}/widerrufen").status_code == 200
    fehler(mit_neuem.get("/laden"), 401, "kein_zugang")
    assert api_client.get("/laden").status_code == 200, "der andere Schlüssel gilt weiter"
    assert [e["name"] for e in c.get("/routes/team/laeden/laden/api-schluessel").json()["schluessel"]] == ["Webseite"]
    assert c.post("/routes/team/laeden/laden/api-schluessel/gibtsnicht/widerrufen").status_code == 404


def test_schluessel_nur_mit_tarif_und_hoechstens_zehn():
    _, _, store, _ = setup()
    c = inhaber_client(store, "chefin")
    for i in range(ak.MAX_AKTIV - 1):
        assert c.post("/routes/team/laeden/laden/api-schluessel", json={"name": f"S{i}"}).status_code == 200
    r = c.post("/routes/team/laeden/laden/api-schluessel", json={"name": "zu viel"})
    assert r.status_code == 400, r.text
    store["shops"]["laden"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)
    store["api_schluessel"].clear()
    r = c.post("/routes/team/laeden/laden/api-schluessel", json={"name": "Gratis"})
    assert r.status_code == 403, r.text
    stand = c.get("/routes/team/laeden/laden/api-schluessel").json()
    assert stand["schluessel"] == [] and stand["tarif"] is False


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
