"""
Tests für Läden finden (app/apis/suche) mit nachgebauter Datenbank. Ohne Firebase und ohne pytest lauffähig:

    cd backend && .venv/bin/python tests/test_suche.py

Wie in test_telefon.py: „jetzt“ ist ein Mittwoch in einer Woche um 10:07 Uhr, der Laden hat jeden Tag 9 bis 18 Uhr offen.
"""
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_telefon import JETZT, TAG, Db, at, daten  # noqa: E402  (setzt auch den Pfad zum Backend)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.suche as suche  # noqa: E402
from app import seo  # noqa: E402
from app import store as speicher  # noqa: E402
from app.libs import schedule  # noqa: E402
from app.libs import verzeichnis as vz  # noqa: E402

BERLIN = schedule.BERLIN


def setup(store=None, verzeichnis=None):
    store = store if store is not None else daten()
    store["shops"]["laden"]["coordinates"] = {"latitude": 52.53, "longitude": 13.38}
    store["shops"]["zu"] = {"name": "Gesperrt", "suspended": {"at": "x"}}
    store["shops"]["weg"] = {"name": "Ausgeblendet", "unlisted": True}
    db = Db(store)
    speicher.db = lambda: db
    import app.apis.firebase_utils as fu

    fu.get_firestore_db = lambda: db
    seo._cache.clear()
    seo.waiting_now = lambda shop_id, now=None: {"laden": 2}.get(shop_id, 0)
    suche._verzeichnis = lambda: verzeichnis or {"seiten": [
        {"typ": "laden", "shopId": "laden", "ortsteil": "Mitte", "bezirk": "Mitte", "pfad": "/friseur/berlin/salon-schnitt",
         "coordinates": {"latitude": 1, "longitude": 1}},
        {"typ": "eintrag", "id": "e1", "name": "Salon Nord", "kategorie": "friseur", "street": "Nordstr. 1", "postalCode": "13353",
         "city": "Berlin", "ortsteil": "Wedding", "bezirk": "Mitte", "pfad": "/friseur/berlin/salon-nord",
         "coordinates": {"latitude": 52.55, "longitude": 13.36}, "services": [{"name": "Damenschnitt", "price": 30}]},
        {"typ": "eintrag", "id": "e2", "name": "Ohne Lage", "pfad": "/friseur/berlin/ohne", "coordinates": None},
    ]}
    app = FastAPI()
    app.include_router(suche.router, prefix="/routes")
    return TestClient(app), db, store


def test_woerter_vergleichen_ohne_umlaute_und_grossschreibung():
    assert suche.norm("Färben & Strähnen") == "faerben straehnen"
    assert suche.passt("Herrenhaarschnitt", "schnitt") and suche.passt("Haare & Bart", "bart haare")
    assert not suche.passt("Herrenschnitt", "bart") and not suche.passt("Herrenschnitt", "")


def test_laeden_mit_lage_ortsteil_und_leistungen():
    client, _, _ = setup()
    r = client.get("/routes/suche/laeden")
    assert r.status_code == 200 and "max-age=60" in r.headers["cache-control"]
    d = r.json()
    assert [l["id"] for l in d["laeden"]] == ["laden"], "gesperrte und ausgeblendete Läden fehlen"
    l = d["laeden"][0]
    assert (l["lat"], l["lng"]) == (52.53, 13.38), "eigene Lage des Ladens geht vor der aus dem Verzeichnis"
    assert l["ortsteil"] == "Mitte" and l["pfad"] == "/friseur/berlin/salon-schnitt" and l["termine"] is True
    assert [s["name"] for s in l["leistungen"]] == ["Bart", "Herrenschnitt"], "archivierte Leistung fehlt"
    assert "owner" not in l and "trialEndsAt" not in l
    assert [s["name"] for s in d["salons"]] == ["Salon Nord"] and d["salons"][0]["leistungen"] == ["Damenschnitt"]


def test_standard_leistung():
    leistungen = [{"id": "b", "name": "Bart", "duration": 15}, {"id": "a", "name": "Augenbrauen", "duration": 10},
                  {"id": "h", "name": "Herrenhaarschnitt", "duration": 30}]
    assert suche.standard_leistung(leistungen)["id"] == "h"
    assert suche.standard_leistung(leistungen, "bart")["id"] == "b"
    assert suche.standard_leistung(leistungen, "dauerwelle")["id"] == "h", "nichts passt: die übliche"
    assert suche.standard_leistung([]) is None
    # Wie bei Testbarb (11.11.): nicht der kürzeste Schnitt, sondern der Herrenschnitt; Kinder zuletzt
    testbarb = [{"id": "k", "name": "Kinderhaarschnitt", "duration": 20}, {"id": "hb", "name": "Haarschnitt und Bart", "duration": 45},
                {"id": "h", "name": "Herrenhaarschnitt", "duration": 30}, {"id": "w", "name": "Waschen, Schneiden, Föhnen", "duration": 45}]
    assert suche.standard_leistung(testbarb)["id"] == "h"
    assert suche.standard_leistung([x for x in testbarb if x["id"] != "h"])["id"] == "hb"


def test_freie_zeiten_nummer_und_termine():
    setup()
    laden = suche.laeden_daten()["laeden"][0]
    jetzt = JETZT.replace(tzinfo=BERLIN)
    f = suche.frei_fuer("laden", laden, "", now=jetzt)
    assert f["warten"] == 2 and f["leistung"]["name"] == "Herrenschnitt"
    nummer = schedule.aware(__import__("datetime").datetime.fromisoformat(f["nummer"]))
    assert jetzt <= nummer < jetzt + timedelta(hours=1), f["nummer"]
    starts = [__import__("datetime").datetime.fromisoformat(t["start"]) for t in f["termine"]]
    assert len(starts) == 3 and starts == sorted(starts) and len(set(starts)) == 3, f["termine"]
    assert all(s > jetzt for s in starts) and {t["personId"] for t in f["termine"]} <= {"robin", "kim"}
    # Gesuchte Leistung: Bart bietet nur Kim an
    bart = suche.frei_fuer("laden", laden, "bart", now=jetzt)
    assert bart["leistung"]["name"] == "Bart" and {t["personId"] for t in bart["termine"]} == {"kim"}


def test_ohne_termine_im_tarif_nur_die_nummer():
    store = daten()
    store["shops"]["laden"]["trialEndsAt"] = __import__("datetime").datetime(2020, 1, 1, tzinfo=BERLIN)  # Gratis: keine Termine
    setup(store)
    laden = suche.laeden_daten()["laeden"][0]
    assert laden["termine"] is False
    f = suche.frei_fuer("laden", laden, "", now=JETZT.replace(tzinfo=BERLIN))
    assert f["nummer"] and f["termine"] == []


def test_frei_nur_fuer_bekannte_laeden_und_zwischengespeichert():
    client, _, _ = setup()
    gerechnet = []
    echt = suche.frei_fuer
    suche.frei_fuer = lambda i, l, s, now=None: gerechnet.append((i, s)) or {"warten": 0, "leistung": None, "nummer": None, "termine": []}
    try:
        r = client.get("/routes/suche/frei", params={"ids": "laden,zu,../x,erfunden,laden", "leistung": "Bärte!"})
        assert r.status_code == 200 and list(r.json()["frei"]) == ["laden"]
        client.get("/routes/suche/frei", params={"ids": "laden", "leistung": "baerte"})
        assert gerechnet == [("laden", "baerte")], gerechnet
    finally:
        suche.frei_fuer = echt


def test_ortssuche_postleitzahl_und_fehler():
    client, _, _ = setup()
    gefragt = []

    def osm(params, get=None):
        gefragt.append(params)
        if params.get("postalcode") == "13507":
            return [{"lat": "52.5871", "lon": "13.2849", "address": {"postcode": "13507", "suburb": "Tegel", "city": "Berlin"}}]
        if params.get("q") == "nirgendwo":
            return []
        return None

    vz.osm_suche = osm
    suche._orte.clear()
    r = client.get("/routes/suche/ort", params={"q": " 13507 "})
    assert r.status_code == 200 and r.json() == {"name": "13507 Tegel", "lat": 52.5871, "lng": 13.2849}
    client.get("/routes/suche/ort", params={"q": "13507"})
    assert len(gefragt) == 1, "zweites Mal aus dem Gedächtnis"
    assert client.get("/routes/suche/ort", params={"q": "nirgendwo"}).status_code == 404
    assert client.get("/routes/suche/ort", params={"q": "Hamburg"}).status_code == 503
    assert client.get("/routes/suche/ort", params={"q": "x"}).status_code == 400


def test_ort_aus_adresse():
    o = suche.ort_aus_osm([{"lat": "52.5", "lon": "13.4", "address": {"road": "Hauptstr.", "house_number": "5", "postcode": "10827",
                                                                    "suburb": "Schöneberg", "city": "Berlin"}}])
    assert o == {"name": "Hauptstr. 5, 10827 Schöneberg", "lat": 52.5, "lng": 13.4}
    assert suche.ort_aus_osm([]) is None and suche.ort_aus_osm([{"lat": "x"}]) is None


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
