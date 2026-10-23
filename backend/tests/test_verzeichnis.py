"""
Tests für das Salon-Verzeichnis: app/libs/verzeichnis.py, app/libs/verzeichnis_import.py, app/verzeichnis_seiten.py,
app/apis/verzeichnis (öffentlich) und app/apis/betreiber/verzeichnis.py. Ohne Firebase, Google und Claude lauffähig:

    cd backend && .venv/bin/python tests/test_verzeichnis.py
"""
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["QME_BETREIBER_DIR"] = tempfile.mkdtemp(prefix="verzeichnis-test-")

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.seo as seo  # noqa: E402
import app.verzeichnis_seiten as seiten  # noqa: E402
from app.apis import verzeichnis as public_api  # noqa: E402
from app.apis.betreiber import verzeichnis as admin_api  # noqa: E402
from app.libs import protokoll  # noqa: E402
from app.libs import verzeichnis as vz  # noqa: E402
from app.libs import verzeichnis_import as imp  # noqa: E402

MONDAY = datetime(2026, 10, 19, 10, 0, tzinfo=timezone.utc)
USER = SimpleNamespace(email="chef@dranzeit.de", sub="chef")
HOURS = vz.stunden_aus_zeiten([{"tag": "mo", "zeiten": [{"von": "9", "bis": "12"}, {"von": "13:00", "bis": "18.30"}]},
                               {"tag": "sa", "zeiten": [{"von": "10:00", "bis": "14:00"}]}])

OSM_PRENZLAUER_BERG = [{
    "lat": "52.5492430", "lon": "13.4155955",
    "address": {"house_number": "80", "road": "Schönhauser Allee", "quarter": "Gleimviertel", "suburb": "Prenzlauer Berg",
                "borough": "Pankow", "city": "Berlin", "postcode": "10439"},
}]


def geo_fake(street, plz, city):
    return {"coordinates": {"latitude": 52.5492, "longitude": 13.4156}, "ortsteil": "Prenzlauer Berg", "bezirk": "Pankow", "osmCity": "Berlin"}


def eintrag(id_, name, **extra):
    base = {
        "id": id_, "name": name, "kategorie": "friseur", "street": "Schönhauser Allee 80", "postalCode": "10439",
        "city": "Berlin", "stadtSlug": "berlin", "slug": vz.slugify(name), "ortsteil": "Prenzlauer Berg", "bezirk": "Pankow",
        "coordinates": {"latitude": 52.5492, "longitude": 13.4156}, "phone": "030 123 45", "website": "https://salon.example/",
        "businessHoursByDay": HOURS, "services": [{"name": "Herrenschnitt", "category": "Herren", "price": 25, "priceFrom": True}],
        "beschreibung": "Der Salon schneidet Damen, Herren und Kinder.", "schwerpunkte": ["Herren", "Balayage"],
        "status": "online", "wuensche": 0, "quelle": {"website": "https://salon.example/", "seiten": [], "gelesenAm": MONDAY},
        "veroeffentlichtAm": MONDAY,
    }
    base.update(extra)
    return base


def frisch(entries=(), shops=()):
    """Speicher und Läden für einen Test; Zwischenspeicher leeren"""
    store = vz.MemoryStore(entries)
    vz.set_store(store)
    seo._cache.clear()
    seo.load_shops = lambda: list(shops)
    seo.waiting_now = lambda shop_id, now=None: 2
    seiten.laden_leistungen = lambda shop_id: [{"name": "Schnitt", "category": "", "price": 20, "priceFrom": False, "duration": 30}]
    vz.lage = geo_fake
    return store


# --- Bausteine -------------------------------------------------------------------------------------------------------


def test_slugs():
    assert vz.slugify("Salon Élan & Co.") == "salon-elan-co"
    assert vz.slugify("Köln") == "koeln" and vz.slugify("Halit's Barber Shop") == "halits-barber-shop"
    assert vz.eindeutiger_slug("Salon Schnitt", set()) == "salon-schnitt"
    assert vz.eindeutiger_slug("Salon Schnitt", {"salon-schnitt"}, "Prenzlauer Berg") == "salon-schnitt-prenzlauer-berg"
    assert vz.eindeutiger_slug("Salon Schnitt", {"salon-schnitt", "salon-schnitt-prenzlauer-berg"}, "Prenzlauer Berg") == "salon-schnitt-2"
    assert len(vz.slugify("a" * 40 + " " + "b" * 40, 60)) <= 60
    assert vz.pfad({"kategorie": "barbershop", "stadtSlug": "berlin", "slug": "ali"}) == "/barbershop/berlin/ali"
    assert vz.ortsname({"city": "Berlin", "ortsteil": "Wedding"}) == "Berlin-Wedding"


def test_kategorie():
    assert vz.kategorie_aus_google("barber_shop", [], "Ali") == "barbershop"
    assert vz.kategorie_aus_google("hair_salon", ["hair_care"], "Haarwerk") == "friseur"
    assert vz.kategorie_aus_google("hair_care", [], "Kings Barber") == "barbershop"
    assert vz.kategorie_aus_google("nail_salon", ["beauty_salon"], "Nails") is None


def test_oeffnungszeiten():
    assert vz.uhrzeit("9") == "09:00" and vz.uhrzeit("18.30") == "18:30" and vz.uhrzeit("24:00") == "23:59"
    assert vz.uhrzeit("25:00") == "" and vz.uhrzeit("abends") == ""
    mo = next(d for d in HOURS if d["dayOfWeek"] == 1)
    assert mo == {"dayOfWeek": 1, "isOpen": True, "openTime": "09:00", "closeTime": "18:30",
                  "breaks": [{"startTime": "12:00", "endTime": "13:00"}]}
    assert not next(d for d in HOURS if d["dayOfWeek"] == 0)["isOpen"]
    assert vz.stunden_aus_zeiten([]) == []


def test_osm():
    geo = vz.lage_aus_osm(OSM_PRENZLAUER_BERG)
    assert geo["ortsteil"] == "Prenzlauer Berg" and geo["bezirk"] == "Pankow" and geo["osmCity"] == "Berlin"
    assert geo["coordinates"] == {"latitude": 52.549243, "longitude": 13.415596}
    assert vz.lage_aus_osm([]) is None
    calls = []

    def get(url, params, headers, timeout):
        calls.append(params)
        return SimpleNamespace(status_code=200, json=lambda: OSM_PRENZLAUER_BERG)

    assert vz.lage("Teststraße 1", "10439", "Berlin", get=get)["bezirk"] == "Pankow"
    assert vz.lage("Teststraße 1", "10439", "Berlin", get=get)["bezirk"] == "Pankow"  # gemerkt
    assert len(calls) == 1 and calls[0]["postalcode"] == "10439" and calls[0]["countrycodes"] == "de"


def test_uebernahme_abgleich():
    listing = eintrag("e1", "Haarwerk Müller", googlePlaceId="ChIJ_haarwerk_1")
    other = eintrag("e2", "Salon Nord", postalCode="13409")
    shops = [
        {"id": "s1", "name": "Haarwerk", "googlePlaceId": "ChIJ_haarwerk_1", "city": "Berlin"},
        {"id": "s2", "name": "Salon Nord GmbH", "postalCode": "13409", "city": "Berlin"},
        {"id": "s3", "name": "Ganz Neu", "city": "Berlin"},
        {"id": "s4", "name": "Testladen (wird gleich gelöscht)", "city": "Berlin"},
    ]
    plan = vz.abgleich([listing, other], shops)
    assert plan["vorschlaege"]["e1"]["shopId"] == "s1" and plan["vorschlaege"]["e1"]["grund"] == "gleicher Google-Eintrag"
    assert plan["vorschlaege"]["e2"] == {"shopId": "s2", "name": "Salon Nord GmbH", "grund": "ähnlicher Name, gleiche PLZ"}
    assert [s["id"] for s in plan["neu"]] == ["s3"]
    # abgelehnt → eigene Seite; schon verknüpft → nichts
    plan = vz.abgleich([{**listing, "abgelehnt": ["s1"]}, {**other, "shopId": "s2"}], shops[:3])
    assert [s["id"] for s in plan["neu"]] == ["s1", "s3"] and not plan["vorschlaege"]
    assert not vz.namen_aehnlich("Friseur Berlin", "Barbershop Berlin")


def test_abgleich_ausfuehren_legt_seiten_an():
    store = frisch([eintrag("e1", "Haarwerk", googlePlaceId="P1", vorschlag={"shopId": "alt", "name": "x", "grund": "y"})])
    shops = [{"id": "s3", "name": "Kings Barber", "city": "Berlin", "street": "Weg 1", "postalCode": "10115"}]
    entries = vz.abgleich_ausfuehren(store.alle(), shops, store, geo_fake)
    neu = store.hole("laden-s3")
    assert neu["shopId"] == "s3" and neu["kategorie"] == "barbershop" and neu["status"] == "online"
    assert neu["slug"] == "kings-barber" and neu["ortsteil"] == "Prenzlauer Berg" and vz.pfad(neu) == "/barbershop/berlin/kings-barber"
    assert store.hole("e1")["vorschlag"] is None  # veralteter Vorschlag weg
    assert len(entries) == 2
    vz.abgleich_ausfuehren(store.alle(), shops, store, geo_fake)
    assert len(store.alle()) == 2  # kein zweites Mal


# --- Import ----------------------------------------------------------------------------------------------------------


ANTWORT = {
    "passt": True, "name": "Haarwerk", "kategorie": "friseur", "strasse": "Schönhauser Allee 80", "plz": "10439",
    "ort": "Berlin", "telefon": "030 1234567",
    "oeffnungszeiten": [{"tag": "di", "zeiten": [{"von": "09:00", "bis": "18:00"}]}],
    "ohne_termin": "ja", "schwerpunkte": ["Damen", "damen", "Herren"],
    "beschreibung": "Der Salon   schneidet Damen und Herren.",
    "leistungen": [{"name": "Herrenschnitt", "kategorie": "Herren", "preis_eur": 25, "preis_ab": False},
                   {"name": "herrenschnitt", "kategorie": "", "preis_eur": 30, "preis_ab": False},
                   {"name": "Farbe", "kategorie": "", "preis_eur": -5, "preis_ab": True}],
}


class FakeClient:
    def __init__(self, answer):
        self.answer = answer
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps(self.answer))])


def test_profil_aus_antwort():
    p = imp.profil_aus_antwort(ANTWORT)
    assert p["passt"] and p["postalCode"] == "10439" and p["ohneTermin"] == "ja"
    assert p["schwerpunkte"] == ["Damen", "Herren"] and p["beschreibung"] == "Der Salon schneidet Damen und Herren."
    assert [s["name"] for s in p["services"]] == ["Herrenschnitt", "Farbe"] and p["services"][1]["price"] == 0.0
    assert next(d for d in p["businessHoursByDay"] if d["dayOfWeek"] == 2)["openTime"] == "09:00"
    assert imp.profil_aus_antwort({**ANTWORT, "plz": "1043"})["postalCode"] == ""


def test_profil_von_webseite():
    os.environ["ANTHROPIC_API_KEY"] = "test"
    lesen = lambda url: (["https://haarwerk.example/", "https://haarwerk.example/impressum"], "Impressum Haarwerk " * 20)  # noqa: E731
    client = FakeClient(ANTWORT)
    p = imp.profil_von_webseite("https://haarwerk.example/", "Haarwerk", "Schönhauser Allee 80", client=client, lesen=lesen)
    assert p["website"] == "https://haarwerk.example/" and len(p["quelle"]["seiten"]) == 2 and "passt" not in p
    kw = client.calls[0]
    assert kw["output_config"]["format"]["type"] == "json_schema" and kw["fallbacks"] == "default"
    assert "Haarwerk, Schönhauser Allee 80" in kw["messages"][0]["content"]
    for answer, status in (({**ANTWORT, "passt": False}, 422), ({**ANTWORT, "kategorie": "andere"}, 422)):
        try:
            imp.profil_von_webseite("https://haarwerk.example/", client=FakeClient(answer), lesen=lesen)
            raise AssertionError("hätte abgelehnt werden müssen")
        except HTTPException as e:
            assert e.status_code == status
    for url in ("https://www.instagram.com/haarwerk", "https://www.treatwell.de/ort/haarwerk/", ""):
        try:
            imp.profil_von_webseite(url, client=client, lesen=lesen)
            raise AssertionError(url)
        except HTTPException as e:
            assert e.status_code == 400
    assert imp.fremde_seite("booksy.com/de-de/123") and not imp.fremde_seite("https://haarwerk-berlin.de")
    assert imp.fremde_seite("https://redbeard2.mytreatwell.de/") and imp.fremde_seite("https://barber.de.ivof.com/city/")
    assert imp.fremde_seite("https://iboexecutivebarber.setmore.com/") and not imp.fremde_seite("https://salon-venezia.de")


def test_google_treffer():
    t = imp.treffer_aus_google({"id": "P1", "displayName": {"text": "Kings Barber"}, "formattedAddress": "Weg 1, 10115 Berlin",
                                "websiteUri": "https://www.instagram.com/kings", "primaryType": "barber_shop",
                                "businessStatus": "OPERATIONAL"})
    assert t == {"placeId": "P1", "name": "Kings Barber", "address": "Weg 1, 10115 Berlin", "postalCode": "10115", "website": "",
                 "websiteFremd": "https://www.instagram.com/kings", "kategorie": "barbershop", "geschlossen": False}
    entries = [eintrag("e1", "Kings Barber", postalCode="10115")]
    assert imp.bekannt(t, entries, [])["eintragId"] == "e1"
    assert imp.bekannt(t, [], [{"id": "s1", "name": "x", "googlePlaceId": "P1"}])["shopId"] == "s1"
    os.environ["GOOGLE_MAPS_API_KEY"] = "test"
    sent = {}

    def post(url, json, timeout, headers):
        sent.update(json=json, headers=headers)
        return SimpleNamespace(status_code=200, json=lambda: {"places": [{"id": "P2", "displayName": {"text": "A"}}], "nextPageToken": "n"})

    r = imp.google_suche("Friseur Wedding", "tok", post=post)
    assert r["nextPageToken"] == "n" and r["treffer"][0]["placeId"] == "P2"
    assert sent["json"]["pageToken"] == "tok" and "places.websiteUri" in sent["headers"]["X-Goog-FieldMask"]


# --- Seiten ----------------------------------------------------------------------------------------------------------


def ld_blocks(page):
    return [json.loads(m.replace("<\\/", "</")) for m in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page)]


def test_seite_eines_salons_ohne_dranzeit():
    d = seiten.daten_bauen([eintrag("e1", "Haarwerk <Müller>"), eintrag("e2", "Salon Nord"),
                             eintrag("laden-s9", "Kings", shopId="s9", slug="kings")], [{"id": "s9", "name": "Kings", "city": "Berlin",
                                                                                    "coordinates": {"latitude": 52.5493, "longitude": 13.4157}}])
    s = d["nach_pfad"]["/friseur/berlin/haarwerk-mueller"]
    page = seiten.render_salon(s, d, now=MONDAY)
    assert "<h1>Haarwerk &lt;Müller&gt;</h1>" in page and "<Müller>" not in page.split("application/ld+json")[0]
    assert "Friseur in Berlin-Prenzlauer Berg · Heute 09:00–18:30 Uhr" in page
    assert "noch keine Nummer ziehen" in page and "/routes/verzeichnis/e1/wunsch" in page and "/routes/verzeichnis/e1/entfernen" in page
    assert "public-join-queue" not in page  # keine Buchung – auch nicht bei Dranzeit-Läden in der Nähe (neutral)
    assert "ab 25 €" in page and "Stand Oktober 2026" in page and "tel:03012345" in page
    assert "09:00–12:00, 13:00–18:30" in page and "Salon Nord" in page  # in der Nähe
    assert 'name="robots"' not in page and 'rel="canonical" href="https://dranzeit.de/friseur/berlin/haarwerk-mueller"' in page
    salon, krumen = ld_blocks(page)
    assert salon["@type"] == "HairSalon" and salon["geo"]["latitude"] == 52.5492
    assert [x["opens"] for x in salon["openingHoursSpecification"] if x["dayOfWeek"].endswith("Monday")] == ["09:00", "13:00"]
    assert [x["name"] for x in krumen["itemListElement"]] == ["Friseure", "Berlin", "Pankow", "Prenzlauer Berg", "Haarwerk <Müller>"]
    duenn = seiten.daten_bauen([eintrag("e3", "Dünn", businessHoursByDay=[], services=[], beschreibung="")], [])
    assert 'content="noindex,follow"' in seiten.render_salon(duenn["seiten"][0], duenn)
    assert "Danke!" in seiten.render_salon(s, d, gewuenscht=True)


def test_seite_eines_dranzeit_ladens():
    shop = {"id": "s1", "name": "Kings Barber", "street": "Weg 1", "postalCode": "10115", "city": "Berlin",
            "businessHoursByDay": HOURS, "phone": "030 9"}
    d = seiten.daten_bauen([eintrag("laden-s1", "Kings Barber", shopId="s1", kategorie="barbershop", slug="kings-barber",
                                    services=[], beschreibung="")], [shop])
    s = d["seiten"][0]
    assert s["typ"] == "laden" and s["street"] == "Weg 1"
    page = seiten.render_salon(s, d, now=MONDAY, waiting=2,
                               leistungen=[{"name": "Schnitt", "category": "", "price": 20, "priceFrom": False, "duration": 30}])
    assert "/public-join-queue?shopId=s1" in page and "/book-appointment?shopId=s1" in page and "2 Personen warten gerade." in page
    assert "30 Min" in page and "wunsch" not in page and "entfernen" not in page
    # gesperrt oder gelöscht: keine Seite
    assert not seiten.daten_bauen([eintrag("laden-s1", "Kings Barber", shopId="s1")], [])["seiten"]


def test_orte():
    d = seiten.daten_bauen([
        eintrag("e1", "A"), eintrag("e2", "B", ortsteil="Wedding", bezirk="Mitte"),
        eintrag("e3", "C", ortsteil="Mitte", bezirk="Mitte", kategorie="barbershop"),
    ], [])
    o = d["orte"]
    assert {"berlin", "berlin-pankow", "berlin-prenzlauer-berg", "berlin-wedding", "berlin-mitte"} == set(o)
    assert o["berlin-mitte"]["typ"] == "bezirk" and len(o["berlin-mitte"]["seiten"]) == 2
    page = seiten.render_ort("friseur", "berlin-mitte", o["berlin-mitte"], d)
    assert "<h1>Friseure in Mitte</h1>" in page and "2 Friseure und Barbershops in Berlin-Mitte" in page
    assert "/friseur/berlin-pankow" in page  # andere Teile der Stadt
    page = seiten.render_ort("barbershop", "berlin-pankow", o["berlin-pankow"], d)
    assert 'content="noindex,follow"' in page  # ein Salon reicht nicht für eine eigene Ortsseite bei Google


def test_routen_und_sitemap():
    frisch([
        eintrag("e1", "Haarwerk", altePfade=["/friseur/berlin/haarwerk-alt"]),
        eintrag("e2", "Salon Nord"),
        eintrag("e4", "Entwurf", status="entwurf"),
        eintrag("laden-s1", "Kings Barber", shopId="s1", kategorie="barbershop", slug="kings-barber"),
    ], [{"id": "s1", "name": "Kings Barber", "street": "Weg 1", "postalCode": "10115", "city": "Berlin"}])
    app = FastAPI()
    app.include_router(seiten.router)
    app.include_router(seo.router)
    c = TestClient(app)
    assert c.get("/friseur/berlin/haarwerk").status_code == 200
    r = c.get("/barbershop/berlin/haarwerk", follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == "/friseur/berlin/haarwerk"
    r = c.get("/friseur/berlin/haarwerk-alt", follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == "/friseur/berlin/haarwerk"
    assert c.get("/friseur/berlin/entwurf").status_code == 404
    assert c.get("/friseur/berlin/gibtsnicht").status_code == 404
    page = c.get("/barbershop/berlin/kings-barber").text
    assert "Nummer ziehen" in page and "2 Personen warten gerade." in page
    assert c.get("/friseur/berlin-prenzlauer-berg").status_code == 200
    assert c.get("/barbershop/berlin-wedding").status_code == 404
    assert "Friseure in Berlin" in c.get("/friseur").text
    xml = c.get("/sitemap.xml").text
    assert "/friseur/berlin/haarwerk</loc>" in xml and "/barbershop/berlin/kings-barber</loc>" in xml
    assert "/friseur/berlin-prenzlauer-berg</loc>" in xml and "entwurf" not in xml and "shopId=s1" not in xml
    city = c.get("/friseur-ohne-termin/berlin").text
    assert 'href="/barbershop/berlin/kings-barber"' in city and "shop-details" not in city


def test_karte_wunsch_entfernen():
    store = frisch([eintrag("e1", "Haarwerk"), eintrag("e2", "Entwurf", status="entwurf")])
    app = FastAPI()
    app.include_router(public_api.router, prefix="/routes")
    c = TestClient(app)
    salons = c.get("/routes/verzeichnis/karte").json()["salons"]
    assert [s["id"] for s in salons] == ["e1"] and salons[0]["pfad"] == "/friseur/berlin/haarwerk"
    form = {"content-type": "application/x-www-form-urlencoded", "accept": "text/html"}
    r = c.post("/routes/verzeichnis/e1/wunsch", headers=form, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/friseur/berlin/haarwerk?gewuenscht=1#wunsch"
    c.post("/routes/verzeichnis/e1/wunsch", headers=form, follow_redirects=False)
    assert store.hole("e1")["wuensche"] == 1  # je Person und Tag einmal
    assert c.post("/routes/verzeichnis/e2/wunsch").status_code == 404
    assert c.post("/routes/verzeichnis/e1/entfernen", content="grund=falsch", headers=form).status_code == 400
    r = c.post("/routes/verzeichnis/e1/entfernen", content="grund=Bitte+weg&kontakt=ina%40salon.de&inhaber=ja", headers=form)
    assert r.status_code == 200 and "ist offline" in r.text
    assert store.hole("e1")["status"] == "entfernt"
    log = protokoll.read(5)[0]
    assert log["reason"] == "Bitte weg" and log["after"]["kontakt"] == "ina@salon.de"
    assert "kontakt" not in store.hole("e1")  # nicht in Firestore (dort ohne Anmeldung lesbar)


def test_laden_seite_fuer_canonical():
    frisch([eintrag("e1", "Haarwerk"), eintrag("laden-s1", "Kings Barber", shopId="s1", kategorie="barbershop", slug="kings-barber")],
           [{"id": "s1", "name": "Kings Barber", "street": "Weg 1", "postalCode": "10115", "city": "Berlin"}])
    app = FastAPI()
    app.include_router(public_api.router, prefix="/routes")
    c = TestClient(app)
    assert c.get("/routes/verzeichnis/laden/s1").json() == {"pfad": "/barbershop/berlin/kings-barber"}
    assert c.get("/routes/verzeichnis/laden/e1").status_code == 404  # Salon ohne Dranzeit ist kein Laden
    assert c.get("/routes/verzeichnis/laden/gibt-es-nicht").status_code == 404


# --- Betreiber -------------------------------------------------------------------------------------------------------


def test_betreiber_pruefen_und_adresse():
    out = admin_api.pruefen(admin_api.EintragDaten(
        name="  Haar  werk ", postalCode="10439", website="haarwerk.de", schwerpunkte=["A", "", "B"],
        businessHoursByDay=[{"dayOfWeek": 1, "isOpen": True, "openTime": "9", "closeTime": "18",
                             "breaks": [{"startTime": "12", "endTime": "13"}, {"startTime": "20", "endTime": "21"}]}],
    ))
    assert out["name"] == "Haar werk" and out["website"] == "https://haarwerk.de" and out["schwerpunkte"] == ["A", "B"]
    assert out["businessHoursByDay"][0]["breaks"] == [{"startTime": "12:00", "endTime": "13:00"}]
    for bad in ({"postalCode": "123"}, {"kategorie": "nagel"},
                {"businessHoursByDay": [{"dayOfWeek": 1, "isOpen": True, "openTime": "18", "closeTime": "9"}]}):
        try:
            admin_api.pruefen(admin_api.EintragDaten(**bad))
            raise AssertionError(bad)
        except HTTPException as e:
            assert e.status_code == 400
    # veröffentlicht: neue Stadt → neue Adresse, alte leitet weiter
    alt = eintrag("e1", "Haarwerk")
    ch = admin_api._neue_adresse(alt, {**alt, "city": "Potsdam"}, [alt])
    assert ch == {"slug": "haarwerk", "stadtSlug": "potsdam", "altePfade": ["/friseur/berlin/haarwerk"]}
    # Entwurf umbenannt: neuer Slug, keine Weiterleitung
    entwurf = eintrag("e2", "Haarwerk", veroeffentlichtAm=None, status="entwurf")
    assert admin_api._neue_adresse(entwurf, {**entwurf, "name": "Haarwerk Nord"}, [entwurf]) == {"slug": "haarwerk-nord", "stadtSlug": "berlin"}
    # Kategorie geändert: alter Pfad leitet weiter
    assert admin_api._neue_adresse(alt, {**alt, "kategorie": "barbershop"}, [alt])["altePfade"] == ["/friseur/berlin/haarwerk"]


def test_betreiber_ablauf():
    shops = [{"id": "s1", "name": "Haarwerk", "googlePlaceId": "P1", "city": "Berlin", "street": "Weg 1"}]
    store = frisch([eintrag("e1", "Haarwerk", googlePlaceId="P1", status="entwurf", veroeffentlichtAm=None, street="")], shops)
    rows = admin_api.liste()["eintraege"]
    assert rows[0]["vorschlag"]["shopId"] == "s1" and "Adresse" in rows[0]["fehlt"]
    assert not store.hole("laden-s1")  # erst bestätigen, keine zweite Seite
    try:
        admin_api.status("e1", admin_api.StatusRequest(status="online"), USER)
        raise AssertionError("ohne Straße veröffentlicht")
    except HTTPException as e:
        assert "Straße" in e.detail
    admin_api.speichern("e1", admin_api.EintragDaten(street="Schönhauser Allee 80"), USER)
    admin_api.status("e1", admin_api.StatusRequest(status="online"), USER)
    assert store.hole("e1")["status"] == "online" and store.hole("e1")["veroeffentlichtAm"]
    admin_api.uebernahme("e1", admin_api.ShopRequest(shopId="s1"), USER)
    e = store.hole("e1")
    assert e["shopId"] == "s1" and e["vorschlag"] is None and e["slug"] == "haarwerk"
    try:
        admin_api.loeschen("e1", USER)
        raise AssertionError("Seite eines Ladens gelöscht")
    except HTTPException as ex:
        assert ex.status_code == 409
    # Ablehnen: Laden bekommt eigene Seite
    store = frisch([eintrag("e2", "Haarwerk", googlePlaceId="P1")], shops)
    admin_api.liste()
    admin_api.uebernahme_ablehnen("e2", admin_api.ShopRequest(shopId="s1"), USER)
    admin_api.liste()
    assert store.hole("laden-s1")["slug"] == "haarwerk-prenzlauer-berg" and store.hole("e2")["abgelehnt"] == ["s1"]
    assert [x["action"] for x in protokoll.read(3)][0] == "Verzeichnis: Übernahme abgelehnt"


def test_betreiber_import():
    os.environ["ANTHROPIC_API_KEY"] = "test"
    store = frisch([eintrag("e1", "Haarwerk", googlePlaceId="ChIJ_test_0001")])
    imp.profil_von_webseite_orig = getattr(imp, "profil_von_webseite_orig", imp.profil_von_webseite)
    def fake(website, name="", address=""):
        p = imp.profil_aus_antwort({**ANTWORT, "name": "Neuer Salon"})
        p.pop("passt"), p.pop("andereBranche")
        return {**p, "website": website, "quelle": {"website": website, "seiten": [website], "gelesenAm": MONDAY}}

    imp.profil_von_webseite = fake
    try:
        try:
            admin_api.importieren(admin_api.ImportRequest(website="https://x.example", placeId="ChIJ_test_0001"), USER)
            raise AssertionError("doppelt angelegt")
        except HTTPException as e:
            assert e.status_code == 409
        row = admin_api.importieren(admin_api.ImportRequest(website="https://neu.example", placeId="ChIJ_test_0002", name="Neu"), USER)
        e = store.hole(row["id"])
        assert e["status"] == "entwurf" and e["googlePlaceId"] == "ChIJ_test_0002" and e["slug"] == "neuer-salon" and e["bezirk"] == "Pankow"
        assert row["pfad"] == "/friseur/berlin/neuer-salon" and row["fehlt"] == []
    finally:
        imp.profil_von_webseite = imp.profil_von_webseite_orig


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
