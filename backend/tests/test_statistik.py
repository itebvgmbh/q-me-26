"""
Tests für Google Analytics 4 mit Einwilligung (frontend/public/statistik.js, Banner in app/seo.py). Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_statistik.py
"""
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.einbau as einbau  # noqa: E402
import app.seo as seo  # noqa: E402

WURZEL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKRIPT = open(os.path.join(WURZEL, "frontend", "public", "statistik.js"), encoding="utf-8").read()
INDEX = open(os.path.join(WURZEL, "frontend", "index.html"), encoding="utf-8").read()
MESS_ID = "G-RG8P11CJNJ"


def _code(js: str) -> str:
    """Ohne Kommentare – die erklären auch, was es bewusst nicht gibt"""
    return re.sub(r"/\*.*?\*/|(?<![:'])//[^\n]*", "", js, flags=re.S)


def test_nur_die_eigene_mess_id():
    code = _code(SKRIPT)
    assert f"'{MESS_ID}'" in code
    # Kein Google-Ads-Tag, keine fremde Property, kein Meta-Pixel
    assert re.findall(r"\b(?:G|AW|GT|UA)-[A-Z0-9-]+", code) == [MESS_ID]
    assert "fbq" not in code and "facebook" not in code.lower()


def test_consent_default_alles_denied_vor_dem_laden():
    code = _code(SKRIPT)
    default = re.search(r"gtag\('consent', 'default', \{(.*?)\}\)", code, re.S)
    assert default, "Consent-Default fehlt"
    for signal in ("analytics_storage", "ad_storage", "ad_user_data", "ad_personalization"):
        assert re.search(rf"{signal}: 'denied'", default.group(1)), signal
    # Die Grundeinstellung steht vor allem, was config schickt oder gtag.js lädt
    assert default.start() < code.index("googletagmanager.com/gtag/js") and default.start() < code.index("gtag('config'")
    # Werbe-Signale werden nie erteilt, nur analytics_storage
    assert not re.search(r"ad_\w+: '?granted", code)


def test_ohne_einwilligung_kein_laden():
    code = _code(SKRIPT)
    # gtag.js lädt nur über starten(), und das nur mit gespeicherter oder gerade erteilter Einwilligung
    assert code.count("laden()") >= 1 and "if (gestartet || aus) return;" in code
    assert "var erteilt = !aus && wahl() === 'alle';" in code
    assert "if (erteilt) {" in code and "if (erteilt) starten(true);" in code
    # Nie auf dem Wartezimmer-Bildschirm und nie in der App aus dem Store
    assert "/bildschirm/" in code and "DranzeitApp" in code and "android-app://de.dranzeit.app" in code


def test_react_app_bindet_statistik_ein():
    assert '<script src="/statistik.js" defer></script>' in INDEX
    assert "googletagmanager" not in INDEX  # nur über statistik.js


def test_seiten_vom_backend_mit_tag_und_banner():
    page = seo.render_index({})
    assert seo.STATISTIK_KOPF in page and page.index(seo.STATISTIK_KOPF) < page.index("</head>")
    assert 'id="cookies"' in page and "Alle akzeptieren" in page and "Nur notwendige" in page
    assert 'id="cookie-einstellungen"' in page
    # Banner verborgen, bis statistik.js sagt, dass gefragt werden muss (kein Aufblitzen in der App)
    assert re.search(r'<section class="cookies" id="cookies"[^>]* hidden>', page)


def test_kasten_fuer_fremde_seiten_ohne_tag_und_banner():
    jetzt = datetime(2026, 10, 19, 10, 0, tzinfo=timezone.utc)
    laden = {"id": "abc123", "name": "Salon", "trialEndsAt": jetzt + timedelta(days=10)}
    for page in (einbau.render_box(laden, 2, jetzt), einbau.render_missing()):
        assert "statistik.js" not in page and "googletagmanager" not in page and 'id="cookies"' not in page


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
    print(f"{len(tests)} Tests bestanden.")
