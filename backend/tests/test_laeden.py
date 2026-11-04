"""
Tests für Läden, Bilder, Kundenliste, eigenes Konto und die öffentlichen Lesewege der Buchung
(app/libs/laeden.py, app/apis/team_laden, app/apis/konto, app/apis/live). Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_laeden.py
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import store  # noqa: E402
from app.libs import live  # noqa: E402
import test_team_laden as _attrappe  # noqa: E402,F401  (Unter-Sammlungen und delete an der Attrappe)
import test_team_termine as _tt  # noqa: E402
from test_team_laden import BatchDb  # noqa: E402

UTC = timezone.utc
JETZT = datetime.now(UTC)
_tt.OPS["in"] = lambda a, b: a in b  # die Attrappe kann sonst nur ==, <, >=, >
_tt.Query.limit = lambda self, n: self
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
DATEIEN = tempfile.mkdtemp(prefix="dranzeit-dateien-")
os.environ["QME_DATEIEN_DIR"] = DATEIEN


def daten():
    return {
        "shops": {
            "laden1": {"name": "Salon", "owner": "chefin", "city": "Berlin", "onboarding": {"plakatAt": JETZT},
                       "onboardingMails": {"start": JETZT}, "billing": {"plan": "laden", "status": "active", "customerId": "cus_x"},
                       "businessHoursByDay": [{"dayOfWeek": 1, "isOpen": True}]},
            "laden2": {"name": "Anderer", "owner": "fremd", "suspended": {"at": JETZT, "accounts": ["x"]}},
        },
        "staff": {"kim": {"shopId": "laden1", "name": "Kim", "userId": "kim-konto", "isActive": True, "inviteTokenHash": "h"}},
        "public_appointments": {
            "p1": {"shopId": "laden1", "staffId": "kim", "status": "scheduled", "staffDay": "kim_2026-11-10", "startTime": JETZT},
            "p2": {"shopId": "laden1", "staffId": "kim", "status": "scheduled", "staffDay": "kim_2026-12-30", "startTime": JETZT},
        },
        "appointments": {
            "a1": {"shopId": "laden1", "status": "completed", "customerId": "kundin", "startTime": JETZT},
            "a2": {"shopId": "laden1", "status": "scheduled", "customerId": "jemand", "startTime": JETZT},
        },
        "customers": {
            "c1": {"shopId": "laden1", "name": "Kara", "email": "kara@example.com", "activationTokenHash": "geheim", "isActive": True, "userId": "kundin"},
        },
        "users": {"kundin": {"uid": "kundin", "email": "kundin@example.com", "role": "customer"}},
        "earlier_slot_notifications": {
            "o1": {"userId": "kundin", "isAccepted": False, "shopId": "laden1"},
            "o2": {"userId": "kundin", "isAccepted": True, "shopId": "laden1"},
            "o3": {"userId": "jemand", "isAccepted": False, "shopId": "laden1"},
        },
    }


def client(d, uid):
    import app.apis.firebase_utils as fu
    import app.apis.konto as konto
    import app.apis.live as live_api
    import app.apis.team_laden as team
    from databutton_app.mw.auth_mw import get_authorized_user

    store.transactional = _tt.transactional
    db = BatchDb(d)
    store.db = lambda: db
    fu.get_firestore_db = lambda: db
    app = FastAPI()
    for r in (team.router, konto.router, live_api.router):
        app.include_router(r, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=f"{uid}@example.com", email_verified=False)
    return TestClient(app)


# --- öffentlich ----------------------------------------------------------------------------------------------------


def test_laden_oeffentlich_ohne_inhaber_und_merker():
    c = client(daten(), "niemand")
    laden = c.get("/routes/live/laden/laden1").json()["laden"]
    assert laden["name"] == "Salon" and laden["businessHoursByDay"][0]["dayOfWeek"] == 1
    assert not {"owner", "onboarding", "onboardingMails"} & set(laden)
    assert laden["billing"] == {"plan": "laden", "status": "active"}
    alle = {s["id"]: s for s in c.get("/routes/live/laeden").json()["laeden"]}
    assert set(alle) == {"laden1", "laden2"} and "owner" not in alle["laden2"] and "accounts" not in alle["laden2"]["suspended"]
    assert c.get("/routes/live/laden/gibtsnicht").status_code == 404


def test_person_und_belegte_zeiten_oeffentlich():
    c = client(daten(), "niemand")
    person = c.get("/routes/live/person/kim").json()["person"]
    assert person["name"] == "Kim" and "userId" not in person and "inviteTokenHash" not in person
    r = c.get("/routes/live/person/kim/belegt?von=2026-11-09T23:00:00Z&bis=2026-11-11T23:00:00Z")
    assert [t["id"] for t in r.json()["termine"]] == ["p1"], r.text
    assert c.get("/routes/live/person/kim/belegt?von=2026-11-09T23:00:00Z&bis=2027-03-01T00:00:00Z").status_code == 400


# --- Läden für den Inhaber -----------------------------------------------------------------------------------------


def test_eigene_laeden_und_ganzer_laden_fuers_team():
    d = daten()
    assert [s["id"] for s in client(d, "chefin").get("/routes/team/ich/laeden").json()["laeden"]] == ["laden1"]
    ganz = client(d, "kim-konto").get("/routes/team/laeden/laden1").json()["laden"]
    assert ganz["owner"] == "chefin" and "plakatAt" in ganz["onboarding"]
    assert client(d, "fremd").get("/routes/team/laeden/laden1").status_code == 403


def test_laden_anlegen_nur_gratis_mit_testphase():
    d = daten()
    r = client(d, "neu-konto").post("/routes/team/laeden", json={"laden": {"name": "Mein Salon", "city": "Köln", "plan": "laden",
                                                                          "billing": {"status": "active"}, "founder": True, "owner": "chefin"}})
    assert r.status_code == 200, r.text
    sid = r.json()["laden"]["id"]
    s = d["shops"][sid]
    assert s["owner"] == "neu-konto" and s["plan"] == "gratis" and "billing" not in s and "founder" not in s
    assert timedelta(days=29) < s["trialEndsAt"] - JETZT < timedelta(days=31)
    assert client(d, "neu-konto").post("/routes/team/laeden", json={"laden": {"name": " "}}).status_code == 400


def test_laden_aendern_nur_inhaber_ohne_tarif_felder():
    d = daten()
    c = client(d, "chefin")
    r = c.post("/routes/team/laeden/laden1", json={"aenderung": {"name": "Salon Neu", "plan": "team", "owner": "ich", "suspended": None,
                                                                "trialEndsAt": live.json_wert(JETZT + timedelta(days=999))}})
    assert r.status_code == 200, r.text
    s = d["shops"]["laden1"]
    assert s["name"] == "Salon Neu" and s["owner"] == "chefin" and "plan" not in s and s["billing"]["plan"] == "laden"
    assert client(d, "kim-konto").post("/routes/team/laeden/laden1", json={"aenderung": {"name": "X"}}).status_code == 403


def test_startklar_bedient():
    d = daten()
    assert client(d, "kim-konto").get("/routes/team/laeden/laden1/startklar").json() == {"bedient": True}
    d["appointments"]["a1"]["status"] = "scheduled"
    assert client(d, "chefin").get("/routes/team/laeden/laden1/startklar").json() == {"bedient": False}


# --- Bilder --------------------------------------------------------------------------------------------------------


def test_bild_hochladen_und_ausliefern():
    d = daten()
    c = client(d, "chefin")
    r = c.post("/routes/team/laeden/laden1/bild", files={"datei": ("logo.png", PNG, "image/png")}, data={"art": "logo"})
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("https://dranzeit.de/routes/live/dateien/laden1/") and url.endswith(".png")
    pfad = url.split("https://dranzeit.de")[1]
    bild = client(d, "niemand").get(pfad)
    assert bild.status_code == 200 and bild.content == PNG and bild.headers["content-type"] == "image/png"
    assert "immutable" in bild.headers["cache-control"]
    # kein Bild, zu groß, fremder Laden, unbekannte Datei, Pfad-Tricks
    assert c.post("/routes/team/laeden/laden1/bild", files={"datei": ("x.png", b"<svg/>", "image/png")}).status_code == 400
    assert c.post("/routes/team/laeden/laden1/bild", files={"datei": ("x.png", PNG + b"\x00" * (5 * 1024 * 1024), "image/png")}).status_code == 400
    assert client(d, "kim-konto").post("/routes/team/laeden/laden1/bild", files={"datei": ("x.png", PNG, "image/png")}).status_code == 403
    assert client(d, "niemand").get("/routes/live/dateien/laden1/" + "0" * 32 + ".png").status_code == 404
    assert client(d, "niemand").get("/routes/live/dateien/laden1/..%2F..%2Fetc%2Fpasswd").status_code == 404


# --- Kundenliste ---------------------------------------------------------------------------------------------------


def test_kundenliste_fuers_team():
    d = daten()
    kunden = client(d, "kim-konto").get("/routes/team/laeden/laden1/kunden").json()["kunden"]
    assert kunden[0]["name"] == "Kara" and "activationTokenHash" not in kunden[0]
    assert client(d, "fremd").get("/routes/team/laeden/laden1/kunden").status_code == 403
    c = client(d, "chefin")
    gleich = c.post("/routes/team/kunden", json={"kunde": {"shopId": "laden1", "name": "Kara 2", "email": "kara@example.com"}}).json()["kunde"]
    assert gleich["id"] == "c1"
    neu = c.post("/routes/team/kunden", json={"kunde": {"shopId": "laden1", "name": "Ben", "userId": "geklaut", "isActive": True,
                                                         "activationTokenHash": "x"}}).json()["kunde"]
    g = d["customers"][neu["id"]]
    assert g["isActive"] is False and "userId" not in g and "activationTokenHash" not in g
    assert client(d, "fremd").post("/routes/team/kunden", json={"kunde": {"shopId": "laden1", "name": "X"}}).status_code == 403


# --- eigenes Konto -------------------------------------------------------------------------------------------------


def test_profil_lesen_anlegen_aendern():
    d = daten()
    c = client(d, "neu-konto")
    assert c.get("/routes/konto/profil").json() == {"profil": None}
    p = c.post("/routes/konto/profil/anlegen", json={"email": "neu@example.com", "role": "shopOwner", "language": "en"}).json()["profil"]
    assert p["role"] == "shopOwner" and d["users"]["neu-konto"]["language"] == "en"
    # zweites Anlegen ändert nichts
    assert c.post("/routes/konto/profil/anlegen", json={"email": "x@example.com", "role": "customer"}).json()["profil"]["email"] == "neu@example.com"
    assert client(d, "noch-neuer").post("/routes/konto/profil/anlegen", json={"role": "admin"}).status_code == 400
    r = c.post("/routes/konto/profil", json={"aenderung": {"displayName": "Neu", "phoneNumber": "0170", "uid": "geklaut"}})
    assert r.json()["profil"]["displayName"] == "Neu" and d["users"]["neu-konto"]["uid"] == "neu-konto"
    assert c.post("/routes/konto/profil", json={"aenderung": {"role": "admin"}}).status_code == 400


def test_eigene_termine_und_angebote():
    d = daten()
    c = client(d, "kundin")
    assert [t["id"] for t in c.get("/routes/konto/termine").json()["termine"]] == ["a1"]
    assert c.get("/routes/konto/termine/a1").json()["termin"]["status"] == "completed"
    assert c.get("/routes/konto/termine/a2").status_code == 404
    assert [a["id"] for a in c.get("/routes/konto/angebote").json()["angebote"]] == ["o1"]
    assert c.get("/routes/konto/angebote/o1").status_code == 200 and c.get("/routes/konto/angebote/o3").status_code == 404


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
