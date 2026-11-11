"""
Tests für die Kopfzeile der Backend-Seiten (app/kopfzeile.py): dieselben Menüpunkte wie in der App
(frontend/src/navigation.json), richtiger Punkt hervorgehoben, Hilfe und Salonseiten haben sie. Ohne Datenbank lauffähig:

    cd backend && .venv/bin/python tests/test_kopfzeile.py
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import hilfe, kopfzeile, seo  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def test_menueliste_aus_dem_frontend():
    m = kopfzeile.menue()
    assert m is not kopfzeile.NOTFALL, "frontend/src/navigation.json fehlt oder ist kaputt"
    assert set(m["links"]) == {"guest", "customer", "shopOwner", "employee", "tresen"}
    for rolle, punkte in m["links"].items():
        assert punkte, rolle
        for p in punkte:
            assert p["to"].startswith("/") and p["label"], (rolle, p)
    # Die App liest dieselbe Datei
    assert "from '../navigation.json'" in (ROOT / "frontend/src/components/Navigation.tsx").read_text(encoding="utf-8")


def test_gaestemenue_im_html_mit_hervorhebung():
    h = kopfzeile.kopfzeile("/hilfe/plakat")
    for p in kopfzeile.menue()["links"]["guest"]:
        assert f'href="{p["to"]}"' in h, p
    assert re.search(r'<a href="/hilfe" class="kz-xl kz-an" aria-current="page">Hilfe</a>', h)
    assert 'href="/login"' in h and 'href="/register-options"' in h
    # Im Menü zum Aufklappen stehen alle Punkte, auch die erst ab 1280 px in der Zeile
    liste = h.split('class="kz-liste"')[1].split("</nav>")[0]
    assert 'href="/preise"' in liste and "kz-xl" not in liste


def test_laeden_finden_auf_salonseiten_hervorgehoben():
    h = kopfzeile.kopfzeile("/friseur/berlin/salon-x")
    assert '<a href="/shop-map" class="kz-an" aria-current="page">Läden finden</a>' in h
    assert "kz-an" not in kopfzeile.kopfzeile("/impressum").split("</nav>")[0]


def test_skript_bekommt_rollenmenues_sicher_eingebettet():
    h = kopfzeile.kopfzeile("/hilfe")
    skript = h.split("<script>")[1].split("</script>")[0]
    assert "__MENUE__" not in skript and "</" not in skript
    daten = json.loads(re.search(r"var M=(\{.*?\});\nfunction zu", skript, re.S).group(1).replace("<\\/", "</"))
    assert daten["links"]["shopOwner"][0]["to"] == "/shop-dashboard"
    assert daten["profil"]["customer"] == "/customer-profile"
    assert "dranzeit.konto" in skript and "dranzeit.rolle" in skript


def test_hilfe_und_stadtseite_haben_die_kopfzeile():
    seo.load_shops = lambda: []
    app = FastAPI()
    app.include_router(hilfe.router)
    app.include_router(seo.router)
    c = TestClient(app)
    for pfad in ("/hilfe", f"/hilfe/{hilfe.START}", "/friseur-ohne-termin"):
        r = c.get(pfad)
        assert r.status_code == 200, pfad
        assert 'id="kopfzeile"' in r.text and 'class="top"' not in r.text, pfad
        assert "/schrift/dm-sans-latin-opsz.woff2" in r.text, pfad
    assert 'class="kz-xl kz-an" aria-current="page">Hilfe</a>' in c.get("/hilfe").text


def test_schriften_liegen_im_frontend():
    for datei in ("dm-sans-latin-opsz.woff2", "bricolage-grotesque-latin-opsz.woff2"):
        assert (ROOT / "frontend/public/schrift" / datei).stat().st_size > 10_000, datei


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
