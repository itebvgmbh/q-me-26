"""
Tests für Nummer ziehen, Termin buchen und Absagen über das Backend, mit und ohne Konto (app/apis/nummer). Der Browser
eines Kunden schreibt weder Termine noch Belegung oder Tagesnummern (firestore.rules). Nachgebaute Datenbank wie
tests/test_telefon.py: Laden jeden Tag 9 bis 18 Uhr, Robin und Kim, "jetzt" ist ein Mittwoch um 10:07 Uhr.
Ohne Firebase-Zugang und ohne pytest lauffähig:

    cd backend && uv run python tests/test_nummer_ziehen.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_platz_aendern import KEY, setup as setup_platz, termin  # noqa: E402
from test_telefon import JETZT, TAG, at, daten  # noqa: E402

import app.apis.nummer as nummer  # noqa: E402
from app.libs.links import token_hash  # noqa: E402

UID = "konto-alex"


def setup(store=None, uid=None):
    store = store if store is not None else daten()
    store.setdefault("users", {})[UID] = {"displayName": "Alex Konto", "email": "alex@example.com", "phoneNumber": "0151 1111111"}
    client, db, store = setup_platz(store, uid)
    nummer.jetzt = lambda: JETZT
    return client, db, store


def ziehen(client, staff=("robin",), start=None, **extra):
    body = {"shop_id": "laden", "service_id": "schnitt", "staff_ids": list(staff), **extra}
    if start is not None:
        body["start"] = start.isoformat()
    return client.post("/nummer/ziehen", json=body)


def iso(hhmm, day=TAG):
    """Zeit in der Antwort des Backends (UTC)"""
    return at(hhmm, day).isoformat()


def ohne_konto(**extra):
    return {"key_hash": token_hash(KEY), "name": " Sam  ", "phone": " 0170 2222222 ", **extra}


# --- Nummer ziehen ------------------------------------------------------------------------------------------------------

def test_ohne_konto_fruehester_platz_mit_schluessel_tagesnummer_und_belegung():
    client, _, store = setup()
    r = ziehen(client, start=at("10:15"), **ohne_konto(language="ar", check_earlier=True))
    assert r.status_code == 200, r.text
    body = r.json()
    appt = store["appointments"][body["appointment_id"]]
    assert appt["type"] == "queue" and appt["isAnonymous"] is True and "customerId" not in appt
    assert appt["ticketKeyHash"] == token_hash(KEY) and appt["customerName"] == "Sam" and appt["customerPhone"] == "0170 2222222"
    assert appt["startTime"] == at("10:15") and appt["staffId"] == "robin" and appt["language"] == "ar"
    assert appt["checkEarlierOptions"] is False, "„Früher dran“ nur mit Konto – ohne fehlt der Weg zum Annehmen"
    assert appt["teamNotice"] == "new", "Team bekommt Bescheid (app/libs/team_notify.py)"
    code = appt["referenceCode"]
    assert code and body["reference_code"] == code and store["shop_days"][f"laden_{TAG}"]["codes"] == [code]
    assert body["appointment_id"] in store["schedules"][f"robin_{TAG}"]["slots"]
    assert body["start"] == iso("10:15") and body["staff_id"] == "robin"
    kurz = store["public_appointments"][body["appointment_id"]]
    assert kurz["referenceCode"] == code and "customerName" not in kurz and "ticketKeyHash" not in kurz


def test_ohne_konto_ohne_schluessel_abgelehnt():
    client, _, store = setup()
    assert ziehen(client, name="Sam").status_code == 400
    assert not store["appointments"]


def test_mit_konto_name_und_handy_aus_dem_profil_frueher_dran():
    client, _, store = setup(uid=UID)
    r = ziehen(client, check_earlier=True, name="Wird ignoriert")
    assert r.status_code == 200, r.text
    appt = store["appointments"][r.json()["appointment_id"]]
    assert appt["customerId"] == UID and appt["isAnonymous"] is False and "ticketKeyHash" not in appt
    assert appt["customerName"] == "Alex Konto" and appt["customerPhone"] == "0151 1111111"
    assert appt["checkEarlierOptions"] is True and appt["checkEarlierOptionsCreatedAt"]
    assert appt["referenceCode"], "Jede Nummer hat eine Tagesnummer"


def test_egal_wer_nimmt_die_schnellste_person():
    client, _, store = setup()
    assert ziehen(client, staff=("robin",), **ohne_konto()).json()["start"] == iso("10:15")
    r = ziehen(client, staff=("robin", "kim"), **ohne_konto()).json()
    assert r["staff_id"] == "kim" and r["start"] == iso("10:15"), r


def test_ansturm_jeder_platz_und_jede_nummer_nur_einmal():
    client, _, store = setup()
    starts, codes = [], []
    for _ in range(5):
        r = ziehen(client, **ohne_konto())
        assert r.status_code == 200, r.text
        starts.append(r.json()["start"])
        codes.append(r.json()["reference_code"])
    assert starts == [iso(h) for h in ("10:15", "10:45", "11:15", "11:45", "12:15")], starts
    assert len(set(codes)) == 5 and store["shop_days"][f"laden_{TAG}"]["codes"] == codes


def test_belegung_schuetzt_auch_wenn_die_berechnung_es_noch_nicht_weiss():
    # Der Tresen hat 10:15 gerade gebucht: steht in der Belegung, die Berechnung sieht es noch nicht
    client, _, store = setup()
    store["schedules"] = {f"robin_{TAG}": {"slots": {"T": {"start": at("10:15"), "end": at("10:45")}}}}
    store["appointments"]["T"] = {"shopId": "anderer", "staffId": "robin", "status": "scheduled", "startTime": at("10:15"), "endTime": at("10:45")}
    r = ziehen(client, **ohne_konto())
    assert r.status_code == 200 and r.json()["start"] == iso("10:45"), r.text


def test_angezeigter_spaeterer_tag():
    client, _, _ = setup()
    morgen = TAG + timedelta(days=1)
    r = ziehen(client, start=at("13:00", morgen), **ohne_konto())
    assert r.status_code == 200 and r.json()["start"] == iso("09:00", morgen), r.text


def test_tag_voll():
    store = daten()
    store["staff"]["robin"]["workingHours"] = [{"dayOfWeek": d, "isWorking": True, "startTime": "09:00", "endTime": "10:45"} for d in range(7)]
    client, _, _ = setup(store)
    assert ziehen(client, **ohne_konto()).status_code == 200  # 10:15–10:45 ist der letzte Platz
    r = ziehen(client, **ohne_konto())
    assert r.status_code == 409 and r.json()["detail"] == nummer.DAY_FULL, r.text


def test_gesperrt_fremde_person_und_monatsgrenze():
    store = daten()
    store["shops"]["laden"]["suspended"] = {"at": datetime.now(timezone.utc)}
    client, _, _ = setup(store)
    assert ziehen(client, **ohne_konto()).status_code == 403

    client, _, store = setup()
    assert ziehen(client, staff=("weg",), **ohne_konto()).status_code == 409, "Ehemalige nicht"
    assert ziehen(client, staff=("unbekannt",), **ohne_konto()).status_code == 409

    store = daten()
    store["shops"]["laden"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)  # Gratis: 100 im Monat
    for i in range(100):
        store["appointments"][f"a{i}"] = {"shopId": "laden", "status": "scheduled", "startTime": at("09:00", TAG.replace(day=1))}
    client, _, _ = setup(store)
    r = ziehen(client, **ohne_konto())
    assert r.status_code == 409 and r.json()["detail"] == nummer.MONTH_FULL, r.text


def test_gratis_ohne_termine_zieht_trotzdem_nummern():
    store = daten()
    store["shops"]["laden"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)
    client, _, _ = setup(store)
    assert ziehen(client, **ohne_konto()).status_code == 200
    assert termin(client).status_code == 403, "feste Termine nur mit Online-Terminen im Tarif"


# --- Termin buchen mit Konto ------------------------------------------------------------------------------------------

def test_termin_mit_konto_ohne_tagesnummer_mit_frueher_dran():
    client, _, store = setup(uid=UID)
    r = client.post("/nummer/termin", json={"shop_id": "laden", "service_id": "schnitt", "staff_ids": ["robin"],
                                            "start": at("14:00").isoformat(), "check_earlier": True})
    assert r.status_code == 200, r.text
    appt = store["appointments"][r.json()["appointment_id"]]
    assert appt["customerId"] == UID and appt["isAnonymous"] is False and appt["type"] == "booked"
    assert appt["customerName"] == "Alex Konto" and "referenceCode" not in appt and "ticketKeyHash" not in appt
    assert appt["checkEarlierOptions"] is True and appt["teamNotice"] == "new"
    assert r.json()["appointment_id"] in store["schedules"][f"robin_{TAG}"]["slots"]


def test_termin_ohne_konto_braucht_namen_und_schluessel():
    client, _, store = setup()
    base = {"shop_id": "laden", "service_id": "schnitt", "staff_ids": ["robin"], "start": at("14:00").isoformat()}
    assert client.post("/nummer/termin", json={**base, "key_hash": token_hash(KEY)}).status_code == 422
    assert client.post("/nummer/termin", json={**base, "name": "Sam"}).status_code == 400
    assert not store["appointments"]


# --- Absagen ----------------------------------------------------------------------------------------------------------

def test_absagen_mit_konto_nur_den_eigenen():
    client, _, store = setup(uid=UID)
    appt_id = ziehen(client).json()["appointment_id"]
    fremd, _, _ = setup(store, uid="jemand-anders")
    assert fremd.post("/nummer/absagen", json={"appointment_id": appt_id}).status_code == 403
    client, _, _ = setup(store, uid=UID)
    r = client.post("/nummer/absagen", json={"appointment_id": appt_id})
    assert r.status_code == 200, r.text
    appt = store["appointments"][appt_id]
    # Die Meldung „neu“ war noch nicht raus – dann gibt es auch nichts abzusagen (app/libs/team_notify.py)
    assert appt["status"] == "cancelled" and appt["teamCancelledAt"] and appt["teamNotice"] is None
    assert appt_id not in store["schedules"][f"robin_{TAG}"]["slots"], "Platz wieder frei"
    assert store["public_appointments"][appt_id]["status"] == "cancelled"


def test_absagen_ohne_konto_mit_schluessel():
    client, _, store = setup()
    appt_id = ziehen(client, **ohne_konto()).json()["appointment_id"]
    assert client.post("/nummer/absagen", json={"appointment_id": appt_id}).status_code == 403
    assert client.post("/nummer/absagen", json={"appointment_id": appt_id, "key": "x" * 32}).status_code == 403
    assert client.post("/nummer/absagen", json={"appointment_id": appt_id, "key": KEY}).status_code == 200
    assert store["appointments"][appt_id]["status"] == "cancelled"


def test_uebernommene_nummer_nur_noch_mit_konto():
    client, _, store = setup()
    appt_id = ziehen(client, **ohne_konto()).json()["appointment_id"]
    store["appointments"][appt_id]["customerId"] = UID  # ins Konto übernommen
    assert client.post("/nummer/absagen", json={"appointment_id": appt_id, "key": KEY}).status_code == 403
    client, _, _ = setup(store, uid=UID)
    assert client.post("/nummer/absagen", json={"appointment_id": appt_id}).status_code == 200


if __name__ == "__main__":
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith("test_") and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"OK   {name}")
        except Exception as e:
            failed += 1
            print(f"FEHL {name}: {type(e).__name__}: {e}")
    print(f"{len(tests) - failed}/{len(tests)} bestanden")
    sys.exit(1 if failed else 0)
