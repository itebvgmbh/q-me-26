"""
Tests für app/vergleich.py: Reihenfolge, Kostenrechner, Quellen und Pflichtangaben. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_vergleich.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.seo as seo  # noqa: E402
import app.vergleich as v  # noqa: E402
from app.libs.plans import PLANS  # noqa: E402

ANBIETER = v.ANBIETER


def test_reihenfolge_wird_gerechnet():
    assert v.reihenfolge()[0] == "dranzeit"
    assert [v.gesamt(s) for s in v.reihenfolge()] == sorted((v.gesamt(s) for s in ANBIETER), reverse=True)
    assert sum(k[2] for k in v.KRITERIEN) == 100
    for s in ANBIETER:
        p = v.punkte(s)
        assert set(p) == {k[0] for k in v.KRITERIEN}
        for schluessel, _, maximum, _ in v.KRITERIEN:
            assert 0 <= p[schluessel] <= maximum, (s, schluessel)


def test_aussagen_im_text_stimmen_mit_den_punkten():
    # "Ohne diese 30 Punkte liegt im Raster Fresha vorn und Dranzeit im Mittelfeld" (GRENZEN)
    ohne = sorted(ANBIETER, key=lambda s: v.gesamt(s) - v.punkte(s)["laufkundschaft"], reverse=True)
    assert ohne[0] == "fresha" and ohne[0] != "dranzeit"
    assert 2 <= ohne.index("dranzeit") <= 4
    # Bei den Extras verliert Dranzeit, das steht offen auf der Seite
    assert v.punkte("dranzeit")["extras"] == 0


def test_dranzeit_preise_wie_tarife():
    stufen = ANBIETER["dranzeit"]["preis"]["stufen"]
    assert stufen == [[PLANS["solo"]["max_staff"], PLANS["solo"]["monthly"]], [PLANS["laden"]["max_staff"], PLANS["laden"]["monthly"]],
                      [PLANS["team"]["max_staff"], PLANS["team"]["monthly"]]]
    assert PLANS["gratis"]["monthly"] == 0 and PLANS["gratis"]["max_customers_per_month"] == 100
    assert v.grundpreis(ANBIETER["dranzeit"], 1) == 19 and v.grundpreis(ANBIETER["dranzeit"], 2) == 39
    assert v.grundpreis(ANBIETER["dranzeit"], 5) == 59


def test_kostenrechner():
    t = v.monatskosten(ANBIETER["treatwell"], 4, 8, 35)
    assert t == {"grund": 39, "provision": 98.0, "summe": 137.0}
    assert v.monatskosten(ANBIETER["fresha"], 4, 8, 35) == {"grund": 35.8, "provision": 0, "summe": 35.8}
    assert v.grundpreis(ANBIETER["fresha"], 1) == 12.95
    mindest = {"preis": {"fest": 10}, "provision": {"satz": 0.2, "min": 6}}
    assert v.monatskosten(mindest, 1, 2, 15)["provision"] == 12
    assert v.grundpreis(ANBIETER["shore"], 5) == 59.90 and v.grundpreis(ANBIETER["shore"], 6) == 79.90
    assert v.grundpreis(ANBIETER["booksy"], 3) == 49
    assert v.monatskosten(ANBIETER["dranzeit"], 4, 40, 120)["provision"] == 0


def test_betraege():
    assert v.eur(39) == "39 €" and v.eur(59.9) == "59,90 €" and v.eur(1176) == "1.176 €" and v.eur(1234.5) == "1.234,50 €"


def test_alle_angaben_mit_quelle_und_vollstaendig():
    genutzt = set()
    for _, reihen in v.TABELLE:
        for name, zellen in reihen:
            assert set(zellen) == set(ANBIETER), name
            genutzt |= set(re.findall(r'href="#q-([a-z-]+)"', "".join(zellen.values())))
    for d in v.DETAILS.values():
        genutzt |= set(re.findall(r'href="#q-([a-z-]+)"', "".join(z for _, z in d["zeilen"])))
    assert set(v.DETAILS) == set(ANBIETER)
    assert genutzt <= set(v.QUELLE_NR)
    # Jede fremde Quelle ist eine echte Adresse und wird auch benutzt (studiolution steht zusätzlich im Rechner)
    assert {s for s, _, _ in v.QUELLEN} == genutzt | {"planity-studiolution"}


def test_seite_kennzeichnet_absender_und_keine_siegerwoerter():
    page = v.render_seite()
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    assert "Dieser Vergleich kommt von Dranzeit, einem der verglichenen Anbieter" in text
    assert "ITEBV GmbH" in text and "hilfe@dranzeit.de" in text
    for wort in ("testsieger", "testurteil", "unabhängiger", "marktführer", "stiftung warentest"):
        assert wort not in text.lower(), wort
    assert "Das heißt nicht, dass es das nicht gibt" in text
    assert re.search(rf"Stand\s+{re.escape(v.STAND)}", text)


def test_seo_grundlagen():
    page = v.render_seite()
    assert 'href="https://dranzeit.de/vergleich/buchungsplattformen-friseure"' in page
    assert len(v.TITEL) <= 70 and len(v.BESCHREIBUNG) <= 165
    assert page.count("<h1") == 1 + seo.STYLE.count("<h1")
    assert 'content="https://dranzeit.de/og-vergleich.png"' in page
    assert "noindex" not in page
    for wort in ("Friseursoftware", "Salonsoftware", "Buchungssystem", "Treatwell-Alternative", "Barbershop", "Aufrufsystem"):
        assert wort in page, wort
    for s in ANBIETER:
        assert f'id="{s}"' in page
    bloecke = [json.loads(b.replace("<\\/", "</")) for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, flags=re.S)]
    typen = {b["@type"] for b in bloecke}
    assert {"Article", "BreadcrumbList", "ItemList", "FAQPage", "SoftwareApplication"} <= typen
    faq = next(b for b in bloecke if b["@type"] == "FAQPage")
    assert len(faq["mainEntity"]) == len(v.FAQ)
    # Eigene Bewertungen als Sterne wären irreführend und von Google nicht erlaubt
    assert not re.search(r"aggregateRating|\"Review\"", json.dumps(bloecke))
    # Der Rechner steht auch ohne JavaScript da und sortiert nach Preis, auch wenn Dranzeit dabei nicht vorn liegt
    balken = re.search(r'id="balken">(.*?)</ol>', page, flags=re.S).group(1)
    assert re.findall(r'data-id="([a-z]+)"', balken)[:2] == ["fresha", "dranzeit"]
    assert "Bei dieser Einstellung ist Fresha 3,20 € im Monat günstiger." in page
    # Fremde Links geben keine Empfehlung weiter, keine fremden Skripte (nur das eigene /statistik.js, tests/test_statistik.py)
    assert 'rel="nofollow noopener" target="_blank"' in page and not re.search(r'<script[^>]+src="(?!/statistik\.js")', page)


def test_routen_sitemap_und_app_aus_dem_store():
    seo.load_shops = lambda: []
    seo._verzeichnis_pfade = lambda: {}
    app = FastAPI()
    app.include_router(v.router)
    app.include_router(seo.router)
    c = TestClient(app)
    assert c.get(v.PFAD).status_code == 200
    r = c.get(v.BASE_PATH, follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == v.PFAD
    assert f"{v.PFAD}</loc>" in c.get("/sitemap.xml").text
    # In der App aus dem Store wird nichts verkauft
    assert '.in-app a[href^="/vergleich"]' in v.render_seite() and "location.replace('/features')" in v.render_seite()


if __name__ == "__main__":
    tests = [w for k, w in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
