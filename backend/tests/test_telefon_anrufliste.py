"""
Tests für die Anrufliste des Telefon-Assistenten (app/libs/telefon_anrufliste.py, GET /telefon-einrichtung/{id}/anrufe)
mit nachgebauter Datenbank. Ohne Firebase-Zugang und ohne pytest lauffähig:

    cd backend && uv run python tests/test_telefon_anrufliste.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import FakeDb  # noqa: E402  (setzt auch den Pfad zum Backend)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.libs import privacy  # noqa: E402
from app.libs import telefon as t  # noqa: E402
from app.libs import telefon_anrufliste as tal  # noqa: E402

JETZT = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)


def vor(**zeit):
    return JETZT - timedelta(**zeit)


def anruf(shop="laden", beginn=None, anrufer=None, ergebnis=tal.ASSISTENT, sekunden=60, termine=(), grund=None, laeuft=False):
    beginn = beginn or vor(hours=1)
    return {"shopId": shop, "beginn": beginn, "ende": None if laeuft else beginn + timedelta(seconds=sekunden),
            "sekunden": 0 if laeuft else sekunden, "anrufer": anrufer, "ergebnis": ergebnis, "grund": grund, "termine": list(termine)}


def daten():
    return {
        tal.SAMMLUNG: {
            "CA1": anruf(beginn=vor(hours=2), anrufer="+491511111111", sekunden=90, termine=["t1"]),
            "CA2": anruf(beginn=vor(hours=1), anrufer="+491522222222", sekunden=40, termine=["fremd"]),
            "CA3": anruf(beginn=vor(minutes=5), laeuft=True),
            "CA4": anruf(beginn=vor(days=91), anrufer="+491511111111"),
            "CA5": anruf(shop="anders", beginn=vor(minutes=1), anrufer="+491522222222"),
            "CA6": anruf(beginn=vor(minutes=30), anrufer="+491533333333", ergebnis=tal.ANSAGE, grund=t.TEST_VERBRAUCHT, sekunden=12),
            "CA7": anruf(beginn=vor(minutes=20), anrufer="+491544444444", ergebnis=tal.BELEGT, sekunden=25),
        },
        "appointments": {
            "t1": {"shopId": "laden", "startTime": JETZT + timedelta(days=1), "status": "scheduled", "type": "booked",
                   "referenceCode": "12", "customerName": "Alex Muster", "serviceId": "schnitt", "staffId": "robin"},
            "fremd": {"shopId": "anders", "startTime": JETZT, "status": "scheduled", "customerName": "Fremd"},
        },
        "customers": {
            "k2": {"shopId": "laden", "name": "Herr Krause", "phone": "0152 2222222"},
            "k3": {"shopId": "anders", "name": "Woanders", "phone": "0153 3333333"},
        },
        "services": {"schnitt": {"shopId": "laden", "name": "Herrenschnitt"}},
        "staff": {"robin": {"shopId": "laden", "name": "Robin Berg"}},
        "shops": {"laden": {"name": "Salon", "owner": "inhaber"}},
        t.ANRUFE: {},
    }


# --- Liste ---------------------------------------------------------------------------------------------------------------


def test_neueste_zuerst_nur_dieser_laden_und_90_tage():
    liste = tal.liste(FakeDb(daten()), "laden", JETZT)
    assert [a["id"] for a in liste] == ["CA3", "CA7", "CA6", "CA2", "CA1"]


def test_name_aus_dem_termin_sonst_aus_der_kundenliste():
    liste = {a["id"]: a for a in tal.liste(FakeDb(daten()), "laden", JETZT)}
    assert liste["CA1"]["name"] == "Alex Muster"
    assert liste["CA2"]["name"] == "Herr Krause"  # Nummer in anderer Schreibweise
    assert liste["CA6"]["name"] is None  # die Nummer kennt nur ein anderer Laden
    assert liste["CA3"]["anrufer"] is None and liste["CA3"]["laeuft"] is True and liste["CA1"]["laeuft"] is False


def test_termine_mit_leistung_person_und_nummer():
    liste = {a["id"]: a for a in tal.liste(FakeDb(daten()), "laden", JETZT)}
    [termin] = liste["CA1"]["termine"]
    assert termin["leistung"] == "Herrenschnitt" and termin["person"] == "Robin Berg" and termin["nummer"] == "12"
    assert termin["status"] == "scheduled" and termin["type"] == "booked" and termin["startTime"] == JETZT + timedelta(days=1)
    assert liste["CA2"]["termine"] == []  # Termin eines anderen Ladens zeigt er nicht
    assert liste["CA6"]["ergebnis"] == tal.ANSAGE and liste["CA6"]["grund"] == t.TEST_VERBRAUCHT and liste["CA6"]["sekunden"] == 12


def test_leere_liste():
    assert tal.liste(FakeDb({tal.SAMMLUNG: {}}), "laden", JETZT) == []


# --- Eintragen -------------------------------------------------------------------------------------------------------------


def test_zweiter_versuch_aendert_nur_das_ergebnis():
    d = {tal.SAMMLUNG: {}}
    db = FakeDb(d)
    tal.merken(db, "CA9", "laden", "+491511111111", tal.BELEGT, jetzt=vor(seconds=10))
    tal.merken(db, "CA9", "laden", "+491511111111", tal.ASSISTENT, jetzt=JETZT)
    e = d[tal.SAMMLUNG]["CA9"]
    assert e["ergebnis"] == tal.ASSISTENT and e["beginn"] == vor(seconds=10) and e["termine"] == []
    tal.merken(db, None, "laden", None, tal.ASSISTENT)  # ohne CallSid nichts
    assert len(d[tal.SAMMLUNG]) == 1


def test_termin_kommt_zum_laufenden_anruf():
    d = daten()
    d[t.ANRUFE] = {"CA3": {"shopId": "laden"}}
    db = FakeDb(d)
    assert tal.termin_dazu(db, "laden", "+491599999999", "neu1") == "CA3"  # nur einer läuft: der ist es
    assert tal.termin_dazu(db, "laden", "+491599999999", "neu1") == "CA3"
    assert d[tal.SAMMLUNG]["CA3"]["termine"] == ["neu1"]


def test_bei_mehreren_laufenden_anrufen_entscheidet_die_nummer():
    d = daten()
    d[tal.SAMMLUNG]["CA8"] = anruf(beginn=vor(minutes=2), anrufer="+491511111111", laeuft=True)
    d[t.ANRUFE] = {"CA3": {"shopId": "laden"}, "CA8": {"shopId": "laden"}, "CA5": {"shopId": "anders"}}
    db = FakeDb(d)
    assert tal.termin_dazu(db, "laden", "+491511111111", "neu2") == "CA8"
    assert tal.termin_dazu(db, "laden", None, "neu3") == "CA3"  # unterdrückte Nummer
    assert tal.termin_dazu(db, "laden", "+491577777777", "neu4") is None  # passt zu keinem: lieber nirgends
    assert tal.termin_dazu(db, "dritter", None, "neu5") is None
    assert d[tal.SAMMLUNG]["CA8"]["termine"] == ["neu2"] and d[tal.SAMMLUNG]["CA3"]["termine"] == ["neu3"]


def test_ende_traegt_die_dauer_ein():
    d = daten()
    tal.ende(FakeDb(d), "CA3", 75, jetzt=JETZT)
    assert d[tal.SAMMLUNG]["CA3"]["sekunden"] == 75 and d[tal.SAMMLUNG]["CA3"]["ende"] == JETZT
    tal.ende(FakeDb(d), "unbekannt", 75)  # abgewiesener Anruf: nichts
    assert "unbekannt" not in d[tal.SAMMLUNG]


# --- Löschen -------------------------------------------------------------------------------------------------------------


def test_nach_90_tagen_geloescht():
    d = daten()
    assert tal.aufraeumen(FakeDb(d), JETZT) == 1
    assert "CA4" not in d[tal.SAMMLUNG] and len(d[tal.SAMMLUNG]) == 6


def test_kunde_geloescht_seine_anrufe_auch():
    d = daten()
    db = FakeDb(d)
    privacy.forget_customer(db, db.collection("customers").document("k2"), d["customers"]["k2"], JETZT)
    assert "CA2" not in d[tal.SAMMLUNG] and "CA5" in d[tal.SAMMLUNG]  # beim anderen Laden bleibt der Anruf
    assert "k2" not in d["customers"] and len(d[tal.SAMMLUNG]) == 6


# --- Schnittstelle ---------------------------------------------------------------------------------------------------------


def client(d, uid):
    import app.apis.telefon_einrichtung as einrichtung
    from databutton_app.mw.auth_mw import get_authorized_user

    db = FakeDb(d)
    einrichtung.get_firestore_db = lambda: db
    import app.apis.firebase_utils as fu

    fu.get_firestore_db = lambda: db
    einrichtung.tal.liste = lambda db, shop_id, jetzt=None: ORIGINAL_LISTE(db, shop_id, JETZT)
    app = FastAPI()
    app.include_router(einrichtung.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=f"{uid}@example.com", email_verified=True)
    return TestClient(app)


ORIGINAL_LISTE = tal.liste


def test_nur_der_inhaber_sieht_die_liste():
    try:
        antwort = client(daten(), "inhaber").get("/routes/telefon-einrichtung/laden/anrufe")
        assert antwort.status_code == 200 and antwort.headers["cache-control"] == "no-store"
        anrufe = antwort.json()["anrufe"]
        assert [a["id"] for a in anrufe] == ["CA3", "CA7", "CA6", "CA2", "CA1"]
        assert anrufe[4]["beginn"] == {"__zeit": "2026-11-09T10:00:00.000000Z"}, anrufe[4]["beginn"]
        assert client(daten(), "fremd").get("/routes/telefon-einrichtung/laden/anrufe").status_code == 403
        assert client(daten(), "inhaber").get("/routes/telefon-einrichtung/gibt.s.nicht/anrufe").status_code == 404
    finally:
        tal.liste = ORIGINAL_LISTE


if __name__ == "__main__":
    tests = [(name, fn) for name, fn in list(globals().items()) if name.startswith("test_") and callable(fn)]
    fehler = 0
    for name, fn in tests:
        try:
            fn()
            print(f"ok    {name}")
        except AssertionError as e:
            fehler += 1
            print(f"FEHLER {name}: {e}")
    print(f"{len(tests) - fehler} von {len(tests)} bestanden")
    sys.exit(1 if fehler else 0)
