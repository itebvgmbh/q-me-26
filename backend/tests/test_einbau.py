"""
Tests für app/einbau.py: Kasten für Webseiten der Läden und QR-Code als Bild. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_einbau.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.einbau as einbau  # noqa: E402
import app.seo as seo  # noqa: E402

# Montag, 19.10.2026, 12:00 Uhr deutscher Zeit
MONDAY_NOON = datetime(2026, 10, 19, 10, 0, tzinfo=timezone.utc)
HOURS = [{"dayOfWeek": 1, "isOpen": True, "openTime": "09:00", "closeTime": "18:00", "breaks": [{"startTime": "13:00", "endTime": "14:00"}]},
         {"dayOfWeek": 0, "isOpen": False}]
# In der Testphase gilt der höchste Tarif, also mit Terminen; danach ohne Abo der Gratis-Tarif ohne Termine
TRIAL = {"id": "abc123", "name": "Salon <Eva>", "businessHoursByDay": HOURS, "trialEndsAt": MONDAY_NOON + timedelta(days=10)}
GRATIS = {**TRIAL, "trialEndsAt": MONDAY_NOON - timedelta(days=1)}


def at(hour: int, minute: int = 0) -> datetime:
    return MONDAY_NOON.replace(hour=hour - 2, minute=minute)  # Oktober: Sommerzeit, UTC+2


def test_oeffnungszeiten():
    assert einbau.opening_status(TRIAL, at(8)) == ("Heute ab 09:00 Uhr geöffnet", False)
    assert einbau.opening_status(TRIAL, at(12)) == ("Geöffnet bis 18:00 Uhr", True)
    assert einbau.opening_status(TRIAL, at(13, 30)) == ("Pause bis 14:00 Uhr", False)
    assert einbau.opening_status(TRIAL, at(18)) == ("Für heute geschlossen", False)
    assert einbau.opening_status(TRIAL, MONDAY_NOON - timedelta(days=1)) == ("Heute geschlossen", False)
    assert einbau.opening_status({"id": "x"}, MONDAY_NOON) == ("", False)


def test_kasten_offen_mit_terminen():
    page = einbau.render_box(TRIAL, 3, MONDAY_NOON)
    assert "Salon &lt;Eva&gt;" in page and "<Eva>" not in page
    assert "Geöffnet bis 18:00 Uhr" in page and "Gerade warten 3 Personen" in page
    assert 'href="/public-join-queue?shopId=abc123" target="_blank"' in page
    assert 'href="/book-appointment?shopId=abc123&amp;fromMarketplace=true"' in page
    assert "<svg" in page and "Mit dem Handy scannen" in page
    assert 'name="robots" content="noindex"' in page
    assert "location.replace" in page  # neu laden ohne Verlaufseintrag


def test_kasten_gratis_ohne_termine_geschlossen_ohne_zahl():
    page = einbau.render_box(GRATIS, 2, at(19))
    assert "Termin buchen" not in page
    assert "Nummer ziehen" in page
    assert "Für heute geschlossen" in page and "warten" not in page
    assert "Gerade wartet" not in einbau.render_box(TRIAL, None, MONDAY_NOON)
    assert "Gerade wartet 1 Person" in einbau.render_box(TRIAL, 1, MONDAY_NOON)


def test_kasten_gesperrt():
    page = einbau.render_box({**TRIAL, "suspended": {"at": MONDAY_NOON}}, 3, MONDAY_NOON)
    assert "gerade keine Nummern und Termine" in page
    assert "public-join-queue" not in page and "Termin buchen" not in page


def _client():
    shops = {"abc123": TRIAL}
    einbau.load_shop = lambda shop_id: shops.get(shop_id)
    seo.waiting_now = lambda shop_id, now=None: 0
    app = FastAPI()
    app.include_router(einbau.router)
    app.include_router(einbau.router, prefix="/routes/seo")
    return TestClient(app)


def test_routen():
    c = _client()
    r = c.get("/einbau/abc123")
    assert r.status_code == 200 and "Salon &lt;Eva&gt;" in r.text
    assert c.get("/routes/seo/einbau/abc123").status_code == 200
    assert c.get("/einbau/gibtsnicht").status_code == 404
    svg = c.get("/einbau/abc123/qr.svg")
    assert svg.status_code == 200 and svg.headers["content-type"].startswith("image/svg+xml")
    assert 'filename="dranzeit-qr-salon-eva.svg"' in svg.headers["content-disposition"]
    png = c.get("/einbau/abc123/qr.png")
    assert png.status_code == 200 and png.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert c.get("/einbau/gibtsnicht/qr.png").status_code == 404


def test_ladennummer_nur_erlaubte_zeichen():
    # Schrägstriche & Co. kommen gar nicht erst bis Firestore
    assert einbau.SHOP_ID.match("zNS505OFvKZpFaR1vTdN")
    assert not einbau.SHOP_ID.match("a/b") and not einbau.SHOP_ID.match("..") and not einbau.SHOP_ID.match("")


def test_qr_fuehrt_zum_nummer_ziehen():
    assert einbau.qr("abc123").designator  # lässt sich erzeugen
    assert einbau.join_path("abc123") == "/public-join-queue?shopId=abc123"


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
    print(f"{len(tests)} Tests bestanden.")
