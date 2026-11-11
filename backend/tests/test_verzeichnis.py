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
import threading
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["QME_BETREIBER_DIR"] = tempfile.mkdtemp(prefix="verzeichnis-test-")

from databutton_app.mw.auth_mw import get_authorized_user  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.seo as seo  # noqa: E402
import app.verzeichnis_seiten as seiten  # noqa: E402
from app.apis import verzeichnis as public_api  # noqa: E402
from app.apis.betreiber import verzeichnis as admin_api  # noqa: E402
from app.libs import brief  # noqa: E402
from app.libs import briefaktion  # noqa: E402
from app.libs import entfernen as ent  # noqa: E402
from app.libs import protokoll  # noqa: E402
from app.libs import uebernahme as ue  # noqa: E402
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
    briefaktion.set_stores(vz.MemoryStore(), vz.MemoryStore(), vz.MemoryStore())  # Wellen, Sperrliste, Einstellungen
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


def test_abgleich_anfrage_des_inhabers():
    """Übernahme ohne Code: Die angefragte Seite geht an diesen Laden, auch wenn der Name nicht passt"""
    listing = eintrag("e1", "Haarwerk Müller", anfrage={"shopId": "s5", "am": MONDAY})
    shops = [
        {"id": "s1", "name": "Haarwerk", "postalCode": "10439", "city": "Berlin"},  # Name und PLZ passen, aber angefragt hat s5
        {"id": "s5", "name": "Studio Kamm", "postalCode": "10115", "city": "Berlin"},
    ]
    plan = vz.abgleich([listing], shops)
    assert plan["vorschlaege"] == {"e1": {"shopId": "s5", "name": "Studio Kamm", "grund": vz.GRUND_ANFRAGE}}
    assert [s["id"] for s in plan["neu"]] == ["s1"]
    # Abgelehnt: die Anfrage zählt nicht mehr, der Abgleich über den Namen wieder schon
    plan = vz.abgleich([{**listing, "abgelehnt": ["s5"]}], shops)
    assert plan["vorschlaege"]["e1"]["shopId"] == "s1" and [s["id"] for s in plan["neu"]] == ["s5"]
    # Den anfragenden Laden gibt es (noch) nicht in der Liste: dann wie bisher
    plan = vz.abgleich([listing], shops[:1])
    assert plan["vorschlaege"]["e1"]["shopId"] == "s1"
    # Der Laden hat schon eine eigene Seite aus dem Abgleich: Die Anfrage gilt trotzdem
    plan = vz.abgleich([listing, eintrag("laden-s5", "Studio Kamm", shopId="s5")], shops)
    assert plan["vorschlaege"]["e1"]["shopId"] == "s5" and "laden-s5" not in plan["vorschlaege"]


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
    # keine Buchung – auch nicht bei Dranzeit-Läden in der Nähe (neutral). Die Kopfzeile (app/kopfzeile.py) ist das
    # allgemeine Menü der Seite und nennt keinen Laden.
    kopf, inhalt = page.split("</header>", 1)
    assert "public-join-queue" not in inhalt and "shopId" not in kopf
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
    assert "KI-Assistent" not in page and "Per Telefon buchen" not in page
    mit_hinweis = seiten.render_salon(s, d, now=MONDAY, telefon_hinweis=True)
    assert "Geht keiner ran, nimmt ein KI-Assistent ab und bucht dir einen Termin." in mit_hinweis
    assert "<a class=\"btn\" href=\"tel:0309\">Per Telefon buchen</a>" in mit_hinweis
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


def test_karte_und_wunsch():
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


# --- Eintrag entfernen -------------------------------------------------------------------------------------------------

ADRESSEN_ECHT = imp.adressen_der_webseite
HINTERGRUND_ECHT = public_api._im_hintergrund
FORM = {"content-type": "application/x-www-form-urlencoded", "accept": "text/html"}


def entfernen_aufbau(entries, adressen=(), mail_klappt=True):
    """Client, Speicher und gesammelte Mails (an, Betreff, HTML, Text, Antwort an)"""
    import app.libs.mail as mail

    store = frisch(entries)
    public_api._calls.clear()
    imp.adressen_der_webseite = lambda url: set(adressen)
    public_api._im_hintergrund = lambda fn, *args: fn(*args)  # gleich erledigt, dann brauchen die Tests nicht zu warten
    os.environ["QME_ADMIN_EMAILS"] = "betreiber@example.com"
    mails = []

    def senden(to, subject, html_body, text_body="", reply_to=""):
        if not mail_klappt and to != "betreiber@example.com":
            raise mail.MailError("Resend lehnt ab")
        mails.append((to, subject, html_body, text_body, reply_to))
        return True

    mail.send_mail = senden
    app = FastAPI()
    app.include_router(public_api.router, prefix="/routes")
    return TestClient(app), store, mails


def antrag(c, id_="e1", **felder):
    from urllib.parse import urlencode

    return c.post(f"/routes/verzeichnis/{id_}/entfernen", content=urlencode(felder), headers=FORM)


def link_aus(mails, an="info@salon.example"):
    text = next(m[3] for m in mails if m[0] == an)
    return re.search(r"https?://\S+", text).group(0)


def bestaetigen(c, link, token=None):
    pfad = "/routes" + link.split("/routes", 1)[-1].split("?")[0]
    return c.post(pfad, content=f"t={token if token is not None else link.split('t=')[-1]}", headers=FORM)


def test_entfernen_ohne_adresse_aendert_nichts():
    """Die alte Lücke: Ein Häkchen reichte, und der Eintrag war offline"""
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    r = c.post("/routes/verzeichnis/e1/entfernen", content="grund=Bitte+weg&kontakt=ina%40salon.de&inhaber=ja", headers=FORM)
    assert r.status_code == 400 and "gültige E-Mail-Adresse" in r.text
    assert antrag(c, email="kein-mail").status_code == 400
    assert antrag(c, email="a@b.example\nBcc: x@y.example").status_code == 400
    assert store.hole("e1")["status"] == "online" and not mails


def test_falsche_adresse_mail_an_betreiber_eintrag_bleibt():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk", phone="030 123 45")])
    r = antrag(c, email="Fremder@Gmail.com", grund="<b>Bitte weg</b>", aktion="entfernen")
    assert r.status_code == 200 and "Deine Anfrage ist angekommen" in r.text and "fremder@gmail.com" in r.text
    assert "der Domain salon.example" in r.text and "bleibt so lange online" in r.text
    assert store.hole("e1")["status"] == "online" and "entfernen" not in store.hole("e1")
    assert [m[0] for m in mails] == ["betreiber@example.com"]  # nichts an den Salon, nichts an den Fremden
    to, betreff, html_body, text_body, reply_to = mails[0]
    assert "Adresse passt nicht" in betreff and "Haarwerk" in betreff and reply_to == "fremder@gmail.com"
    assert "fremder@gmail.com" in html_body and "030 123 45" in html_body and "/betreiber?reiter=verzeichnis" in html_body
    assert "&lt;b&gt;Bitte weg" in html_body and "<b>Bitte weg" not in html_body and "<b>Bitte weg" in text_body
    log = protokoll.read(5)[0]
    assert log["action"] == "Verzeichnis: Entfernen angefragt" and log["reason"] == "<b>Bitte weg</b>"
    assert log["after"]["kontakt"] == "fremder@gmail.com" and log["after"]["ergebnis"] == "passt_nicht"
    assert "kontakt" not in store.hole("e1") and "email" not in store.hole("e1")  # Adresse nicht in Firestore


def test_passende_adresse_link_und_erst_der_knopf_entfernt():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    r = antrag(c, email="info@salon.example", grund="Geheimtext für den Betreiber", aktion="entfernen")
    assert r.status_code == 200 and "Deine Anfrage ist angekommen" in r.text and "info@salon.example" in r.text
    assert store.hole("e1")["status"] == "online"
    assert sorted(m[0] for m in mails) == ["betreiber@example.com", "info@salon.example"]
    salon = next(m for m in mails if m[0] == "info@salon.example")
    betreiber = next(m for m in mails if m[0] == "betreiber@example.com")
    assert "Geheimtext" not in salon[2] + salon[3]  # Freitext aus dem Formular geht nie an den Salon
    assert "Geheimtext" in betreiber[2] and "Link verschickt" in betreiber[1]
    link = link_aus(mails)
    assert "/routes/verzeichnis/e1/entfernen/bestaetigen?t=" in link
    token = link.split("t=")[-1]
    info = store.hole("e1")["entfernen"]
    assert token not in json.dumps(info, default=str) and info["tokenHash"] and "email" not in info  # nur der Hash, keine Adresse

    # Mail-Programme öffnen Links von selbst: Das Öffnen ändert nichts
    pfad = "/routes" + link.split("/routes", 1)[-1]
    seite = c.get(pfad)
    assert seite.status_code == 200 and "Ja, Eintrag entfernen" in seite.text and seite.headers["cache-control"] == "no-store"
    assert store.hole("e1")["status"] == "online"

    # Falsches Token ändert nichts
    assert bestaetigen(c, link, "falsch").status_code == 410
    assert c.get(pfad.split("?")[0] + "?t=falsch").status_code == 410
    assert bestaetigen(c, link, "").status_code == 410
    assert store.hole("e1")["status"] == "online"

    mails.clear()
    r = bestaetigen(c, link)
    assert r.status_code == 200 and "ist offline" in r.text
    gespeichert = store.hole("e1")
    assert gespeichert["status"] == "entfernt" and gespeichert["entferntAm"] and gespeichert["entfernen"] is None
    assert [m[0] for m in mails] == ["betreiber@example.com"] and "Eintrag entfernt" in mails[0][1] and "Haarwerk" in mails[0][1]
    assert protokoll.read(5)[0]["action"] == "Verzeichnis: vom Salon entfernt"
    seiten_app = FastAPI()
    seiten_app.include_router(seiten.router)
    assert TestClient(seiten_app).get("/friseur/berlin/haarwerk").status_code == 404

    # Zweimal klicken: bleibt erledigt, keine zweite Mail
    mails.clear()
    assert "ist offline" in bestaetigen(c, link).text and not mails


def test_abgelaufener_und_ersetzter_link_gelten_nicht():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    antrag(c, email="info@salon.example")
    link = link_aus(mails)
    token = link.split("t=")[-1]
    gueltig = store.hole("e1")["entfernen"]
    store.aendere("e1", {"entfernen": {**gueltig, "gueltigBis": vz.now() - timedelta(minutes=1)}})
    assert bestaetigen(c, link).status_code == 410 and store.hole("e1")["status"] == "online"
    # Offline genommener oder übernommener Eintrag: Der Link gilt nicht mehr
    assert ent.link_gilt({"status": "online", "entfernen": gueltig}, token)
    assert not ent.link_gilt({"status": "offline", "entfernen": gueltig}, token)
    assert not ent.link_gilt({"status": "online", "shopId": "s1", "entfernen": gueltig}, token)
    assert not ent.link_gilt(None, "x") and not ent.link_gilt({"status": "online"}, "x")
    # Ein neuer Link macht den vorigen ungültig
    store.aendere("e1", {"entfernen": gueltig})
    ent.link_schicken(store.hole("e1"), "info@salon.example")
    assert bestaetigen(c, link).status_code == 410 and store.hole("e1")["status"] == "online"


def test_adresse_von_der_webseite_passt():
    """Gmail-Adresse aus dem Impressum geht, dieselbe Adresse ohne Impressum nicht"""
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")], adressen={"haarwerk.berlin@gmail.com"})
    assert "Deine Anfrage ist angekommen" in antrag(c, email="haarwerk.berlin@gmail.com").text
    assert any(m[0] == "haarwerk.berlin@gmail.com" for m in mails)
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")], adressen={"andere@gmail.com"})
    assert "Deine Anfrage ist angekommen" in antrag(c, email="haarwerk.berlin@gmail.com").text
    assert [m[0] for m in mails] == ["betreiber@example.com"]


def test_domain_regeln():
    passt = lambda website, email: ent.adresse_passt({"website": website}, email)  # noqa: E731
    imp.adressen_der_webseite = lambda url: set()
    assert passt("https://www.Salon-Mueller.de/kontakt", "info@salon-mueller.de")
    assert passt("salon-mueller.de", "info@salon-mueller.de")
    assert not passt("https://salon-mueller.de", "info@salon-mueller.de.evil.example")
    assert not passt("https://salon-mueller.de", "info@evil-salon-mueller.de")
    assert not passt("https://salon.gmx.de", "x@gmx.de")  # Unterseite eines Mail-Anbieters: jede @gmx.de käme sonst durch
    assert not passt("https://www.instagram.com/salon", "x@instagram.com")  # Plattform: zählt nicht als eigene Webseite
    assert not passt("", "x@salon.de")
    assert ent.eigene_domain({"website": "https://www.treatwell.de/ort/salon"}) == ""
    assert ent.adresse_gueltig("info@salon-mueller.de") and not ent.adresse_gueltig("a b@salon.de") and not ent.adresse_gueltig("info@salon")


def test_adressen_auf_der_webseite_lesen():
    from app.apis import shop_setup

    assert imp.adressen_im_text('<a href="mailto:Info@Salon.de?subject=x">Schreib uns</a>') == {"info@salon.de"}
    assert imp.adressen_im_text("info(at)salon.de und chef [at] salon [dot] de") == {"info@salon.de", "chef@salon.de"}
    assert imp.adressen_im_text("inhaber&#64;salon&#46;de") == {"inhaber@salon.de"}
    assert imp.adressen_im_text('<a href="mailto:salon%40web.de">Mail</a>') == {"salon@web.de"}
    assert imp.adressen_im_text('<a href="&#109;ailto:salon&#64;web.de">Mail</a>') == {"salon@web.de"}
    assert imp.adressen_im_text("Keine Adresse hier") == set()
    # Im Echttest gefunden: Das zählt nicht als Adresse des Salons, auch wenn es im HTML steht
    assert imp.adressen_im_text('<img srcset="logo@2x.png 2x" alt="x"><input placeholder="name@example.com">') == set()
    assert imp.adressen_im_text('<form><label>muster@gmail.com</label></form>') == set()
    assert imp.adressen_im_text('<script>var dsn = "https://abc123@sentry.io/1"</script><a href="https://x@y.example/">Link</a>') == set()

    web = {
        "https://salon.example/": ("https://salon.example/", '<a href="/impressum">Impressum</a><a href="/preise">Preise</a> start@salon.example'),
        "https://salon.example/impressum": ("https://salon.example/impressum", "E-Mail: salon.haar(at)gmail.com"),
    }
    abrufe = []

    def holen(url, deadline=None):
        abrufe.append(url)
        if url not in web:
            raise ValueError("nicht erreichbar")
        return web[url]

    echt = shop_setup.fetch_page
    shop_setup.fetch_page = holen
    try:
        assert ADRESSEN_ECHT("https://salon.example/") == {"start@salon.example", "salon.haar@gmail.com"}
        assert "https://salon.example/preise" not in abrufe  # nur Impressum und Kontakt
        abrufe.clear()
        assert ADRESSEN_ECHT("https://www.instagram.com/salon") == set() and not abrufe  # Plattform wird gar nicht gelesen
        assert ADRESSEN_ECHT("https://nicht-da.example/") == set()  # Seite antwortet nicht
        web["https://umzug.example/"] = ("https://www.instagram.com/salon", "fremd@example.com")
        assert ADRESSEN_ECHT("https://umzug.example/") == set()  # Weiterleitung auf eine Plattform
    finally:
        shop_setup.fetch_page = echt


def test_eintrag_ohne_eigene_webseite_nur_von_hand():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk", website=""), eintrag("e2", "Kamm", website="https://www.instagram.com/kamm")])
    for id_ in ("e1", "e2"):
        r = antrag(c, id_, email="info@salon.example")
        assert r.status_code == 200 and "von Hand" in r.text and store.hole(id_)["status"] == "online"
    assert [m[0] for m in mails] == ["betreiber@example.com"] * 2 and "Von Hand prüfen" in mails[0][1]


def test_korrektur_aendert_nichts_am_eintrag():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    assert antrag(c, email="info@salon.example", aktion="korrigieren").status_code == 400 and not mails  # ohne Text
    r = antrag(c, email="info@salon.example", grund="Montag zu", aktion="korrigieren")
    assert r.status_code == 200 and "Danke für den Hinweis" in r.text and store.hole("e1")["status"] == "online"
    assert [m[0] for m in mails] == ["betreiber@example.com"] and "Korrektur" in mails[0][1] and "Montag zu" in mails[0][2]
    assert "entfernen" not in store.hole("e1")


def test_mail_geht_nicht_raus():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")], mail_klappt=False)
    r = antrag(c, email="info@salon.example")
    assert r.status_code == 200 and "Deine Anfrage ist angekommen" in r.text and store.hole("e1")["status"] == "online"
    assert [m[0] for m in mails] == ["betreiber@example.com"] and "Link nicht verschickt" in mails[0][1]


def test_scheitert_der_link_erfaehrt_es_der_betreiber():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])

    def kaputt(entry_id, changes):
        raise RuntimeError("Firestore weg")

    store.aendere = kaputt
    r = antrag(c, email="info@salon.example")
    assert r.status_code == 200 and [m[0] for m in mails] == ["betreiber@example.com"] and "Link nicht verschickt" in mails[0][1]
    assert protokoll.read(5)[0]["after"]["ergebnis"] == "nicht_verschickt"


def test_mehrfach_klicken_zaehlt_einmal():
    """Echttest 01.11.2026: Zehn Klicks in 15 Sekunden, fünf Mails, und die Tagesgrenze war weg"""
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    antworten = [antrag(c, email="fremd@gmail.com", grund="Bitte weg", aktion="entfernen") for _ in range(10)]
    assert all(r.status_code == 200 and "Deine Anfrage ist angekommen" in r.text for r in antworten)
    assert [m[0] for m in mails] == ["betreiber@example.com"]
    # Die Grenze ist dadurch nicht verbraucht: noch vier andere Adressen, dann erst Schluss
    for nr in range(4):
        assert antrag(c, email=f"fremd{nr}@gmail.com").status_code == 200
    assert antrag(c, email="fremd4@gmail.com").status_code == 429
    # Auch der zweite Klick sagt nicht „angekommen“, wenn nichts passiert ist
    assert antrag(c, email="fremd4@gmail.com").status_code == 429 and len(mails) == 5
    # Anderes Anliegen mit derselben Adresse ist eine neue Anfrage
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    antrag(c, email="fremd@gmail.com", grund="Montag zu", aktion="entfernen")
    antrag(c, email="fremd@gmail.com", grund="Montag zu", aktion="korrigieren")
    assert len(mails) == 2


def test_antwort_wartet_nicht_auf_die_webseite():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    public_api._im_hintergrund = HINTERGRUND_ECHT
    weiter = threading.Event()

    def langsam(url):
        assert weiter.wait(5)
        return {"salon.haar@gmail.com"}

    imp.adressen_der_webseite = langsam
    r = antrag(c, email="salon.haar@gmail.com")
    assert r.status_code == 200 and "Deine Anfrage ist angekommen" in r.text and not mails  # Antwort da, Webseite noch nicht gelesen
    weiter.set()
    frist = time.monotonic() + 5
    while len(mails) < 2 and time.monotonic() < frist:
        time.sleep(0.01)
    assert sorted(m[0] for m in mails) == ["betreiber@example.com", "salon.haar@gmail.com"]
    # Fehler im Hintergrund landen im Log und reißen nichts mit
    fertig = threading.Event()
    HINTERGRUND_ECHT(lambda: 1 / 0)
    HINTERGRUND_ECHT(fertig.set)
    assert fertig.wait(5)


def test_bremsen():
    # Je Eintrag ein Link pro Stunde; der nächste Versuch landet beim Betreiber
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    antrag(c, email="info@salon.example")
    mails.clear()
    r = antrag(c, email="chef@salon.example")
    assert r.status_code == 200 and [m[0] for m in mails] == ["betreiber@example.com"] and "Schon ein Link unterwegs" in mails[0][1]
    # Obergrenze aller Mails: danach einmal Bescheid sagen, dann Ruhe; Einträge bleiben online
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    alt = public_api.LIMITS["entfernen-mails"], public_api.LIMITS["entfernen"]
    public_api.LIMITS["entfernen-mails"], public_api.LIMITS["entfernen"] = (2, 86400), (100, 86400)
    try:
        for nr in range(6):
            antrag(c, email=f"fremd{nr}@gmail.com")
    finally:
        public_api.LIMITS["entfernen-mails"], public_api.LIMITS["entfernen"] = alt
    assert len(mails) == 3 and "ungewöhnlich viele" in mails[-1][1] and store.hole("e1")["status"] == "online"


def test_formular_auf_der_seite():
    frisch([eintrag("e1", "Haarwerk", website="https://www.haarwerk.example/"), eintrag("e2", "Kamm", website="", slug="kamm")])
    app = FastAPI()
    app.include_router(seiten.router)
    c = TestClient(app)
    page = c.get("/friseur/berlin/haarwerk").text
    assert 'action="/routes/verzeichnis/e1/entfernen"' in page and 'type="email" name="email" required' in page
    assert "mit der Domain haarwerk.example" in page and 'value="korrigieren"' in page
    assert "Ich gehöre zu diesem Salon" not in page and "sofort offline" not in page
    assert "Wir prüfen es von Hand" in c.get("/friseur/berlin/kamm").text


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


# --- Übernahme per Code (app/libs/uebernahme.py) ---------------------------------------------------------------------


def _fehler(fn, *args) -> int:
    try:
        fn(*args)
    except ue.Fehler as e:
        return e.status
    raise AssertionError(f"{fn.__name__}{args} ohne Fehler")


def test_uebernahme_code():
    store = frisch([eintrag("e1", "Haarwerk"), eintrag("laden-s1", "Haarwerk Neu", shopId="s1", slug="haarwerk-neu")])
    code = ue.code_erzeugen(store.hole("e1"), store, MONDAY)["code"]
    assert re.fullmatch(r"[A-Z2-9]{5}-[A-Z2-9]{5}", code) and not set(code) & set("01OIL")
    info = store.hole("e1")["uebernahme"]
    assert info["codeHash"] == ue.code_hash(code) and code.replace("-", "") not in json.dumps(info, default=str)
    assert info["gueltigBis"] == MONDAY + timedelta(days=ue.GUELTIG_TAGE)
    # Schreibweise egal; falsch, zu kurz und abgelaufen nicht
    assert ue.pruefen(code.lower().replace("-", " "), store, MONDAY)["id"] == "e1"
    assert _fehler(ue.pruefen, "", store, MONDAY) == 404 and _fehler(ue.pruefen, "AAAAA-AAAAA", store, MONDAY) == 404
    assert _fehler(ue.pruefen, code, store, MONDAY + timedelta(days=ue.GUELTIG_TAGE + 1)) == 410
    # Neuer Code: der alte gilt nicht mehr
    neu = ue.code_erzeugen(store.hole("e1"), store, MONDAY)["code"]
    assert _fehler(ue.pruefen, code, store, MONDAY) == 404
    # Einlösen: Eintrag wird die Seite des Ladens, die Seite aus dem Abgleich leitet hierher
    ue.einloesen(neu, "s1", store, MONDAY)
    e = store.hole("e1")
    assert e["shopId"] == "s1" and e["status"] == "online" and e["slug"] == "haarwerk"
    assert e["uebernahme"]["eingeloestAm"] == MONDAY and e["uebernahme"]["shopId"] == "s1"
    assert not store.hole("laden-s1") and e["altePfade"] == ["/friseur/berlin/haarwerk-neu"]
    assert _fehler(ue.einloesen, neu, "s2", store, MONDAY) == 409  # nur einmal
    assert _fehler(ue.code_erzeugen, store.hole("e1"), store) == 409  # Seite eines Ladens bekommt keinen Code


def test_uebernahme_api():
    store = frisch([eintrag("e1", "Haarwerk"), eintrag("e2", "Entwurf", status="entwurf")],
                   [{"id": "s1", "name": "Haarwerk", "street": "Schönhauser Allee 80", "postalCode": "10439", "city": "Berlin"}])
    public_api._calls.clear()
    app = FastAPI()
    app.include_router(public_api.router, prefix="/routes")
    app.include_router(admin_api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: USER
    c = TestClient(app)
    # Vorschau für den Assistenten: nur veröffentlichte Seiten ohne Laden
    v = c.get("/routes/verzeichnis/e1/vorschau").json()
    assert v["name"] == "Haarwerk" and v["kategorie"] == "friseur" and v["services"][0]["name"] == "Herrenschnitt"
    assert v["pfad"] == "/friseur/berlin/haarwerk" and v["businessHoursByDay"] == HOURS and "wuensche" not in v
    assert c.get("/routes/verzeichnis/e2/vorschau").status_code == 404
    # Betreiber erzeugt den Code; die Liste zeigt nur, dass es einen gibt
    r = c.post("/routes/betreiber/verzeichnis/e1/code", headers={"origin": "https://dranzeit.de"}).json()
    assert r["link"] == f"https://dranzeit.de/uebernehmen#code={r['code'].replace('-', '')}"
    row = next(x for x in admin_api.liste()["eintraege"] if x["id"] == "e1")
    assert row["uebernahme"]["gueltigBis"] and "codeHash" not in json.dumps(row, default=str)
    # Prüfen ohne Anmeldung
    assert c.post("/routes/verzeichnis/uebernahme/pruefen", json={"code": "falsch"}).status_code == 404
    p = c.post("/routes/verzeichnis/uebernahme/pruefen", json={"code": r["code"].lower()}).json()
    assert p["code"] == r["code"] and p["eintrag"]["id"] == "e1"
    # Einlösen nur für den eigenen Laden
    def fremd(user, shop_id):
        raise HTTPException(status_code=403, detail="Das ist nicht dein Laden.")

    public_api.require_shop_of_owner = fremd
    assert c.post("/routes/verzeichnis/uebernahme/einloesen", json={"code": r["code"], "shopId": "s1"}).status_code == 403
    public_api.require_shop_of_owner = lambda user, shop_id: None
    public_api._laden = lambda shop_id: {"id": shop_id, "name": "Haarwerk"} if shop_id == "s1" else {}
    assert c.post("/routes/verzeichnis/uebernahme/einloesen", json={"code": r["code"], "shopId": "s9"}).status_code == 404
    ok = c.post("/routes/verzeichnis/uebernahme/einloesen", json={"code": r["code"], "shopId": "s1"}).json()
    assert ok == {"ok": True, "pfad": "/friseur/berlin/haarwerk"} and store.hole("e1")["shopId"] == "s1"
    assert protokoll.read(1)[0]["action"] == "Verzeichnis: per Code übernommen"
    assert c.post("/routes/verzeichnis/uebernahme/pruefen", json={"code": r["code"]}).status_code == 409
    # Die Seite zeigt jetzt den Laden; ein anderer Salon verweist auf die Übernahme mit Vorbefüllung
    seiten.vergessen()
    assert seiten.daten()["nach_pfad"]["/friseur/berlin/haarwerk"]["typ"] == "laden"
    frisch([eintrag("e3", "Kamm & Co")])
    html = seiten.render_salon(seiten.daten()["nach_pfad"]["/friseur/berlin/kamm-co"], seiten.daten(), MONDAY)
    assert '<p class="klein" id="uebernehmen">Ist das dein Salon? <a href="/uebernehmen?eintrag=e3">Seite übernehmen</a></p>' in html
    assert 'class="btn main" href="/uebernehmen' not in html  # sichtbar, aber nicht im Fokus
    # Raten wird gebremst
    public_api._calls.clear()
    codes = [c.post("/routes/verzeichnis/uebernahme/pruefen", json={"code": "AAAAA-AAAA" + x}).status_code for x in "ABCDEFGHJKMNPQRSTUVWX"]
    assert codes[-1] == 429 and codes.count(404) == public_api.LIMITS["code"][0]


def test_brief():
    e = eintrag("e1", "Kuaför Şahin & Söhne", street="Hauptstr. 1", wuensche=2)
    # Regeln: nur veröffentlichte Seiten mit Anschrift; wer die Seite entfernt hat, bekommt keine Post
    assert brief.hindernis(e) == ""
    assert "Veröffentliche" in brief.hindernis({**e, "status": "entwurf"})
    assert "keine Post" in brief.hindernis({**e, "status": "entfernt"})
    assert "Anschrift" in brief.hindernis({**e, "street": " "})
    # Wortlaut: Wünsche ab drei, Plätze ehrlich, Quelle wie am Eintrag, Name maskiert
    t = brief.texte(e, "https://dranzeit.de", 100)
    assert "&amp;" in t["betreff"] and t["wuensche"] == "" and "ersten 100 Läden" in t["angebot"]
    assert "dranzeit.de/friseur/berlin/kuafoer-sahin-soehne" in t["einstieg"] and "von deiner Webseite" in t["einstieg"]
    assert "3 Leute" in brief.texte({**e, "wuensche": 3}, "https://dranzeit.de", 84)["wuensche"]
    assert "Noch 84 von 100" in brief.texte(e, "https://dranzeit.de", 84)["angebot"]
    assert "Gründer" not in brief.texte(e, "https://dranzeit.de", 0)["angebot"]
    assert "öffentlichen Quellen" in brief.texte({**e, "quelle": None}, "https://dranzeit.de", 1)["einstieg"]
    # Blatt: eine Seite, Schriften eingebettet
    gueltig = MONDAY + timedelta(days=ue.GUELTIG_TAGE)
    daten = brief.pdf(e, "ABCDE-FGHJK", gueltig, "https://dranzeit.de", 100, MONDAY)
    assert daten.startswith(b"%PDF") and b"/Count 1" in daten and daten.count(b"/FontFile2") == 4
    # Auch mit langem Namen und allen Textbausteinen: Marke ganz im mittleren Drittel, Text über der Fußzeile
    lang = {**e, "name": "Haarstudio und Barbershop am Schönhauser Tor bei Friseurmeisterin Musterfrau", "wuensche": 12}
    c = brief.canvas.Canvas(brief.io.BytesIO(), pagesize=brief.A4)
    masse = brief.zeichnen(c, lang, "ABCDE-FGHJK", gueltig, "https://dranzeit.de", 84, MONDAY)
    assert masse["text_vor_marke"] <= brief.MARKE_MM - 1
    assert brief.FALZ[0] < brief.MARKE_MM and masse["marke_unten"] <= brief.FALZ[1] - 2
    assert masse["text_unten"] < 277


def test_brief_api():
    store = frisch([eintrag("e1", "Haarwerk"), eintrag("e2", "Kamm & Co"), eintrag("e3", "Entwurf", status="entwurf")])
    admin_api._gruenderplaetze = lambda: 84
    app = FastAPI()
    app.include_router(admin_api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: USER
    c = TestClient(app)
    code = c.post("/routes/betreiber/verzeichnis/e1/code").json()["code"]
    r = c.post("/routes/betreiber/verzeichnis/e1/brief", json={"code": code})
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"
    assert 'filename="Dranzeit-Brief-haarwerk.pdf"' in r.headers["content-disposition"] and r.headers["cache-control"] == "private, no-store"
    # Der Code steht nicht im Protokoll
    zeile = protokoll.read(1)[0]
    assert zeile["action"] == "Verzeichnis: Brief erzeugt" and code not in json.dumps(zeile, default=str)
    # Falscher Code, fremder Code, Entwurf
    assert c.post("/routes/betreiber/verzeichnis/e1/brief", json={"code": "AAAAA-AAAAA"}).status_code == 404
    assert c.post("/routes/betreiber/verzeichnis/e2/brief", json={"code": code}).status_code == 409
    entwurf = c.post("/routes/betreiber/verzeichnis/e3/code").json()["code"]
    r = c.post("/routes/betreiber/verzeichnis/e3/brief", json={"code": entwurf})
    assert r.status_code == 409 and "Veröffentliche" in r.json()["detail"]
    # Eingelöst: kein Brief mehr
    ue.einloesen(code, "s1", store, MONDAY)
    assert c.post("/routes/betreiber/verzeichnis/e1/brief", json={"code": code}).status_code == 409


def test_uebernahme_anfrage_ohne_code():
    shop = {"id": "s5", "name": "Studio Kamm", "street": "Torstraße 1", "postalCode": "10115", "city": "Berlin", "phone": "030 9"}
    store = frisch([eintrag("e1", "Haarwerk"), eintrag("e2", "Entwurf", status="entwurf")], [shop])
    public_api._calls.clear()
    app = FastAPI()
    app.include_router(public_api.router, prefix="/routes")
    app.include_router(admin_api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: USER
    c = TestClient(app)
    import app.libs.mail as mail

    mails = []
    mail.send_mail = lambda to, subject, html_body, text_body="", reply_to="": mails.append((to, subject, html_body, text_body)) or True
    os.environ["QME_ADMIN_EMAILS"] = "betreiber@example.com"

    def fremd(user, shop_id):
        raise HTTPException(status_code=403, detail="Das ist nicht dein Laden.")

    public_api.require_shop_of_owner = fremd
    assert c.post("/routes/verzeichnis/uebernahme/anfragen", json={"eintragId": "e1", "shopId": "s5"}).status_code == 403
    public_api.require_shop_of_owner = lambda user, shop_id: None
    public_api._laden = lambda shop_id: dict(shop) if shop_id == "s5" else {}
    assert c.post("/routes/verzeichnis/uebernahme/anfragen", json={"eintragId": "e1", "shopId": "s9"}).status_code == 404
    assert c.post("/routes/verzeichnis/uebernahme/anfragen", json={"eintragId": "e2", "shopId": "s5"}).status_code == 404
    ok = c.post("/routes/verzeichnis/uebernahme/anfragen", json={"eintragId": "e1", "shopId": "s5"}).json()
    assert ok == {"ok": True, "pfad": "/friseur/berlin/haarwerk"}
    e = store.hole("e1")
    assert e["anfrage"]["shopId"] == "s5" and e["vorschlag"]["shopId"] == "s5" and e["vorschlag"]["grund"] == vz.GRUND_ANFRAGE
    assert not e.get("shopId")  # verbunden wird erst nach Bestätigung
    assert protokoll.read(1)[0]["action"] == "Verzeichnis: Übernahme angefragt"
    # Mail an den Betreiber mit beiden Adressen und dem Weg in den Betreiber-Bereich
    assert len(mails) == 1 and mails[0][0] == "betreiber@example.com" and mails[0][1] == "Übernahme angefragt: Haarwerk"
    assert "Studio Kamm · Torstraße 1, 10115 Berlin · 030 9 · chef@dranzeit.de" in mails[0][3]
    assert "/betreiber?reiter=verzeichnis" in mails[0][2] and "https://dranzeit.de/friseur/berlin/haarwerk" in mails[0][3]
    # Noch einmal: keine zweite Mail; der Abgleich behält den Vorschlag, der Laden bekommt keine eigene Seite
    assert c.post("/routes/verzeichnis/uebernahme/anfragen", json={"eintragId": "e1", "shopId": "s5"}).status_code == 200
    assert len(mails) == 1
    row = next(x for x in admin_api.liste()["eintraege"] if x["id"] == "e1")
    assert row["vorschlag"]["shopId"] == "s5" and not store.hole("laden-s5")
    # Abgelehnt: Anfrage weg, erneut anfragen geht nicht
    assert c.post("/routes/betreiber/verzeichnis/e1/uebernahme-ablehnen", json={"shopId": "s5"}).status_code == 200
    e = store.hole("e1")
    assert e["anfrage"] is None and e["abgelehnt"] == ["s5"]
    assert c.post("/routes/verzeichnis/uebernahme/anfragen", json={"eintragId": "e1", "shopId": "s5"}).status_code == 409
    # Bestätigt: die Seite gehört dem Laden
    store.aendere("e1", {"abgelehnt": [], "anfrage": None})
    assert c.post("/routes/verzeichnis/uebernahme/anfragen", json={"eintragId": "e1", "shopId": "s5"}).status_code == 200
    assert c.post("/routes/betreiber/verzeichnis/e1/uebernahme", json={"shopId": "s5"}).status_code == 200
    assert store.hole("e1")["shopId"] == "s5" and len(mails) == 2
    # Laden mit eigener Seite aus dem Abgleich: Vorschlag übersteht den nächsten Abgleich, Bestätigen leitet die alte Seite um
    store = frisch([eintrag("e1", "Haarwerk"), eintrag("laden-s5", "Studio Kamm", shopId="s5", slug="studio-kamm")], [shop])
    public_api._calls.clear()
    assert c.post("/routes/verzeichnis/uebernahme/anfragen", json={"eintragId": "e1", "shopId": "s5"}).status_code == 200
    assert next(x for x in admin_api.liste()["eintraege"] if x["id"] == "e1")["vorschlag"]["shopId"] == "s5"
    assert c.post("/routes/betreiber/verzeichnis/e1/uebernahme", json={"shopId": "s5"}).status_code == 200
    assert store.hole("e1")["shopId"] == "s5" and not store.hole("laden-s5")
    assert store.hole("e1")["altePfade"] == ["/friseur/berlin/studio-kamm"] and len(mails) == 3
    # Ohne Betreiber-Adresse: nur ins Log
    os.environ["QME_ADMIN_EMAILS"] = ""
    public_api.anfrage_melden(eintrag("e3", "Kamm & Co"), shop, "")
    assert len(mails) == 3


# --- Übernahme per E-Mail (app/libs/uebernahme_mail.py) --------------------------------------------------------------


def nachweis(c, email, id_="e1"):
    return c.post("/routes/verzeichnis/uebernahme/nachweis", json={"eintragId": id_, "email": email})


def code_aus(mails, an="info@salon.example"):
    text = next(m[3] for m in mails if m[0] == an)
    return re.search(r"/uebernehmen#code=([A-Z2-9]{10})", text).group(1)


def test_nachweis_passende_adresse_erst_der_laden_verbindet():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    assert c.get("/routes/verzeichnis/e1/vorschau").json()["domain"] == "salon.example"
    r = nachweis(c, " Info@Salon.example ")
    assert r.status_code == 200 and r.json() == {"ok": True}  # die Antwort nennt das Ergebnis nicht
    e = store.hole("e1")
    assert not e.get("shopId") and e["status"] == "online"
    assert sorted(m[0] for m in mails) == ["betreiber@example.com", "info@salon.example"]
    code = code_aus(mails)
    assert e["mailCode"]["codeHash"] == ue.code_hash(code) and code not in json.dumps(e, default=str)
    assert code not in json.dumps(protokoll.read(5), default=str)
    an_salon = next(m for m in mails if m[0] == "info@salon.example")
    assert an_salon[1] == "Seite übernehmen: Haarwerk" and "Warst du das nicht?" in an_salon[3] and "https://dranzeit.de/uebernehmen#code=" in an_salon[2]
    an_mich = next(m for m in mails if m[0] == "betreiber@example.com")
    assert "Link verschickt" in an_mich[1] and an_mich[4] == "info@salon.example" and code not in an_mich[2] + an_mich[3]
    log = protokoll.read(5)[0]
    assert log["action"] == "Verzeichnis: Übernahme per E-Mail angefragt" and log["after"]["kontakt"] == "info@salon.example" and log["after"]["ergebnis"] == "link"
    # Den Link aufzurufen ändert nichts (Mail-Programme tun das von selbst)
    assert c.post("/routes/verzeichnis/uebernahme/pruefen", json={"code": code}).json()["eintrag"]["id"] == "e1"
    assert not store.hole("e1").get("shopId")
    # Erst mit dem eigenen Laden gehört die Seite ihm, und der Betreiber erfährt es
    c.app.dependency_overrides[get_authorized_user] = lambda: USER
    public_api.require_shop_of_owner = lambda user, shop_id: None
    public_api._laden = lambda shop_id: {"id": shop_id, "name": "Haarwerk"}
    mails.clear()
    ok = c.post("/routes/verzeichnis/uebernahme/einloesen", json={"code": code, "shopId": "s1"}).json()
    assert ok == {"ok": True, "pfad": "/friseur/berlin/haarwerk"} and store.hole("e1")["shopId"] == "s1"
    assert protokoll.read(1)[0]["after"]["nachweis"] == "Link an die Salon-Adresse"
    assert [m[0] for m in mails] == ["betreiber@example.com"] and mails[0][1] == "Seite übernommen: Haarwerk"
    assert "Link an die Salon-Adresse" in mails[0][3] and "chef@dranzeit.de" in mails[0][3]
    # Der Link geht danach nicht noch einmal
    assert c.post("/routes/verzeichnis/uebernahme/pruefen", json={"code": code}).status_code == 409
    assert nachweis(c, "info@salon.example").status_code == 404


def test_nachweis_falsche_adresse_nur_mail_an_betreiber():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    assert nachweis(c, "Fremder@Gmail.com").status_code == 200
    e = store.hole("e1")
    assert "mailCode" not in e and not e.get("shopId") and "fremder" not in json.dumps(e, default=str)
    assert [m[0] for m in mails] == ["betreiber@example.com"]  # nichts an den Salon, nichts an den Fremden
    to, betreff, html_body, text_body, reply_to = mails[0]
    assert "Adresse passt nicht" in betreff and "Haarwerk" in betreff and reply_to == "fremder@gmail.com"
    assert "fremder@gmail.com" in html_body and "030 123 45" in html_body and "/betreiber?reiter=verzeichnis" in html_body
    assert protokoll.read(5)[0]["after"]["ergebnis"] == "passt_nicht"
    # Eine Adresse, die auf der Webseite steht, passt auch ohne eigene Domain
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")], adressen=["haarwerk@gmail.com"])
    assert nachweis(c, "haarwerk@gmail.com").status_code == 200
    assert "haarwerk@gmail.com" in [m[0] for m in mails] and store.hole("e1")["mailCode"]


def test_nachweis_ohne_webseite_und_ungueltig():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk", website=""), eintrag("e2", "Entwurf", status="entwurf"), eintrag("e3", "Laden", shopId="s1")])
    assert c.get("/routes/verzeichnis/e1/vorschau").json()["domain"] == ""
    assert nachweis(c, "info@salon.example").status_code == 200
    assert "mailCode" not in store.hole("e1") and [m[0] for m in mails] == ["betreiber@example.com"] and "Von Hand prüfen" in mails[0][1]
    mails.clear()
    assert nachweis(c, "kein-mail").status_code == 400 and nachweis(c, "a@b.example\nBcc: x@y.example").status_code == 400
    assert nachweis(c, "info@salon.example", "e2").status_code == 404 and nachweis(c, "info@salon.example", "e3").status_code == 404
    assert not mails


def test_scheitert_der_nachweis_erfaehrt_es_der_betreiber():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")], mail_klappt=False)
    assert nachweis(c, "info@salon.example").status_code == 200
    assert [m[0] for m in mails] == ["betreiber@example.com"] and "Link nicht verschickt" in mails[0][1]
    assert protokoll.read(5)[0]["after"]["ergebnis"] == "nicht_verschickt"


def test_mail_code_neben_dem_brief():
    store = frisch([eintrag("e1", "Haarwerk")])
    brief = ue.code_erzeugen(store.hole("e1"), store, MONDAY)["code"]
    erste = ue.mail_code_erzeugen(store.hole("e1"), store, MONDAY)
    zweite = ue.mail_code_erzeugen(store.hole("e1"), store, MONDAY)
    # Wer den Link an die öffentliche Salon-Adresse auslöst, entwertet keinen Brief; ein neuer Link nur den vorigen Link
    assert ue.pruefen(brief, store, MONDAY)["id"] == "e1" and ue.pruefen(zweite, store, MONDAY)["id"] == "e1"
    assert _fehler(ue.pruefen, erste, store, MONDAY) == 404
    assert ue.per_mail(store.hole("e1"), zweite) and not ue.per_mail(store.hole("e1"), brief)
    # Der Link läuft früher ab als der Brief
    spaeter = MONDAY + timedelta(days=ue.MAIL_GUELTIG_TAGE + 1)
    assert _fehler(ue.pruefen, zweite, store, spaeter) == 410 and ue.pruefen(brief, store, spaeter)["id"] == "e1"
    # Der Betreiber-Bereich zeigt keinen Hash
    assert "codeHash" not in json.dumps(admin_api.zeile(store.hole("e1"), {}), default=str)
    # Eingelöst: beide sind verbraucht
    ue.einloesen(zweite, "s1", store, MONDAY)
    assert store.hole("e1")["shopId"] == "s1" and store.hole("e1")["uebernahme"]["eingeloestAm"] == MONDAY
    assert _fehler(ue.pruefen, brief, store, MONDAY) == 409 and _fehler(ue.pruefen, zweite, store, MONDAY) == 409


def test_nachweis_bremsen():
    c, store, mails = entfernen_aufbau([eintrag("e1", "Haarwerk")])
    # Ungeduldig geklickt: eine Anfrage, ein Link, eine Mail an den Betreiber
    assert all(nachweis(c, "info@salon.example").status_code == 200 for _ in range(10))
    assert sorted(m[0] for m in mails) == ["betreiber@example.com", "info@salon.example"]
    # Je Eintrag ein Link pro Stunde; der nächste Versuch landet beim Betreiber
    mails.clear()
    assert nachweis(c, "chef@salon.example").status_code == 200
    assert [m[0] for m in mails] == ["betreiber@example.com"] and "Schon ein Link unterwegs" in mails[0][1]
    # Tagesgrenze je IP: fünf Anfragen, die sechste nicht, auch nicht beim zweiten Klick
    assert all(nachweis(c, f"fremd{nr}@gmail.com").status_code == 200 for nr in range(3))
    assert nachweis(c, "noch@gmail.com").status_code == 429 and nachweis(c, "noch@gmail.com").status_code == 429


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
