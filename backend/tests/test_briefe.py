"""
Tests für Briefe an Salons in Wellen (requirements/briefversand.md, tasks/task-001): Sperre „Keine Post mehr“ mit
Sperrliste, Unzustellbar, Regeln, Einstellungen, Wellen mit Sammel-PDF, Erinnerung und Auswertung. app/libs/briefaktion.py,
app/apis/betreiber/briefe.py und der Link auf der Salonseite. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_briefe.py
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["QME_BETREIBER_DIR"] = tempfile.mkdtemp(prefix="briefe-test-")

from databutton_app.mw.auth_mw import get_authorized_user  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.seo as seo  # noqa: E402
import app.verzeichnis_seiten as seiten  # noqa: E402
from app.apis import verzeichnis as public_api  # noqa: E402
from app.apis.betreiber import briefe as briefe_api  # noqa: E402
from app.apis.betreiber import verzeichnis as admin_api  # noqa: E402
from app.libs import briefaktion as ba  # noqa: E402
from app.libs import entfernen as ent  # noqa: E402
from app.libs import mail  # noqa: E402
from app.libs import protokoll  # noqa: E402
from app.libs import verzeichnis as vz  # noqa: E402

MONDAY = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)
USER = SimpleNamespace(email="chef@dranzeit.de", sub="chef")
FORM = {"content-type": "application/x-www-form-urlencoded", "accept": "text/html"}


def eintrag(id_, name, **extra):
    base = {
        "id": id_, "name": name, "kategorie": "friseur", "street": "Schönhauser Allee 80", "postalCode": "10439",
        "city": "Berlin", "stadtSlug": "berlin", "slug": vz.slugify(name), "ortsteil": "Prenzlauer Berg", "bezirk": "Pankow",
        "coordinates": {"latitude": 52.5492, "longitude": 13.4156}, "phone": "030 123 45", "website": "https://salon.example/",
        "businessHoursByDay": [], "services": [], "beschreibung": "Der Salon schneidet Damen und Herren.",
        "status": "online", "wuensche": 0, "quelle": {"website": "https://salon.example/", "seiten": [], "gelesenAm": MONDAY},
        "veroeffentlichtAm": MONDAY,
    }
    base.update(extra)
    return base


def frisch(entries=()):
    """Eigene Speicher für Verzeichnis, Wellen, Sperrliste und Einstellungen; Mails gesammelt statt verschickt"""
    store = vz.MemoryStore(entries)
    vz.set_store(store)
    ba.set_stores(vz.MemoryStore(), vz.MemoryStore(), vz.MemoryStore())
    seo._cache.clear()
    seo.load_shops = lambda: []
    seiten.vergessen()
    os.environ["QME_ADMIN_EMAILS"] = "betreiber@example.com"
    mails = []
    mail.send_mail = lambda to, subject, html_body, text_body="", reply_to="": mails.append((to, subject, text_body)) or True
    return store, mails


def admin_client():
    app = FastAPI()
    app.include_router(admin_api.router, prefix="/routes")
    app.include_router(briefe_api.router, prefix="/routes")
    briefe_api._gruenderplaetze = lambda: 84
    app.dependency_overrides[get_authorized_user] = lambda: USER
    return TestClient(app)


def public_client():
    public_api._calls.clear()
    public_api._im_hintergrund = lambda fn, *args: fn(*args)
    app = FastAPI()
    app.include_router(public_api.router, prefix="/routes")
    app.include_router(seiten.router)
    return TestClient(app)


# --- Keine Post mehr, Sperrliste, Unzustellbar -----------------------------------------------------------------------


def test_sperre_und_sperrliste():
    store, _ = frisch([eintrag("e1", "Haarwerk"),
                       eintrag("e2", "Kamm", street="Hauptstraße 1", postalCode="13403", googlePlaceId="ChIJkamm1234567")])
    assert ba.hindernis(store.hole("e1"), ba.sperrliste(), MONDAY) == ""
    ba.sperren(store.hole("e1"), "E-Mail", MONDAY)
    e1 = store.hole("e1")
    assert e1["postSperre"]["grund"] == "E-Mail" and e1["postSperre"]["am"] == MONDAY
    assert "keine Post" in ba.hindernis(e1, ba.sperrliste(), MONDAY)
    # Die Sperrliste hält weder Namen noch Anschrift im Klartext
    roh = json.dumps(ba._sperren().alle(), default=str)
    assert "Haarwerk" not in roh and "Schönhauser" not in roh and "10439" not in roh
    # Sie überlebt Löschen und Neuimport, auch bei anders geschriebener Straße oder nur gleicher Place-ID
    ba.sperren(store.hole("e2"), "Brief", MONDAY)
    store.loesche("e2")
    gleich = eintrag("e3", "Kamm & Co", street="Hauptstr. 1", postalCode="13403")
    assert "keine Post" in ba.hindernis(gleich, ba.sperrliste(), MONDAY)
    umgezogen = eintrag("e4", "Kamm", street="Andere Straße 5", postalCode="13403", googlePlaceId="ChIJkamm1234567")
    assert "keine Post" in ba.hindernis(umgezogen, ba.sperrliste(), MONDAY)
    anderer = eintrag("e5", "Kamm", street="Hauptstraße 10", postalCode="13403")
    assert ba.hindernis(anderer, ba.sperrliste(), MONDAY) == ""
    # Aufheben nimmt beides zurück
    ba.aufheben(store.hole("e1"))
    assert not store.hole("e1").get("postSperre") and ba.hindernis(store.hole("e1"), ba.sperrliste(), MONDAY) == ""


def test_entfernen_sperrt_auch_die_post():
    store, _ = frisch([eintrag("e1", "Haarwerk")])
    ent.offline_nehmen(store.hole("e1"), store, MONDAY)
    neu = eintrag("e2", "Haarwerk", status="online")
    assert "keine Post" in ba.hindernis(neu, ba.sperrliste(), MONDAY)


def test_unzustellbar_bis_zur_neuen_anschrift():
    store, _ = frisch([eintrag("e1", "Haarwerk")])
    ba.unzustellbar(store.hole("e1"), True, MONDAY)
    assert "Anschrift prüfen" in ba.hindernis(store.hole("e1"), ba.sperrliste(), MONDAY)
    store.aendere("e1", {"street": "Schönhauser Allee 82"})
    assert ba.hindernis(store.hole("e1"), ba.sperrliste(), MONDAY) == ""
    ba.unzustellbar(store.hole("e1"), True, MONDAY)
    ba.unzustellbar(store.hole("e1"), False, MONDAY)
    assert ba.hindernis(store.hole("e1"), ba.sperrliste(), MONDAY) == ""


def test_regeln():
    store, _ = frisch([eintrag("e1", "Haarwerk")])
    e = store.hole("e1")
    assert "Veröffentliche" in ba.hindernis({**e, "status": "entwurf"}, set(), MONDAY)
    assert "Anschrift" in ba.hindernis({**e, "postalCode": ""}, set(), MONDAY)
    assert "Dranzeit-Laden" in ba.hindernis({**e, "shopId": "s1"}, set(), MONDAY)


def test_betreiber_sperrt_und_markiert():
    store, _ = frisch([eintrag("e1", "Haarwerk")])
    c = admin_client()
    r = c.post("/routes/betreiber/verzeichnis/e1/keine-post", json={"grund": "Anruf"})
    assert r.status_code == 200 and store.hole("e1")["postSperre"]["grund"] == "Anruf"
    assert protokoll.read(1)[0]["action"] == "Verzeichnis: keine Post"
    assert c.post("/routes/betreiber/verzeichnis/e1/keine-post", json={"grund": "Quatsch"}).status_code == 400
    zeile = next(z for z in c.get("/routes/betreiber/verzeichnis").json()["eintraege"] if z["id"] == "e1")
    assert zeile["postSperre"]["grund"] == "Anruf"
    # Einzelbrief gibt es dann auch nicht mehr
    code = c.post("/routes/betreiber/verzeichnis/e1/code").json()["code"]
    r = c.post("/routes/betreiber/verzeichnis/e1/brief", json={"code": code})
    assert r.status_code == 409 and "keine Post" in r.json()["detail"]
    assert c.post("/routes/betreiber/verzeichnis/e1/keine-post/aufheben").status_code == 200
    assert not store.hole("e1").get("postSperre")
    assert protokoll.read(1)[0]["action"] == "Verzeichnis: keine Post aufgehoben"
    r = c.post("/routes/betreiber/verzeichnis/e1/unzustellbar", json={"unzustellbar": True})
    assert r.status_code == 200 and store.hole("e1")["unzustellbar"]["am"]
    zeile = next(z for z in c.get("/routes/betreiber/verzeichnis").json()["eintraege"] if z["id"] == "e1")
    assert zeile["unzustellbar"] is True
    assert protokoll.read(1)[0]["action"] == "Verzeichnis: unzustellbar"


def test_keine_post_auf_der_salonseite():
    store, mails = frisch([eintrag("e1", "Haarwerk"), eintrag("e2", "Laden-Seite", shopId="s1")])
    c = public_client()
    seite = c.get("/friseur/berlin/haarwerk").text
    assert 'action="/routes/verzeichnis/e1/keine-post"' in seite and "Keine Post mehr" in seite
    r = c.post("/routes/verzeichnis/e1/keine-post", content="", headers=FORM)
    assert r.status_code == 200 and "keine Post" in r.text
    assert store.hole("e1")["postSperre"]["grund"] == "Salonseite" and store.hole("e1")["status"] == "online"
    assert [m[0] for m in mails] == ["betreiber@example.com"] and "Keine Post" in mails[0][1]
    # Noch einmal geklickt: dieselbe Antwort, keine zweite Mail
    assert c.post("/routes/verzeichnis/e1/keine-post", content="", headers=FORM).status_code == 200 and len(mails) == 1
    # Seiten echter Läden haben den Link nicht und nehmen keine Sperre an
    assert c.post("/routes/verzeichnis/e2/keine-post", content="", headers=FORM).status_code == 404
    # Grenze je IP und Tag: fünf Sperren, dann nicht mehr
    for nr in range(3, 13):
        store.neu(eintrag(f"e{nr}", f"Salon {nr}", street=f"Teststraße {nr}"), f"e{nr}")
    codes = [c.post(f"/routes/verzeichnis/e{nr}/keine-post", content="", headers=FORM).status_code for nr in range(3, 13)]
    assert codes == [200] * 4 + [429] * 6


# --- Einstellungen, Wellen, Sammel-PDF -------------------------------------------------------------------------------


def salons(n, **extra):
    """n Salons mit eigener Anschrift, absichtlich nicht nach PLZ sortiert"""
    return [eintrag(f"e{i}", f"Salon {i}", street=f"Teststraße {i}", postalCode=f"1{(7 * i) % 10}4{i:02d}", **extra) for i in range(1, n + 1)]


def mitschneiden():
    """brief.serie ersetzen: zeigt, welche Salons mit welchem Code in welcher Reihenfolge im PDF landen"""
    seiten_im_pdf = []
    echt = ba.brief.serie

    def serie(items, art, basis, plaetze_frei, heute):
        seiten_im_pdf.extend((e["id"], code, art) for e, code, _ in items)
        return echt(items, art, basis, plaetze_frei, heute)

    ba.brief.serie = serie
    return seiten_im_pdf, lambda: setattr(ba.brief, "serie", echt)


def test_einstellungen():
    frisch()
    assert ba.einstellungen() == {"proWelle": 200, "proMonat": 300.0, "preis": 0.77}
    assert ba.einstellungen_speichern({"proWelle": 50, "proMonat": 100, "preis": 0.95}) == {"proWelle": 50, "proMonat": 100.0, "preis": 0.95}
    assert ba.einstellungen()["proWelle"] == 50
    for falsch in ({"proWelle": 0}, {"proWelle": 5000}, {"preis": -1}, {"proMonat": "viel"}):
        try:
            ba.einstellungen_speichern({**ba.einstellungen(), **falsch})
        except ValueError:
            continue
        raise AssertionError(f"angenommen: {falsch}")
    c = admin_client()
    r = c.post("/routes/betreiber/briefe/einstellungen", json={"proWelle": 2, "proMonat": 10, "preis": 1.5})
    assert r.status_code == 200 and ba.einstellungen() == {"proWelle": 2, "proMonat": 10.0, "preis": 1.5}
    zeile = protokoll.read(1)[0]
    assert zeile["action"] == "Briefe: Einstellungen geändert" and zeile["before"]["proWelle"] == 50 and zeile["after"]["proWelle"] == 2
    assert c.post("/routes/betreiber/briefe/einstellungen", json={"proWelle": 0, "proMonat": 10, "preis": 1}).status_code == 400


def test_welle_sammel_pdf():
    store, _ = frisch(salons(4) + [eintrag("x1", "Gesperrt", street="Weg 1", postSperre={"am": MONDAY, "grund": "Anruf"})])
    seiten_im_pdf, zurueck = mitschneiden()
    try:
        welle, pdf = ba.welle_erzeugen(["e1", "e2", "e3", "e4"], "brief", "https://dranzeit.de", 84, MONDAY)
    finally:
        zurueck()
    assert pdf.startswith(b"%PDF") and b"/Count 4" in pdf
    # Nach PLZ sortiert, jede Seite mit eigenem, einlösbarem Code
    plz = [store.hole(i)["postalCode"] for i, _, _ in seiten_im_pdf]
    assert plz == sorted(plz) and len({c for _, c, _ in seiten_im_pdf}) == 4
    for eid, code, art in seiten_im_pdf:
        assert ba.ue.pruefen(code, store, MONDAY)["id"] == eid and art == "brief"
        assert store.hole(eid)["uebernahme"]["welle"] == welle["id"]
        assert store.hole(eid)["post"] == [{"welle": welle["id"], "art": "brief", "am": MONDAY, "status": "erzeugt"}]
    gespeichert = ba._wellen().hole(welle["id"])
    assert gespeichert["status"] == "erzeugt" and gespeichert["anzahl"] == 4 and gespeichert["kosten"] == 3.08
    # Kein Code im Klartext in der Datenbank oder im Protokoll
    roh = json.dumps([store.alle(), ba._wellen().alle(), ba._sperren().alle(), protokoll.read(50)], default=str)
    for _, code, _ in seiten_im_pdf:
        assert code not in roh and code.replace("-", "") not in roh
    # Solange die Welle nicht hochgeladen ist, kommt niemand daraus in eine zweite
    assert "noch nicht hochgeladen" in ba.grund_fuer(store.hole("e1"), ba.sperrliste(), MONDAY, "brief")
    # Gesperrte, schon angeschriebene oder unbekannte Salons machen die ganze Welle ungültig
    for ids in (["x1"], ["e1"], ["nix"]):
        try:
            ba.welle_erzeugen(ids, "brief", "https://dranzeit.de", 84, MONDAY)
        except ValueError:
            continue
        raise AssertionError(f"Welle mit {ids} erzeugt")


def test_welle_hochladen_und_verwerfen():
    store, _ = frisch(salons(3))
    alt = ba.ue.code_erzeugen(store.hole("e3"), store, MONDAY - timedelta(days=40))["code"]  # Einzelbrief von früher
    seiten_im_pdf, zurueck = mitschneiden()
    try:
        w1, _ = ba.welle_erzeugen(["e1", "e2"], "brief", "https://dranzeit.de", 84, MONDAY)
        w2, _ = ba.welle_erzeugen(["e3"], "brief", "https://dranzeit.de", 84, MONDAY)
    finally:
        zurueck()
    later = MONDAY + timedelta(hours=2)
    ba.hochgeladen(w1["id"], later)
    assert ba._wellen().hole(w1["id"])["status"] == "verschickt" and ba._wellen().hole(w1["id"])["verschicktAm"] == later
    assert store.hole("e1")["post"][0]["status"] == "verschickt" and store.hole("e1")["post"][0]["verschicktAm"] == later
    try:
        ba.verwerfen(w1["id"], later)
        raise AssertionError("verschickte Welle verworfen")
    except ValueError:
        pass
    # Verwerfen: Codes der Welle ungültig, Salons wieder auswählbar, ein früherer Code gilt wieder
    code_w2 = next(c for eid, c, _ in seiten_im_pdf if eid == "e3")
    ba.verwerfen(w2["id"], later)
    assert ba._wellen().hole(w2["id"])["status"] == "verworfen" and not store.hole("e3").get("post")
    assert ba.grund_fuer(store.hole("e3"), ba.sperrliste(), later, "brief") == ""
    try:
        ba.ue.pruefen(code_w2, store, later)
        raise AssertionError("Code einer verworfenen Welle gilt noch")
    except ba.ue.Fehler:
        pass
    assert ba.ue.pruefen(alt, store, later)["id"] == "e3"


def test_welle_grenzen():
    store, _ = frisch(salons(5))
    ba.einstellungen_speichern({"proWelle": 3, "proMonat": 3.0, "preis": 0.77})
    for ids in (["e1", "e2", "e3", "e4"], ):  # mehr als je Welle erlaubt
        try:
            ba.welle_erzeugen(ids, "brief", "https://dranzeit.de", 84, MONDAY)
            raise AssertionError("Obergrenze je Welle nicht geprüft")
        except ValueError as e:
            assert "3 Briefe" in str(e)
    ba.welle_erzeugen(["e1", "e2", "e3"], "brief", "https://dranzeit.de", 84, MONDAY)  # 2,31 €
    try:
        ba.welle_erzeugen(["e4", "e5"], "brief", "https://dranzeit.de", 84, MONDAY)  # zusammen 3,85 € > 3 €
        raise AssertionError("Kostengrenze nicht geprüft")
    except ValueError as e:
        assert "3,00 €" in str(e)
    # Im nächsten Monat geht es wieder; verworfene Wellen zählen nicht
    ba.welle_erzeugen(["e4", "e5"], "brief", "https://dranzeit.de", 84, MONDAY + timedelta(days=30))


def test_welle_api():
    store, _ = frisch(salons(3) + [eintrag("s", "Laden", shopId="s1", street="Ladenweg 1")])
    c = admin_client()
    daten = c.get("/routes/betreiber/briefe").json()
    assert daten["einstellungen"]["proWelle"] == 200 and daten["monat"] == {"kosten": 0, "grenze": 300.0}
    zeilen = {z["id"]: z for z in daten["eintraege"]}
    assert set(zeilen) == {"e1", "e2", "e3"}  # Seiten echter Läden kommen gar nicht vor
    assert zeilen["e1"]["gruende"]["brief"] == "" and "noch keinen Brief" in zeilen["e1"]["gruende"]["erinnerung"]
    r = c.post("/routes/betreiber/briefe/welle", json={"art": "brief", "ids": ["e1", "e2"]})
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["cache-control"] == "private, no-store"
    assert r.headers["content-disposition"].startswith('attachment; filename="Dranzeit-Briefe-2026-11-') or "Dranzeit-Briefe" in r.headers["content-disposition"]
    welle_id = r.headers["x-welle"]
    assert protokoll.read(1)[0]["action"] == "Briefe: Welle erzeugt" and protokoll.read(1)[0]["after"]["anzahl"] == 2
    daten = c.get("/routes/betreiber/briefe").json()
    assert daten["wellen"][0]["id"] == welle_id and daten["wellen"][0]["status"] == "erzeugt" and daten["monat"]["kosten"] == 1.54
    assert c.post("/routes/betreiber/briefe/welle", json={"art": "brief", "ids": ["e1"]}).status_code == 409
    assert c.post("/routes/betreiber/briefe/welle", json={"art": "quatsch", "ids": ["e3"]}).status_code == 400
    assert c.post(f"/routes/betreiber/briefe/welle/{welle_id}/hochgeladen").status_code == 200
    assert protokoll.read(1)[0]["action"] == "Briefe: Welle hochgeladen"
    assert c.post(f"/routes/betreiber/briefe/welle/{welle_id}/verwerfen").status_code == 409
    assert c.post("/routes/betreiber/briefe/welle/nix/hochgeladen").status_code == 404


# --- Erinnerung und Auswertung ---------------------------------------------------------------------------------------


def welle_mit_codes(ids, art, now):
    seiten_im_pdf, zurueck = mitschneiden()
    try:
        w, _ = ba.welle_erzeugen(ids, art, "https://dranzeit.de", 84, now)
    finally:
        zurueck()
    ba.hochgeladen(w["id"], now)
    return w, {eid: code for eid, code, _ in seiten_im_pdf}


def test_erinnerung():
    store, _ = frisch(salons(2))
    w1, codes = welle_mit_codes(["e1", "e2"], "brief", MONDAY)
    assert "schon einen Brief" in ba.grund_fuer(store.hole("e1"), set(), MONDAY, "brief")
    assert ba.grund_fuer(store.hole("e1"), set(), MONDAY + timedelta(days=20), "erinnerung") == "Erinnerung ab 30.11.2026."
    ba.ue.einloesen(codes["e2"], "s2", store, MONDAY + timedelta(days=2))
    spaeter = MONDAY + timedelta(days=21)
    assert ba.grund_fuer(store.hole("e1"), set(), spaeter, "erinnerung") == ""
    assert "Dranzeit-Laden" in ba.grund_fuer(store.hole("e2"), set(), spaeter, "erinnerung")
    w2, neue = welle_mit_codes(["e1"], "erinnerung", spaeter)
    assert ba.ue.pruefen(neue["e1"], store, spaeter)["id"] == "e1"
    try:
        ba.ue.pruefen(codes["e1"], store, spaeter)
        raise AssertionError("Code aus dem ersten Brief gilt noch")
    except ba.ue.Fehler:
        pass
    # Danach nie wieder
    for art in ba.ARTEN:
        assert "zwei Briefe" in ba.grund_fuer(store.hole("e1"), set(), spaeter + timedelta(days=60), art)
    # Eigener, kürzerer Text; passt auch mit langem Namen aufs Blatt
    e = store.hole("e1")
    t = ba.brief.texte(e, "https://dranzeit.de", 84, "erinnerung")
    assert t["betreff"].startswith("Noch einmal:") and "ersten Brief gilt nicht mehr" in t["einstieg"] and not t["vorteile"]
    lang = {**e, "name": "Haarstudio und Barbershop am Schönhauser Tor bei Friseurmeisterin Musterfrau", "wuensche": 12}
    c = ba.brief.canvas.Canvas(ba.brief.io.BytesIO(), pagesize=ba.brief.A4)
    masse = ba.brief.zeichnen(c, lang, "ABCDE-FGHJK", spaeter, "https://dranzeit.de", 84, spaeter, "erinnerung")
    assert masse["text_vor_marke"] <= ba.brief.MARKE_MM - 1 and masse["text_unten"] < 277


def test_auswertung():
    store, _ = frisch(salons(5))
    w1, codes = welle_mit_codes(["e1", "e2", "e3", "e4"], "brief", MONDAY)
    ba.ue.einloesen(codes["e1"], "s1", store, MONDAY + timedelta(days=2))
    ba.unzustellbar(store.hole("e2"), True, MONDAY + timedelta(days=3))
    ba.sperren(store.hole("e3"), "Salonseite", MONDAY + timedelta(days=4))
    ent.offline_nehmen(store.hole("e4"), store, MONDAY + timedelta(days=5))
    # Ein Salon aus einer anderen Welle übernimmt über den Mail-Link: zählt nicht für den Brief
    w2, _ = welle_mit_codes(["e5"], "brief", MONDAY)
    mail_code = ba.ue.mail_code_erzeugen(store.hole("e5"), store, MONDAY + timedelta(days=1))
    ba.ue.einloesen(mail_code, "s5", store, MONDAY + timedelta(days=1))
    rows = {w["id"]: w for w in ba.wellen(store.alle())}
    assert rows[w1["id"]]["auswertung"] == {"uebernommen": 1, "unzustellbar": 1, "entfernt": 1, "keinePost": 1, "kostenJeUebernahme": 3.08}
    assert rows[w2["id"]]["auswertung"]["uebernommen"] == 0 and rows[w2["id"]]["auswertung"]["kostenJeUebernahme"] is None


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
