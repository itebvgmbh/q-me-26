"""
Tests für die Bestätigungs-Mail (/email-bestaetigen). Ohne Firebase und Resend lauffähig (beides nachgebildet):

    cd backend && .venv/bin/python tests/test_email_verification.py
"""
import os
import sys
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

FIREBASE_LINK = "https://qmedata-7c79e.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=AbC-123_x%2Fy%3D&apiKey=k&lang=en"


def client(email="kim@salon-kaya.de", verified=False, mails=None, mail_result=True, configured=True, origin="https://q-me.spielmacherei.de"):
    import app.apis.email_verification as api
    from databutton_app.mw.auth_mw import get_authorized_user
    from app.libs.mail import MailError

    api._sent.clear()
    api._account = lambda uid: type("Record", (), {"email": email, "email_verified": verified})()
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
    app.dependency_overrides[get_authorized_user] = lambda: type("User", (), {"sub": "kontoKim", "email": email})()
    c = TestClient(app)
    c.headers.update({"Origin": origin})
    return c


def send(c):
    return c.post("/routes/email-verification")


def test_mail_mit_link_auf_dranzeit():
    mails = []
    r = send(client(mails=mails))
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "verschickt", "email": "kim@salon-kaya.de"}
    assert len(mails) == 1 and mails[0]["to"] == "kim@salon-kaya.de"
    assert "bestätige" in mails[0]["subject"]
    link = next(w for w in mails[0]["text"].split() if w.startswith("https://"))
    assert link.startswith("https://q-me.spielmacherei.de/email-bestaetigen?code=")
    # Code unverändert übernommen (Sonderzeichen sauber kodiert), Firebase-Seite und API-Schlüssel nicht im Link
    assert parse_qs(urlparse(link).query)["code"] == ["AbC-123_x/y="]
    assert "firebaseapp" not in mails[0]["html"] and "apiKey" not in link
    assert "kim@salon-kaya.de" in mails[0]["html"]


def test_fremde_adresse_wird_nicht_in_den_link_uebernommen():
    mails = []
    send(client(mails=mails, origin="https://boese.example"))
    assert "https://dranzeit.de/email-bestaetigen?code=" in mails[0]["text"]


def test_schon_bestaetigt_schickt_nichts():
    mails = []
    r = send(client(verified=True, mails=mails))
    assert r.json()["status"] == "bestaetigt" and mails == []


def test_keine_mail_an_testadressen():
    mails = []
    r = send(client(email="kunde-1@example.com", mails=mails))
    assert r.json()["status"] == "testadresse" and mails == []


def test_ohne_resend_ehrlich():
    mails = []
    r = send(client(configured=False, mails=mails))
    assert r.json()["status"] == "nicht_eingerichtet" and mails == []


def test_resend_fehler_meldet_502_und_zaehlt_nicht():
    import app.apis.email_verification as api

    c = client(mail_result="fehler")
    r = send(c)
    assert r.status_code == 502 and "nicht verschickt" in r.json()["detail"]
    assert len(api._sent["kontoKim"]) == 0
    # Gleich danach noch einmal: nicht wegen "gerade erst geschickt" gesperrt
    api.send_mail = lambda *a, **k: True
    assert send(c).json()["status"] == "verschickt"


def test_hoechstens_eine_pro_minute_und_fuenf_am_tag():
    import app.apis.email_verification as api

    mails = []
    c = client(mails=mails)
    assert send(c).status_code == 200
    r = send(c)
    assert r.status_code == 429 and "Minute" in r.json()["detail"]
    # Fünf Mails über den Tag verteilt (je zwei Minuten auseinander), die sechste ist gesperrt
    api._sent["kontoKim"].clear()
    import time

    now = time.time()
    api._sent["kontoKim"].extend(now - 120 * i for i in range(api.PER_DAY, 0, -1))
    r = send(c)
    assert r.status_code == 429 and "morgen" in r.json()["detail"]
    # Älter als ein Tag zählt nicht mehr
    api._sent["kontoKim"].clear()
    api._sent["kontoKim"].extend(now - 90000 - i for i in range(api.PER_DAY))
    assert send(c).status_code == 200
    assert len(mails) == 2


def test_link_ohne_code_wird_abgelehnt():
    import app.apis.email_verification as api

    try:
        api.verification_link("https://qmedata-7c79e.firebaseapp.com/__/auth/action?mode=verifyEmail", "https://dranzeit.de")
    except ValueError:
        return
    raise AssertionError("Link ohne oobCode angenommen")



def test_im_router_eingetragen_mit_anmeldung():
    import json

    cfg = json.loads(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routers.json"), encoding="utf-8").read())
    assert cfg["routers"]["email_verification"]["disableAuth"] is False


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
