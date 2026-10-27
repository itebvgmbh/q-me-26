"""
Tests für app/seo.py: Stadtseiten und Sitemap. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_seo.py
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.seo as seo  # noqa: E402

SHOPS = [
    {"id": "a1", "name": "Barber Ali", "street": "Ring 1", "postalCode": "50667", "city": "Köln", "industry": "barbershop",
     "businessHoursByDay": [{"dayOfWeek": 1, "isOpen": True, "openTime": "09:00", "closeTime": "19:00"}]},
    {"id": "b2", "name": "Salon <Eva>", "street": "Weg 2", "postalCode": "50668", "city": "Köln", "industry": "barbershop"},
    {"id": "c3", "name": "Schnitt", "city": "Düsseldorf", "industry": ""},
]
MONDAY = datetime(2026, 10, 19, 10, 0, tzinfo=timezone.utc)


def test_slug():
    assert seo.slugify("Köln") == "koeln"
    assert seo.slugify(" Frankfurt am Main ") == "frankfurt-am-main"
    assert seo.slugify("Weißenfels") == "weissenfels"


def test_staedte_gruppiert():
    c = seo.cities(SHOPS)
    assert list(c) == ["duesseldorf", "koeln"]
    assert len(c["koeln"]["shops"]) == 2


def test_stadtseite_inhalt_und_strukturierte_daten():
    page = seo.render_city("Köln", "koeln", SHOPS[:2], {"a1": 3}, now=MONDAY)
    assert "<h1>Friseur ohne Termin in Köln</h1>" in page
    assert "3 Personen warten" in page and "Gerade wartet niemand" in page
    assert "Heute 09:00–19:00 Uhr" in page
    assert "/public-join-queue?shopId=a1" in page
    assert "Salon &lt;Eva&gt;" in page and "<Eva>" not in page.split("application/ld+json")[0]
    ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page).group(1).replace("<\\/", "</"))
    assert ld["itemListElement"][0]["item"]["@type"] == "HairSalon"
    assert ld["itemListElement"][0]["item"]["address"]["postalCode"] == "50667"


def test_app_aus_dem_store_ohne_verkauf():
    # Erkennung wie frontend/src/utils/app-shell.ts: In der App verschwindet "30 Tage kostenlos testen" (/preise)
    page = seo.render_city("Köln", "koeln", SHOPS[:1], {}, now=MONDAY)
    assert f"<script>{seo.APP_JS}</script>" in page.split("</head>")[0]
    assert 'href="/preise"' in page and '.in-app a[href^="/preise"]' in page and '.in-app a[href^="/tarif"]' in page
    assert "(tarife|abo|gruenderangebot)" in seo.APP_JS


def test_routen_alias_404_und_sitemap():
    seo.load_shops = lambda: SHOPS
    seo.waiting_now = lambda shop_id, now=None: 1
    app = FastAPI()
    app.include_router(seo.router)
    c = TestClient(app)
    assert c.get("/friseur-ohne-termin/koeln").status_code == 200
    assert "1 Person wartet" in c.get("/friseur-ohne-termin/koeln").text
    assert c.get("/friseur-ohne-termin/gibtsnicht").status_code == 404
    r = c.get("/barbershop-ohne-termin/koeln", follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == "/friseur-ohne-termin/koeln"
    xml = c.get("/sitemap.xml").text
    assert "/friseur-ohne-termin/koeln</loc>" in xml and "shopId=c3" in xml
    assert "<lastmod>" not in xml  # jeden Tag "heute" wäre unzuverlässig
    page = c.get("/friseur-ohne-termin/koeln").text
    assert 'property="og:image" content="https://dranzeit.de/og-bild.png"' in page and "summary_large_image" in page


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
