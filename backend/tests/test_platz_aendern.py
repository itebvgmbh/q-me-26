"""
Tests für den festen Termin ohne Konto und „Platz ändern“ (app/apis/nummer, app/libs/online_platz.py) mit
nachgebauter Datenbank (wie tests/test_telefon.py: Laden jeden Tag 9 bis 18 Uhr, Robin und Kim). Ohne Firebase-Zugang
und ohne pytest lauffähig:

    cd backend && uv run python tests/test_platz_aendern.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_telefon import TAG, Db, at, daten, transactional  # noqa: E402  (setzt auch den Pfad zum Backend)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.nummer as nummer  # noqa: E402
from app.libs import buchung  # noqa: E402
from app.libs.links import token_hash  # noqa: E402
from app.libs.schedule import Placement  # noqa: E402

KEY = "Schluessel-der-Nummer-1234567890"


def setup(store=None, uid=None):
    store = store if store is not None else daten()
    db = Db(store)
    nummer.get_firestore_db = lambda: db
    nummer.invalidate_shop_date_cache = lambda *a, **k: 0
    nummer._frueher_dran_neu = lambda *a: None
    nummer.throttle = lambda *a, **k: None
    nummer.request_uid = lambda request: uid
    buchung.firestore.transactional = transactional
    app = FastAPI()
    app.include_router(nummer.router)
    return TestClient(app), db, store


def termin(client, uhrzeit="10:30", staff=("robin",), **extra):
    body = {"shop_id": "laden", "service_id": "schnitt", "staff_ids": list(staff), "start": at(uhrzeit).isoformat(),
            "key_hash": token_hash(KEY), "name": " Alex  Muster ", **extra}
    return client.post("/nummer/termin", json=body)


def nummer_ziehen(db, uhrzeit="11:00", staff="robin", **extra):
    """Nummer wie aus dem Browser: Schlange, ohne Konto, mit Schlüssel und Tagesnummer"""
    start = at(uhrzeit)
    data = {"shopId": "laden", "serviceId": "schnitt", "status": "scheduled", "type": "queue", "isAnonymous": True,
            "ticketKeyHash": token_hash(KEY), "customerName": "Sam", "checkEarlierOptions": True, **extra}
    return buchung.create_appointment(db, data, [Placement(staff, start, start + timedelta(minutes=30))], needs_code=True)


def verschieben(client, appointment_id, uhrzeit="15:00", staff=("kim",), key=KEY, day=TAG):
    body = {"appointment_id": appointment_id, "staff_ids": list(staff), "start": at(uhrzeit, day).isoformat()}
    if key:
        body["key"] = key
    return client.post("/nummer/verschieben", json=body)


# --- Fester Termin ohne Konto -------------------------------------------------------------------------------------------

def test_termin_ohne_konto_mit_schluessel_tagesnummer_und_belegung():
    client, _, store = setup()
    r = termin(client, phone=" 0151 2345678 ", language="tr")
    assert r.status_code == 200, r.text
    appt_id = r.json()["appointment_id"]
    appt = store["appointments"][appt_id]
    assert appt["type"] == "booked" and appt["isAnonymous"] is True and "customerId" not in appt
    assert appt["ticketKeyHash"] == token_hash(KEY) and appt["customerName"] == "Alex Muster"
    assert appt["customerPhone"] == "0151 2345678" and appt["language"] == "tr" and appt["checkEarlierOptions"] is False
    assert appt["startTime"] == at("10:30") and appt["endTime"] == at("11:00") and appt["staffId"] == "robin"
    assert appt["teamNotice"] == "new" and appt["teamNewAt"], "Team bekommt Bescheid wie bei jeder Online-Buchung"
    code = appt["referenceCode"]
    assert code and r.json()["reference_code"] == code and store["shop_days"][f"laden_{TAG}"]["codes"] == [code]
    assert appt_id in store["schedules"][f"robin_{TAG}"]["slots"]
    kurz = store["public_appointments"][appt_id]
    assert kurz["type"] == "booked" and "customerName" not in kurz and "ticketKeyHash" not in kurz


def test_termin_egal_wer_nimmt_die_naechste_freie_person():
    client, _, store = setup()
    assert termin(client, staff=("robin",)).status_code == 200
    r = termin(client, staff=("robin", "kim"))
    assert r.status_code == 200, r.text
    assert store["appointments"][r.json()["appointment_id"]]["staffId"] == "kim"
    voll = termin(client, staff=("robin", "kim"))
    assert voll.status_code == 409 and "weggegangen" in voll.json()["detail"], voll.text


def test_termin_nur_mit_termin_tarif_und_passender_person():
    client, _, store = setup()
    assert termin(client, staff=("weg",)).status_code == 409, "inaktive Person bucht niemand"
    assert termin(client, staff=("robin",), service_id="bart").status_code == 409, "Robin bietet keinen Bart an"
    assert termin(client, service_id="alt").status_code == 404, "archivierte Leistung"
    store["shops"]["laden"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)  # Gratis
    r = termin(client)
    assert r.status_code == 403 and "keine festen Termine" in r.json()["detail"], r.text
    assert store["appointments"] == {}


def test_termin_nicht_kurzfristiger_als_der_vorlauf():
    client, _, store = setup()
    store["shops"]["laden"]["timeSlotBuffer"] = 2 * 60 * 60 * 1000
    jetzt = datetime.now(timezone.utc) + timedelta(minutes=30)
    body = {"shop_id": "laden", "service_id": "schnitt", "staff_ids": ["robin"], "start": jetzt.isoformat(),
            "key_hash": token_hash(KEY), "name": "Alex"}
    r = client.post("/nummer/termin", json=body)
    assert r.status_code == 409 and "kurzfristig" in r.json()["detail"], r.text


# --- Platz ändern -----------------------------------------------------------------------------------------------------

def test_verschieben_mit_schluessel_wird_termin_und_gibt_den_alten_platz_frei():
    client, db, store = setup()
    appt = nummer_ziehen(db)
    code = appt["referenceCode"]
    r = verschieben(client, appt["id"])
    assert r.status_code == 200, r.text
    neu = store["appointments"][appt["id"]]
    assert neu["startTime"] == at("15:00") and neu["endTime"] == at("15:30") and neu["staffId"] == "kim"
    assert neu["type"] == "booked" and neu["checkEarlierOptions"] is False and neu["referenceCode"] == code
    assert appt["id"] not in store["schedules"][f"robin_{TAG}"]["slots"], "alter Platz frei"
    assert appt["id"] in store["schedules"][f"kim_{TAG}"]["slots"]
    kurz = store["public_appointments"][appt["id"]]
    assert kurz["startTime"] == at("15:00") and kurz["staffId"] == "kim" and kurz["type"] == "booked"
    assert r.json()["reference_code"] == code


def test_verschieben_nur_mit_schluessel_oder_eigenem_konto():
    client, db, store = setup()
    appt = nummer_ziehen(db)
    r = verschieben(client, appt["id"], key="Falscher-Schluessel-123456789")
    assert r.status_code == 403, r.text
    assert verschieben(client, appt["id"], key=None).status_code == 403
    assert store["appointments"][appt["id"]]["startTime"] == at("11:00")
    # Mit Konto: nur der eigene Termin
    eigen = nummer_ziehen(db, uhrzeit="12:00", isAnonymous=False, customerId="uid1", ticketKeyHash=None)
    client, _, _ = setup(store, uid="uid2")
    assert verschieben(client, eigen["id"], key=None).status_code == 403
    client, _, _ = setup(store, uid="uid1")
    r = verschieben(client, eigen["id"], key=None, uhrzeit="16:00")
    assert r.status_code == 200, r.text
    assert store["appointments"][eigen["id"]]["startTime"] == at("16:00")


def test_verschieben_an_einen_anderen_tag_bekommt_eine_tagesnummer_dort():
    client, db, store = setup()
    appt = nummer_ziehen(db)
    morgen = TAG + timedelta(days=1)
    store["shop_days"][f"laden_{morgen}"] = {"shopId": "laden", "day": str(morgen), "codes": ["42"]}
    r = verschieben(client, appt["id"], uhrzeit="10:00", staff=("robin",), day=morgen)
    assert r.status_code == 200, r.text
    neu = store["appointments"][appt["id"]]
    assert neu["startTime"] == at("10:00", morgen)
    code = neu["referenceCode"]
    assert code != "42" and store["shop_days"][f"laden_{morgen}"]["codes"] == ["42", code]
    assert store["public_appointments"][appt["id"]]["referenceCode"] == code


def test_verschieben_auf_belegten_platz_aendert_nichts():
    client, db, store = setup()
    appt = nummer_ziehen(db)
    nummer_ziehen(db, uhrzeit="15:00", staff="kim")
    r = verschieben(client, appt["id"])
    assert r.status_code == 409, r.text
    assert store["appointments"][appt["id"]]["startTime"] == at("11:00") and store["appointments"][appt["id"]]["staffId"] == "robin"
    assert appt["id"] in store["schedules"][f"robin_{TAG}"]["slots"], "alter Platz bleibt"


def test_verschieben_nur_solange_die_nummer_wartet():
    client, db, store = setup()
    appt = nummer_ziehen(db)
    store["appointments"][appt["id"]]["status"] = "in-progress"
    r = verschieben(client, appt["id"])
    assert r.status_code == 409 and "schon dran" in r.json()["detail"], r.text


def test_verschieben_nimmt_offene_angebote_fuer_frueher_weg():
    client, db, store = setup()
    appt = nummer_ziehen(db)
    store["earlier_slot_notifications"] = {
        "a1": {"appointmentId": appt["id"], "isAccepted": False},
        "a2": {"appointmentId": "anderer", "isAccepted": False},
    }
    assert verschieben(client, appt["id"]).status_code == 200
    assert list(store["earlier_slot_notifications"]) == ["a2"]


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
