"""
Tests für app/libs/privacy.py: Welche alten Termine werden anonymisiert? Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_privacy.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.libs.privacy import ANONYMIZED_NAME, fields_to_clear  # noqa: E402


def test_wartenummer_ohne_konto_verliert_name_und_telefon():
    update = fields_to_clear({"isAnonymous": True, "customerName": "Ali", "customerPhone": "0151 123"})
    assert update == {"customerName": ANONYMIZED_NAME, "customerPhone": None}


def test_laufkunde_vom_tresen_wird_anonymisiert():
    update = fields_to_clear({"customerId": "walk-in", "customerName": "Herr Meier"})
    assert update == {"customerName": ANONYMIZED_NAME}


def test_kunde_mit_konto_bleibt_unveraendert():
    assert fields_to_clear({"customerId": "uid123", "customerName": "Eva", "customerPhone": "0170"}) == {}


def test_schon_anonymisiert_wird_nicht_erneut_geschrieben():
    assert fields_to_clear({"isAnonymous": True, "customerName": "Ali", "anonymizedAt": "2026-01-01"}) == {}


def test_benachrichtigungs_email_wird_entfernt():
    update = fields_to_clear({"isAnonymous": True, "customerName": ANONYMIZED_NAME, "notifyEmail": "a@b.de"})
    assert update == {"notifyEmail": None}


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
