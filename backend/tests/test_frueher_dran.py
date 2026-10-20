"""
Tests für den Schalter „Früher dran“ unter „Meine Termine“ (backend/app/apis/frueher_dran).
Ohne Firebase lauffähig (Datenbank nachgebildet):

    cd backend && .venv/bin/python tests/test_frueher_dran.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402

NOW = datetime.now(timezone.utc)


class Ref:
    def __init__(self, db, coll, doc_id):
        self.db, self.coll, self.id = db, coll, doc_id

    def get(self):
        return Snap(self, self.db.data[self.coll].get(self.id))

    def update(self, values):
        doc = self.db.data[self.coll][self.id]
        for k, v in values.items():
            if v is gcf.DELETE_FIELD:
                doc.pop(k, None)
            else:
                doc[k] = "ZEIT" if v is gcf.SERVER_TIMESTAMP else v
        self.db.writes += 1


class Snap:
    def __init__(self, ref, data):
        self.reference, self.id, self._data = ref, ref.id, data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class Coll:
    def __init__(self, db, name):
        self.db, self.name = db, name

    def document(self, doc_id):
        return Ref(self.db, self.name, doc_id)


class FakeDb:
    def __init__(self, data):
        self.data, self.writes = data, 0

    def collection(self, name):
        self.data.setdefault(name, {})
        return Coll(self, name)


SOLO = {"billing": {"plan": "solo", "status": "active"}}
GRATIS = {"trialEndsAt": NOW - timedelta(days=1)}


def data(shop=None, **appt):
    return {
        "shops": {"laden1": {"name": "Barbershop Kaya", "owner": "inhaber", **(SOLO if shop is None else shop)}},
        "appointments": {
            "t1": {
                "shopId": "laden1",
                "staffId": "robin",
                "customerId": "kontoMax",
                "status": "scheduled",
                "startTime": NOW + timedelta(days=2),
                "endTime": NOW + timedelta(days=2, minutes=30),
                **appt,
            }
        },
    }


def client(store, uid="kontoMax"):
    import app.apis.frueher_dran as api
    from databutton_app.mw.auth_mw import get_authorized_user

    db = FakeDb(store)
    checks = []
    api.get_firestore_db = lambda: db
    api.trigger_check_in_background = lambda shop_id=None, staff_id=None: checks.append((shop_id, staff_id))
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    if uid:
        app.dependency_overrides[get_authorized_user] = lambda: type("User", (), {"sub": uid, "email": f"{uid}@example.com"})()
    c = TestClient(app)
    c.checks, c.db = checks, db
    return c


def test_einschalten_setzt_haken_und_prueft_sofort():
    store = data()
    c = client(store)
    r = c.post("/routes/frueher-dran/t1", json={"an": True})
    assert r.status_code == 200, r.text
    assert r.json() == {"checkEarlierOptions": True}
    t1 = store["appointments"]["t1"]
    assert t1["checkEarlierOptions"] is True and t1["checkEarlierOptionsCreatedAt"] == "ZEIT" and t1["updatedAt"] == "ZEIT"
    assert c.checks == [("laden1", "robin")]


def test_ausschalten_nimmt_haken_weg_und_gibt_angebot_frei():
    store = data(checkEarlierOptions=True, checkEarlierOptionsCreatedAt="früher")
    c = client(store)
    r = c.post("/routes/frueher-dran/t1", json={"an": False})
    assert r.status_code == 200, r.text
    t1 = store["appointments"]["t1"]
    assert t1["checkEarlierOptions"] is False and "checkEarlierOptionsCreatedAt" not in t1
    assert c.checks == [("laden1", "robin")]  # offenes Angebot verschwindet, Platz geht weiter


def test_ohne_aenderung_wird_nichts_geschrieben():
    c = client(data(checkEarlierOptions=True))
    assert c.post("/routes/frueher-dran/t1", json={"an": True}).json() == {"checkEarlierOptions": True}
    c2 = client(data())
    assert c2.post("/routes/frueher-dran/t1", json={"an": False}).json() == {"checkEarlierOptions": False}
    assert c.db.writes == 0 and c2.db.writes == 0 and not c.checks and not c2.checks


def test_fremder_termin_verboten():
    store = data()
    c = client(store, uid="jemandAnders")
    r = c.post("/routes/frueher-dran/t1", json={"an": True})
    assert r.status_code == 403 and "nicht dein Termin" in r.json()["detail"]
    assert "checkEarlierOptions" not in store["appointments"]["t1"]
    # Auch Ausschalten geht nur beim eigenen Termin
    assert client(data(checkEarlierOptions=True), uid="jemandAnders").post("/routes/frueher-dran/t1", json={"an": False}).status_code == 403


def test_termin_ohne_konto_gehoert_niemandem():
    # Vom Laden eingetragen, Konto (noch) nicht verbunden: customerId ist die ID des Kunden-Eintrags oder fehlt
    assert client(data(customerId=None), uid="kontoMax").post("/routes/frueher-dran/t1", json={"an": True}).status_code == 403


def test_ohne_anmeldung_geht_nichts():
    from fastapi import HTTPException

    from databutton_app.mw.auth_mw import get_authorized_user

    def nicht_angemeldet():
        raise HTTPException(status_code=401, detail="Not authenticated")

    store = data()
    c = client(store, uid=None)
    c.app.dependency_overrides[get_authorized_user] = nicht_angemeldet
    assert c.post("/routes/frueher-dran/t1", json={"an": True}).status_code == 401
    assert "checkEarlierOptions" not in store["appointments"]["t1"]


def test_unbekannt_oder_kaputt():
    c = client(data())
    assert c.post("/routes/frueher-dran/gibtsnicht", json={"an": True}).status_code == 404
    assert c.post("/routes/frueher-dran/a.b", json={"an": True}).status_code == 404


def test_gratis_tarif_kein_einschalten_aber_ausschalten():
    r = client(data(shop=GRATIS)).post("/routes/frueher-dran/t1", json={"an": True})
    assert r.status_code == 403 and "bietet" in r.json()["detail"]
    store = data(shop=GRATIS, checkEarlierOptions=True)
    assert client(store).post("/routes/frueher-dran/t1", json={"an": False}).status_code == 200
    assert store["appointments"]["t1"]["checkEarlierOptions"] is False


def test_testphase_zaehlt():
    assert client(data(shop={"trialEndsAt": NOW + timedelta(days=5)})).post("/routes/frueher-dran/t1", json={"an": True}).status_code == 200


def test_abgesagt_angefangen_oder_vorbei():
    for appt in (
        {"status": "cancelled"},
        {"status": "in-progress"},
        {"status": "completed"},
        {"startTime": NOW - timedelta(minutes=5)},
    ):
        r = client(data(**appt)).post("/routes/frueher-dran/t1", json={"an": True})
        assert r.status_code == 409, (appt, r.text)
    # Ausschalten bleibt möglich
    assert client(data(status="cancelled", checkEarlierOptions=True)).post("/routes/frueher-dran/t1", json={"an": False}).status_code == 200


def test_im_router_eingetragen_mit_anmeldung():
    import json

    cfg = json.loads(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routers.json"), encoding="utf-8").read())
    assert cfg["routers"]["frueher_dran"]["disableAuth"] is False


if __name__ == "__main__":
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"OK   {name}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"FEHL {name}: {e!r}")
    sys.exit(1 if failed else 0)
