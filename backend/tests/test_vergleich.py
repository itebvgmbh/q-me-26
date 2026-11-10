"""
Tests für app/vergleich.py: Die alte Vergleichsseite leitet dauerhaft nach salonlotse.de weiter. Ohne Datenbank lauffähig:

    cd backend && .venv/bin/python tests/test_vergleich.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.seo as seo  # noqa: E402
import app.vergleich as v  # noqa: E402


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(v.router)
    app.include_router(v.router, prefix="/routes/seo")
    return TestClient(app)


def test_alte_adressen_leiten_nach_salonlotse():
    c = _client()
    for pfad in ("/vergleich", "/vergleich/", "/vergleich/buchungsplattformen-friseure", "/routes/seo/vergleich/buchungsplattformen-friseure"):
        r = c.get(pfad, follow_redirects=False)
        assert r.status_code == 301, pfad
        assert r.headers["location"] == "https://salonlotse.de/", pfad
    assert c.head("/vergleich/buchungsplattformen-friseure", follow_redirects=False).status_code == 301


def test_dranzeit_verlinkt_den_vergleich_nicht_mehr():
    seite = seo._page("Titel", "Beschreibung", "/x", "<p>x</p>", [])
    assert "/vergleich" not in seite and "Anbieter im Vergleich" not in seite
    assert 'href="/rechner"' in seite
    assert '.in-app a[href^="/rechner"]' in seite  # in der Store-App wird nichts verkauft


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
