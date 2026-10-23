"""
Tests für „Passwort vergessen“ (/passwort-neu) und das Aussehen der Dranzeit-Mails. Ohne Firebase und Resend
lauffähig (beides nachgebildet):

    cd backend && .venv/bin/python tests/test_password_reset.py
"""
import os
import sys
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FIREBASE_LINK = "https://qmedata-7c79e.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=Re-9_z%2Fq%3D&apiKey=k&lang=en"
ACCOUNTS = {
    "kim@salon-kaya.de": SimpleNamespace(email="kim@salon-kaya.de", disabled=False),
    "gesperrt@salon-kaya.de": SimpleNamespace(email="gesperrt@salon-kaya.de", disabled=True),
}


def client(mails=None, mail_result=True, configured=True, origin="https://dranzeit.de", ip="203.0.113.7"):
    import app.apis.password_reset as api
    from app.libs.mail import MailError

    api._requests.clear()
    api._user = lambda email: ACCOUNTS.get(email)
    api._firebase_link = lambda address: FIREBASE_LINK
    api.mail_configured = lambda: configured

    def fake_send(to, subject, html, text=""):
        if mail_result == "fehler":
            raise MailError("Resend lehnt ab (403)")
        if mails is not None:
            mails.append({"to": to, "subject": subject, "html": html, "text": text})
        return mail_result

    api.send_mail = fake_send
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    c = TestClient(app)
    c.headers.update({"Origin": origin, "X-Forwarded-For": ip})
    return c


def ask(c, email="kim@salon-kaya.de"):
    return c.post("/routes/password-reset", json={"email": email})


def test_mail_mit_link_auf_dranzeit():
    mails = []
    r = ask(client(mails=mails), " Kim@Salon-Kaya.de ")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "verschickt"}
    assert len(mails) == 1 and mails[0]["to"] == "kim@salon-kaya.de"
    assert mails[0]["subject"] == "Neues Passwort für Dranzeit"
    link = next(w for w in mails[0]["text"].split() if w.startswith("https://"))
    assert link.startswith("https://dranzeit.de/passwort-neu?code=")
    # Code unverändert übernommen (Sonderzeichen sauber kodiert), Firebase-Seite und API-Schlüssel nicht im Link
    assert parse_qs(urlparse(link).query)["code"] == ["Re-9_z/q="]
    assert "firebaseapp" not in mails[0]["html"] and "apiKey" not in link
    assert "Neues Passwort setzen" in mails[0]["html"] and "eine Stunde" in mails[0]["text"]


def test_ohne_konto_gleiche_antwort_aber_keine_mail():
    """Wie bei Firebase: Von außen ist nicht zu erkennen, ob es ein Konto gibt"""
    mails = []
    for email in ("niemand@salon-kaya.de", "gesperrt@salon-kaya.de", "test@example.com"):
        r = ask(client(mails=mails), email)
        assert r.status_code == 200 and r.json() == {"status": "verschickt"}, (email, r.text)
    assert mails == []


def test_unbekannte_herkunft_link_auf_dranzeit():
    mails = []
    ask(client(mails=mails, origin="https://boese.example"))
    assert "https://dranzeit.de/passwort-neu?code=" in mails[0]["text"]
    assert "boese" not in mails[0]["html"]


def test_falsche_adresse_400():
    for email in ("", "kim", "kim@salon", "a b@c.de"):
        assert ask(client(), email).status_code == 400, email


def test_ohne_resend_ehrlich():
    mails = []
    r = ask(client(mails=mails, configured=False))
    assert r.json() == {"status": "nicht_eingerichtet"} and mails == []


def test_resend_fehler_meldet_502_und_zaehlt_nicht():
    import app.apis.password_reset as api

    c = client(mail_result="fehler")
    assert ask(c).status_code == 502
    assert all(len(v) == 0 for v in api._requests.values())


def test_hoechstens_eine_pro_minute_und_fuenf_am_tag():
    import app.apis.password_reset as api

    mails = []
    c = client(mails=mails)
    assert ask(c).status_code == 200
    r = ask(c)
    assert r.status_code == 429 and "Minute" in r.json()["detail"]
    # Auch ohne Konto wird gezählt – sonst verriete die Sperre, dass es eins gibt
    assert ask(c, "niemand@salon-kaya.de").status_code == 200
    assert ask(c, "niemand@salon-kaya.de").status_code == 429
    # Fünf am Tag: Zeitpunkte zurückdatieren
    api._requests["mail:kim@salon-kaya.de"].clear()
    api._requests["mail:kim@salon-kaya.de"].extend([1.0, 2.0, 3.0, 4.0, 5.0])
    real = api.time.time
    api.time.time = lambda: 6.0 + 3600
    try:
        assert ask(c).status_code == 429
    finally:
        api.time.time = real
    assert len(mails) == 1


def test_je_ip_hoechstens_zwanzig_am_tag():
    c = client()
    for i in range(20):
        assert ask(c, f"person{i}@salon-kaya.de").status_code == 200
    r = ask(c, "person21@salon-kaya.de")
    assert r.status_code == 429


def test_im_router_eingetragen_ohne_anmeldung():
    import json

    cfg = json.loads(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routers.json"), encoding="utf-8").read())
    assert cfg["routers"]["password_reset"]["disableAuth"] is True


def test_mail_design_logo_knopf_und_fallback():
    from app.libs.mail import LOGO_PATH, LOGO_SIZE, branded_html

    html = branded_html("Überschrift", ["Absatz <strong>fett</strong>"], "Los geht’s", "https://dranzeit.de/x?a=1&b=2", "Kleingedrucktes")
    assert html.startswith("<!DOCTYPE html>") and html.endswith("</html>")
    # Logo mit fester Größe und absoluter Adresse, bei blockierten Bildern steht „Dranzeit“ da
    assert f'src="https://dranzeit.de{LOGO_PATH}" width="{LOGO_SIZE[0]}" height="{LOGO_SIZE[1]}" alt="Dranzeit"' in html
    # Knopf als Tabellenzelle (Outlook) und Link zum Abtippen, & im Link entschärft
    assert 'bgcolor="#ffc83d"' in html and 'href="https://dranzeit.de/x?a=1&amp;b=2"' in html
    assert "Absatz <strong>fett</strong>" in html and "Kleingedrucktes" in html and "/impressum" in html
    assert "max-width:560px" in html and "<div" not in html
    # Ohne Knopf kein Knopf
    assert "bgcolor=\"#ffc83d\"" not in branded_html("Ü", ["A"])


def test_logo_datei_passt_zur_angegebenen_groesse():
    import struct

    from app.libs.mail import LOGO_PATH, LOGO_SIZE

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    with open(os.path.join(root, "frontend", "public", LOGO_PATH.lstrip("/")), "rb") as f:
        head = f.read(24)
    width, height = struct.unpack(">II", head[16:24])
    assert (width, height) == (LOGO_SIZE[0] * 3, LOGO_SIZE[1] * 3), (width, height)


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
