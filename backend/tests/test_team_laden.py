"""
Tests für Team und Leistungen über das Backend (app/libs/team_laden.py, app/apis/team_laden, öffentlich in app/apis/live).
Die Rechte sind die aus firestore.rules. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_team_laden.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import store  # noqa: E402
from app.libs import live  # noqa: E402
from test_team_termine import Db  # noqa: E402

UTC = timezone.utc
JETZT = datetime.now(UTC)


class BatchDb(Db):
    """Db aus test_team_termine, dazu Sammel-Schreiben und Unter-Sammlungen über Pfade"""

    def batch(self):
        return self.transaction()


def _unter(self, name):
    from test_team_termine import Query

    return Query(self.db, f"{self.coll}/{self.id}/{name}")


def _loeschen(self):
    self._docs().pop(self.id, None)


import test_team_termine as tt  # noqa: E402

tt.Ref.collection = _unter
tt.Ref.delete = _loeschen


def laden():
    return {
        "shops": {"laden1": {"name": "Salon", "owner": "chefin"}, "laden2": {"name": "Anderer", "owner": "fremd"}},
        "shops/laden1/staff_contacts": {"kim": {"email": "kim@example.com", "phone": "0170 3", "inviteEmailTo": "kim@example.com"}},
        "staff": {
            "kim": {"shopId": "laden1", "name": "Kim", "userId": "kim-konto", "isActive": True, "serviceIds": ["schnitt"],
                    "workingHours": [], "inviteTokenHash": "geheim", "inviteExpires": JETZT + timedelta(days=3), "profileImageUrl": "x.png"},
            "neu": {"shopId": "laden1", "name": "Neu", "userId": "", "isActive": True, "email": "alt@example.com"},
            "weg": {"shopId": "laden1", "name": "Weg", "userId": "weg-konto", "isActive": False},
            "fremd": {"shopId": "laden2", "name": "Fremd", "userId": "kim-konto", "isActive": True},
        },
        "services": {
            "schnitt": {"shopId": "laden1", "name": "Schnitt", "duration": 30, "price": 20},
            "fremd": {"shopId": "laden2", "name": "Fremd", "duration": 15, "price": 5},
        },
        "appointments": {
            "kommend": {"shopId": "laden1", "serviceId": "schnitt", "status": "scheduled", "startTime": JETZT + timedelta(hours=2), "endTime": JETZT + timedelta(hours=3)},
            "vorbei": {"shopId": "laden1", "serviceId": "schnitt", "status": "scheduled", "startTime": JETZT - timedelta(hours=3), "endTime": JETZT - timedelta(hours=2)},
            "abgesagt": {"shopId": "laden1", "serviceId": "schnitt", "status": "cancelled", "startTime": JETZT + timedelta(hours=4), "endTime": JETZT + timedelta(hours=5)},
        },
    }


def client(daten, uid):
    import app.apis.firebase_utils as fu
    import app.apis.live as live_api
    import app.apis.team_laden as api
    from databutton_app.mw.auth_mw import get_authorized_user

    db = BatchDb(daten)
    store.db = lambda: db
    fu.get_firestore_db = lambda: db
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    app.include_router(live_api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=f"{uid}@example.com", email_verified=False)
    return TestClient(app)


# --- Lesen -----------------------------------------------------------------------------------------------------------


def test_oeffentlich_ohne_konto_id_einladung_und_kontakte():
    r = client(laden(), "niemand").get("/routes/live/laden/laden1/personen")
    personen = {p["id"]: p for p in r.json()["personen"]}
    assert set(personen) == {"kim", "neu", "weg"}
    kim = personen["kim"]
    assert kim["name"] == "Kim" and kim["serviceIds"] == ["schnitt"] and kim["profileImageUrl"] == "x.png"
    for privat in ("userId", "inviteTokenHash", "inviteExpires", "email", "phone"):
        assert privat not in kim and privat not in personen["neu"], privat
    leistungen = client(laden(), "niemand").get("/routes/live/laden/laden1/leistungen").json()["leistungen"]
    assert [s["id"] for s in leistungen] == ["schnitt"]
    assert client(laden(), "niemand").get("/routes/live/leistung/schnitt").json()["leistung"]["name"] == "Schnitt"
    assert client(laden(), "niemand").get("/routes/live/leistung/gibtsnicht").status_code == 404


def test_inhaber_sieht_kontakte_team_nur_konto_ids():
    chefin = client(laden(), "chefin").get("/routes/team/laden/laden1/personen").json()["personen"]
    kim = next(p for p in chefin if p["id"] == "kim")
    assert kim["userId"] == "kim-konto" and kim["email"] == "kim@example.com" and kim["inviteEmailTo"] == "kim@example.com"
    assert "inviteTokenHash" not in kim and "__zeit" in kim["inviteExpires"]
    assert next(p for p in chefin if p["id"] == "neu")["email"] == "alt@example.com"  # alter Eintrag ohne Kontaktdokument
    team = client(laden(), "kim-konto").get("/routes/team/laden/laden1/personen").json()["personen"]
    kim = next(p for p in team if p["id"] == "kim")
    assert kim["userId"] == "kim-konto" and "email" not in kim and "phone" not in kim
    assert client(laden(), "fremd").get("/routes/team/laden/laden1/personen").status_code == 403


def test_eigene_eintraege_in_mehreren_laeden():
    eigene = client(laden(), "kim-konto").get("/routes/team/ich/personen").json()["personen"]
    assert [p["id"] for p in eigene] == ["fremd", "kim"] and all("email" not in p for p in eigene)
    assert client(laden(), "weg-konto").get("/routes/team/ich/personen").json()["personen"] == []


def test_kommende_termine_mit_leistung():
    assert client(laden(), "kim-konto").get("/routes/team/leistungen/schnitt/kommende").json() == {"anzahl": 1}
    assert client(laden(), "fremd").get("/routes/team/leistungen/schnitt/kommende").status_code == 403


# --- Personen schreiben --------------------------------------------------------------------------------------------


def test_person_anlegen_nur_inhaber_kontakt_getrennt():
    daten = laden()
    c = client(daten, "chefin")
    r = c.post("/routes/team/personen", json={"person": {"shopId": "laden1", "name": "Ali", "email": " ali@example.com ", "phone": "0170 9",
                                                            "isActive": True, "serviceIds": ["schnitt"], "inviteTokenHash": "x", "userId": ""}})
    assert r.status_code == 200, r.text
    p = r.json()["person"]
    gespeichert = daten["staff"][p["id"]]
    assert "email" not in gespeichert and "inviteTokenHash" not in gespeichert and gespeichert["status"] == "available"
    assert daten["shops/laden1/staff_contacts"][p["id"]]["email"] == "ali@example.com" and p["email"] == "ali@example.com"
    # Inhaber arbeitet selbst mit: eigenes Konto ja, fremdes nein
    assert c.post("/routes/team/personen", json={"person": {"shopId": "laden1", "name": "Ich", "userId": "chefin"}}).status_code == 200
    assert c.post("/routes/team/personen", json={"person": {"shopId": "laden1", "name": "X", "userId": "kim-konto"}}).status_code == 400
    assert c.post("/routes/team/personen", json={"person": {"shopId": "laden1", "name": "  "}}).status_code == 400
    assert client(daten, "kim-konto").post("/routes/team/personen", json={"person": {"shopId": "laden1", "name": "Y"}}).status_code == 403
    assert client(daten, "chefin").post("/routes/team/personen", json={"person": {"shopId": "laden2", "name": "Z"}}).status_code == 403


def test_person_aendern_inhaber_und_selbst():
    daten = laden()
    c = client(daten, "chefin")
    r = c.post("/routes/team/personen/neu", json={"aenderung": {"name": "Neu2", "email": "neu@example.com", "shopId": "laden2", "inviteTokenHash": "x"}})
    assert r.status_code == 200, r.text
    s = daten["staff"]["neu"]
    assert s["name"] == "Neu2" and s["shopId"] == "laden1" and "email" not in s and "inviteTokenHash" not in s  # alte E-Mail am Eintrag weg
    assert daten["shops/laden1/staff_contacts"]["neu"]["email"] == "neu@example.com" and r.json()["person"]["email"] == "neu@example.com"
    # Konto-ID: nur das eigene
    assert c.post("/routes/team/personen/neu", json={"aenderung": {"userId": "kim-konto"}}).status_code == 400
    # die Person selbst: nur Arbeitszeiten
    kim = client(daten, "kim-konto")
    zeiten = [{"dayOfWeek": 1, "startTime": "09:00", "endTime": "17:00", "isWorking": True}]
    assert kim.post("/routes/team/personen/kim", json={"aenderung": {"workingHours": zeiten}}).status_code == 200
    assert daten["staff"]["kim"]["workingHours"] == zeiten
    assert kim.post("/routes/team/personen/kim", json={"aenderung": {"name": "Kimmy"}}).status_code == 403
    assert kim.post("/routes/team/personen/neu", json={"aenderung": {"workingHours": zeiten}}).status_code == 403
    assert c.post("/routes/team/personen/gibtsnicht", json={"aenderung": {"name": "x"}}).status_code == 404


def test_deaktivieren_und_zurueckholen_mit_team_vermerk():
    daten = laden()
    daten["shops/laden1/members"] = {"kim-konto": {"staffId": "kim"}}
    c = client(daten, "chefin")
    assert c.post("/routes/team/personen/kim/aktiv", json={"aktiv": False}).json()["person"]["isActive"] is False
    assert daten["staff"]["kim"]["isActive"] is False and "kim-konto" not in daten["shops/laden1/members"]
    c.post("/routes/team/personen/kim/aktiv", json={"aktiv": True})
    assert daten["staff"]["kim"]["isActive"] is True and daten["shops/laden1/members"]["kim-konto"]["staffId"] == "kim"
    assert client(daten, "kim-konto").post("/routes/team/personen/kim/aktiv", json={"aktiv": False}).status_code == 403


# --- Leistungen schreiben ------------------------------------------------------------------------------------------


def test_leistungen_nur_inhaber():
    daten = laden()
    c = client(daten, "chefin")
    r = c.post("/routes/team/leistungen", json={"leistung": {"shopId": "laden1", "name": "Bart", "duration": 15, "price": 12.5, "id": "geklaut"}})
    assert r.status_code == 200, r.text
    sid = r.json()["leistung"]["id"]
    assert sid != "geklaut" and daten["services"][sid]["price"] == 12.5
    assert c.post("/routes/team/leistungen", json={"leistung": {"shopId": "laden1", "name": "Ohne Dauer"}}).status_code == 400
    assert c.post("/routes/team/leistungen", json={"leistung": {"shopId": "laden1", "name": "X", "duration": -5}}).status_code == 400
    # ausblenden mit Zeitpunkt, wiederherstellen, Laden bleibt
    c.post(f"/routes/team/leistungen/{sid}", json={"aenderung": {"archived": True, "shopId": "laden2"}})
    assert daten["services"][sid]["archived"] is True and isinstance(daten["services"][sid]["archivedAt"], datetime) and daten["services"][sid]["shopId"] == "laden1"
    assert c.post(f"/routes/team/leistungen/{sid}", json={"aenderung": {"archived": False}}).json()["leistung"]["archived"] is False
    assert client(daten, "kim-konto").post("/routes/team/leistungen", json={"leistung": {"shopId": "laden1", "name": "Y", "duration": 10}}).status_code == 403
    assert client(daten, "kim-konto").post(f"/routes/team/leistungen/{sid}", json={"aenderung": {"price": 1}}).status_code == 403
    assert c.post("/routes/team/leistungen/fremd", json={"aenderung": {"price": 1}}).status_code == 403


if __name__ == "__main__":
    store.transactional = tt.transactional
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
