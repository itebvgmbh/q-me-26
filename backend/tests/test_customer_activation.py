"""
Tests für den Kunden-Link (/activate): Ein Laden legt eine Person an, die Person verbindet ihr Konto.
Und für das Buchen mit Konto (/customer-link): Eintrag gleich verbunden anlegen oder vorhandenen verbinden.
Ohne Firebase lauffähig (Datenbank nachgebildet):

    cd backend && .venv/bin/python tests/test_customer_activation.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

TOKEN = "abc123def456ghi789"
NOW = datetime.now(timezone.utc)


class Ref:
    def __init__(self, db, coll, doc_id):
        self.db, self.coll, self.id = db, coll, doc_id

    def get(self):
        return Snap(self, self.db.data[self.coll].get(self.id))

    def update(self, values):
        self.db.data[self.coll][self.id].update({k: ("ZEIT" if v.__class__.__name__ == "Sentinel" else v) for k, v in values.items()})

    def create(self, values):
        from google.api_core.exceptions import Conflict

        if self.id in self.db.data[self.coll]:
            raise Conflict("gibt es schon")
        self.db.data[self.coll][self.id] = {}
        self.update(values)


class Snap:
    def __init__(self, ref, data):
        self.reference, self.id, self._data = ref, ref.id, data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class Query:
    def __init__(self, db, coll, filters=(), max_rows=None):
        self.db, self.coll, self.filters, self.max_rows = db, coll, list(filters), max_rows

    def where(self, field, op, value):
        assert op == "=="
        return Query(self.db, self.coll, self.filters + [(field, value)], self.max_rows)

    def limit(self, n):
        return Query(self.db, self.coll, self.filters, n)

    def document(self, doc_id):
        return Ref(self.db, self.coll, doc_id)

    def stream(self):
        rows = [
            Snap(Ref(self.db, self.coll, doc_id), data)
            for doc_id, data in self.db.data[self.coll].items()
            if all(data.get(f) == v for f, v in self.filters)
        ]
        return iter(rows[: self.max_rows] if self.max_rows else rows)


class Batch:
    def __init__(self):
        self.ops = []

    def update(self, ref, values):
        self.ops.append((ref, values))

    def commit(self):
        for ref, values in self.ops:
            ref.update(values)


class FakeDb:
    def __init__(self, data):
        self.data = data

    def collection(self, name):
        self.data.setdefault(name, {})
        return Query(self, name)

    def batch(self):
        return Batch()


def data(**customer):
    return {
        "shops": {"laden1": {"name": "Barbershop Kaya", "owner": "inhaber"}, "laden2": {"name": "Salon Nord", "owner": "inhaber2"}},
        "customers": {
            "kunde1": {
                "shopId": "laden1",
                "name": "Max",
                "email": "max@example.com",
                "activationToken": TOKEN,
                "activationExpires": NOW + timedelta(days=10),
                "isActive": False,
                **customer,
            }
        },
        "appointments": {
            "t1": {"shopId": "laden1", "customerId": "kunde1", "customerName": "Max"},
            "t2": {"shopId": "laden1", "customerId": "kunde1", "customerName": "Max"},
            "t3": {"shopId": "laden1", "customerId": "jemand", "customerName": "Andere"},
        },
    }


def client(store, uid="kontoMax", email="max@example.com", verified=True, name="Max Muster"):
    import app.apis.customer_activation as api
    from databutton_app.mw.auth_mw import get_authorized_user

    db = FakeDb(store)
    api.get_firestore_db = lambda: db
    api.account = lambda _uid: {"email": email, "verified": verified, "name": name}
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    if uid:
        app.dependency_overrides[get_authorized_user] = lambda: type("User", (), {"sub": uid, "email": f"{uid}@example.com"})()
    return TestClient(app)


def test_info_ohne_anmeldung():
    r = client(data(), uid=None).get(f"/routes/customer-activation/{TOKEN}")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "offen", "shopName": "Barbershop Kaya"}


def test_info_unbekannt_oder_kaputt():
    c = client(data(), uid=None)
    assert c.get("/routes/customer-activation/gibtesnichtgibtesnicht").status_code == 404
    assert c.get("/routes/customer-activation/kurz").status_code == 404


def test_info_abgelaufen_und_verbunden():
    assert client(data(activationExpires=NOW - timedelta(minutes=1)), uid=None).get(f"/routes/customer-activation/{TOKEN}").json()["status"] == "abgelaufen"
    assert client(data(userId="x"), uid=None).get(f"/routes/customer-activation/{TOKEN}").json()["status"] == "verbunden"


def test_verbinden_haengt_termine_ans_konto():
    store = data()
    r = client(store).post(f"/routes/customer-activation/{TOKEN}")
    assert r.status_code == 200, r.text
    assert r.json() == {"shopName": "Barbershop Kaya", "moved": 2}
    kunde = store["customers"]["kunde1"]
    assert kunde["userId"] == "kontoMax" and kunde["isActive"] is True
    assert store["appointments"]["t1"]["customerId"] == "kontoMax"
    assert store["appointments"]["t2"]["customerId"] == "kontoMax"
    assert store["appointments"]["t3"]["customerId"] == "jemand"  # fremder Termin bleibt


def test_zweimal_verbinden_schadet_nicht():
    store = data()
    client(store).post(f"/routes/customer-activation/{TOKEN}")
    r = client(store).post(f"/routes/customer-activation/{TOKEN}")
    assert r.status_code == 200 and r.json()["moved"] == 0


def test_anderes_konto_kann_nicht_uebernehmen():
    store = data(userId="kontoMax")
    r = client(store, uid="fremd").post(f"/routes/customer-activation/{TOKEN}")
    assert r.status_code == 409
    assert store["customers"]["kunde1"]["userId"] == "kontoMax"


def test_abgelaufen():
    store = data(activationExpires=NOW - timedelta(days=1))
    r = client(store).post(f"/routes/customer-activation/{TOKEN}")
    assert r.status_code == 410
    assert "userId" not in store["customers"]["kunde1"]
    assert store["appointments"]["t1"]["customerId"] == "kunde1"


def test_inhaber_kann_sich_nicht_selbst_verbinden():
    store = data()
    r = client(store, uid="inhaber").post(f"/routes/customer-activation/{TOKEN}")
    assert r.status_code == 409 and "Konto des Ladens" in r.json()["detail"]
    assert "userId" not in store["customers"]["kunde1"]


def test_verbinden_nur_angemeldet():
    from fastapi import HTTPException

    import app.apis.customer_activation as api
    from databutton_app.mw.auth_mw import get_authorized_user

    def nicht_angemeldet():
        raise HTTPException(status_code=401, detail="Not authenticated")

    db = FakeDb(data())
    api.get_firestore_db = lambda: db
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = nicht_angemeldet
    assert TestClient(app).post(f"/routes/customer-activation/{TOKEN}").status_code == 401
    assert TestClient(app).post("/routes/customer-link/laden1").status_code == 401


# Buchen mit Konto (Nummer ziehen, Termin buchen): POST /customer-link/{shopId}


def ohne_eintrag():
    store = data()
    del store["customers"]["kunde1"]
    return store


def test_buchen_mit_konto_legt_verbundenen_eintrag_an():
    store = ohne_eintrag()
    r = client(store).post("/routes/customer-link/laden1")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "neu", "moved": 0}
    assert list(store["customers"]) == ["laden1_kontoMax"]
    kunde = store["customers"]["laden1_kontoMax"]
    assert kunde["userId"] == "kontoMax" and kunde["isActive"] is True
    assert kunde["shopId"] == "laden1" and kunde["email"] == "max@example.com" and kunde["name"] == "Max Muster"
    assert "activationToken" not in kunde  # verbunden, braucht keinen Link


def test_ohne_namen_teil_der_email():
    store = ohne_eintrag()
    client(store, name="").post("/routes/customer-link/laden1")
    assert store["customers"]["laden1_kontoMax"]["name"] == "max"


def test_zweimal_buchen_ein_eintrag():
    store = ohne_eintrag()
    client(store).post("/routes/customer-link/laden1")
    r = client(store).post("/routes/customer-link/laden1")
    assert r.json() == {"status": "schon_verbunden", "moved": 0}
    assert len(store["customers"]) == 1


def test_gleichzeitig_gebucht_ein_eintrag():
    # Der zweite Aufruf sieht den ersten Eintrag noch nicht (Abfrage nach userId leer), anlegen scheitert an der festen ID
    store = ohne_eintrag()
    store["customers"]["laden1_kontoMax"] = {"shopId": "laden1", "name": "Max"}
    assert client(store).post("/routes/customer-link/laden1").json()["status"] == "schon_verbunden"
    assert store["customers"]["laden1_kontoMax"] == {"shopId": "laden1", "name": "Max"}


def test_vorhandener_eintrag_mit_bestaetigter_email_wird_verbunden():
    store = data()
    r = client(store, email="Max@Example.com").post("/routes/customer-link/laden1")  # Groß/klein egal
    assert r.json() == {"status": "verbunden", "moved": 2}
    assert list(store["customers"]) == ["kunde1"]  # kein zweiter Eintrag
    assert store["customers"]["kunde1"]["userId"] == "kontoMax" and store["customers"]["kunde1"]["isActive"] is True
    assert store["appointments"]["t1"]["customerId"] == "kontoMax"
    assert store["appointments"]["t3"]["customerId"] == "jemand"


def test_unbestaetigte_email_uebernimmt_keinen_eintrag():
    store = data()
    r = client(store, uid="angreifer", verified=False).post("/routes/customer-link/laden1")
    assert r.json() == {"status": "nicht_bestaetigt", "moved": 0}
    assert list(store["customers"]) == ["kunde1"]
    assert "userId" not in store["customers"]["kunde1"]
    assert store["appointments"]["t1"]["customerId"] == "kunde1"


def test_eintrag_eines_anderen_kontos_bleibt():
    store = data(userId="fremd")
    r = client(store).post("/routes/customer-link/laden1")
    assert r.json() == {"status": "anderes_konto", "moved": 0}
    assert list(store["customers"]) == ["kunde1"] and store["customers"]["kunde1"]["userId"] == "fremd"


def test_schon_ueber_den_link_verbunden():
    store = data(userId="kontoMax")
    assert client(store).post("/routes/customer-link/laden1").json() == {"status": "schon_verbunden", "moved": 0}
    assert list(store["customers"]) == ["kunde1"]


def test_eintrag_in_anderem_laden_bleibt():
    store = data()
    r = client(store).post("/routes/customer-link/laden2")
    assert r.json() == {"status": "neu", "moved": 0}
    assert "userId" not in store["customers"]["kunde1"]
    assert store["customers"]["laden2_kontoMax"]["shopId"] == "laden2"


def test_unbekannter_laden():
    store = data()
    c = client(store)
    assert c.post("/routes/customer-link/gibtsnicht").status_code == 404
    assert c.post("/routes/customer-link/laden%2Fx").status_code == 404
    assert list(store["customers"]) == ["kunde1"]


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
