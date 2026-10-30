"""
Tests für app/libs/privacy.py und app/apis/datenschutz: Was wird wann gelöscht? Ohne Firebase lauffähig
(Datenbank und Konten nachgebildet):

    cd backend && .venv/bin/python tests/test_privacy.py
"""
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")
os.environ["QME_ADMIN_EMAILS"] = ""
os.environ["QME_ADMIN_UIDS"] = ""

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.libs import privacy  # noqa: E402
from app.libs.privacy import ANONYMIZED_NAME, account_candidate, customer_expired, fields_to_clear  # noqa: E402

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
ROOT = Path(__file__).resolve().parents[2]


def days_ago(n):
    return NOW - timedelta(days=n)


# --- Datenbank zum Nachbilden -------------------------------------------------------------------


class Ref:
    def __init__(self, db, coll, doc_id):
        self.db, self.coll, self.id = db, coll, doc_id

    def get(self, transaction=None):
        return Snap(self, self.db.data[self.coll].get(self.id))

    def update(self, values):
        self.db.data[self.coll][self.id].update(values)

    def collection(self, name):
        """Unter-Sammlung, z. B. shops/{id}/members"""
        return self.db.collection(f"{self.coll}/{self.id}/{name}")

    def set(self, values, merge=False):
        doc = self.db.data[self.coll].setdefault(self.id, {})
        if not merge:
            doc.clear()
        doc.update(values)

    def delete(self):
        self.db.data[self.coll].pop(self.id, None)


class Snap:
    def __init__(self, ref, data):
        self.reference, self.id, self._data = ref, ref.id, data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


OPS = {"==": lambda a, b: a == b, ">=": lambda a, b: a is not None and a >= b, "<": lambda a, b: a is not None and a < b}


class Query:
    def __init__(self, db, coll, filters=(), order=None, max_rows=None):
        self.db, self.coll, self.filters, self.order, self.max_rows = db, coll, list(filters), order, max_rows

    def where(self, field, op, value):
        return Query(self.db, self.coll, self.filters + [(field, op, value)], self.order, self.max_rows)

    def order_by(self, field):
        return Query(self.db, self.coll, self.filters, field, self.max_rows)

    def limit(self, n):
        return Query(self.db, self.coll, self.filters, self.order, n)

    def document(self, doc_id):
        return Ref(self.db, self.coll, doc_id)

    def stream(self):
        rows = [
            Snap(Ref(self.db, self.coll, doc_id), data)
            for doc_id, data in list(self.db.data[self.coll].items())
            if all(OPS[op](data.get(f), v) for f, op, v in self.filters)
        ]
        if self.order:
            rows.sort(key=lambda s: s.to_dict()[self.order])
        return iter(rows[: self.max_rows] if self.max_rows else rows)


class FakeDb:
    def __init__(self, data):
        self.data = data

    def collection(self, name):
        self.data.setdefault(name, {})
        return Query(self, name)


class FakeStorage:
    def __init__(self):
        self.values = {}

    def get(self, key, default=None):
        return self.values.get(key, default)

    def put(self, key, value):
        self.values[key] = value


def with_storage():
    storage = FakeStorage()
    privacy.db = SimpleNamespace(storage=SimpleNamespace(json=storage))
    return storage


# --- Welche Felder ------------------------------------------------------------------------------


def test_wartenummer_ohne_konto_verliert_name_und_telefon():
    update = fields_to_clear({"isAnonymous": True, "customerName": "Ali", "customerPhone": "0151 123"}, has_account=False)
    assert update == {"customerName": ANONYMIZED_NAME, "customerPhone": None}


def test_laufkunde_vom_tresen_wird_anonymisiert():
    assert fields_to_clear({"customerId": "walk-in", "customerName": "Herr Meier"}, has_account=False) == {"customerName": ANONYMIZED_NAME}


def test_kunde_mit_konto_behaelt_namen_verliert_kontaktdaten():
    appt = {"customerId": "uid123", "customerName": "Eva", "customerPhone": "0170", "notifyEmail": "eva@example.com"}
    assert fields_to_clear(appt, has_account=True) == {"customerPhone": None, "notifyEmail": None}
    assert fields_to_clear({"customerId": "uid123", "customerName": "Eva"}, has_account=True) == {}


def test_vom_laden_angelegter_kunde_wird_anonymisiert():
    # customerId ist die ID aus customers, kein Konto
    assert fields_to_clear({"customerId": "kunde1", "customerName": "Max"}, has_account=False) == {"customerName": ANONYMIZED_NAME}


def test_schon_anonymisiert_wird_nicht_erneut_geschrieben():
    assert fields_to_clear({"isAnonymous": True, "customerName": "Ali", "anonymizedAt": "2026-01-01"}, has_account=False) == {}


def test_benachrichtigungs_email_wird_entfernt():
    update = fields_to_clear({"isAnonymous": True, "customerName": ANONYMIZED_NAME, "notifyEmail": "a@b.de"}, has_account=False)
    assert update == {"notifyEmail": None}


def test_wer_ein_konto_sein_kann():
    assert account_candidate({"customerId": "walk-in"}) is None
    assert account_candidate({"customerId": "uid1", "isAnonymous": True}) is None
    assert account_candidate({}) is None
    assert account_candidate({"customerId": "kunde1"}) == "kunde1"


# --- Täglicher Lauf über alte Termine -----------------------------------------------------------


def termine():
    return {
        "appointments": {
            "eva": {"customerId": "kontoEva", "customerName": "Eva", "notifyEmail": "eva@example.com", "startTime": days_ago(100)},
            "max": {"customerId": "kunde1", "customerName": "Max", "startTime": days_ago(95)},
            "lauf": {"customerId": "walk-in", "customerName": "Herr Meier", "startTime": days_ago(91)},
            "nummer": {"isAnonymous": True, "customerName": "Ali", "customerPhone": "0151", "startTime": days_ago(120)},
            "neu": {"customerId": "kunde1", "customerName": "Max", "startTime": days_ago(10)},
        }
    }


def test_alter_termin_nur_mit_konto_behaelt_namen():
    with_storage()
    store = termine()
    asked = []

    def accounts(ids):
        asked.append(set(ids))
        return {"kontoEva"}

    changed = privacy.anonymize_old_appointments(FakeDb(store), now=NOW, accounts=accounts)
    a = store["appointments"]
    assert changed == 4
    assert asked == [{"kontoEva", "kunde1"}]
    assert a["eva"]["customerName"] == "Eva" and a["eva"]["notifyEmail"] is None
    assert a["max"]["customerName"] == ANONYMIZED_NAME
    assert a["lauf"]["customerName"] == ANONYMIZED_NAME
    assert a["nummer"]["customerName"] == ANONYMIZED_NAME and a["nummer"]["customerPhone"] is None
    assert a["neu"]["customerName"] == "Max" and "anonymizedAt" not in a["neu"]  # noch keine 90 Tage


def test_ohne_kontenabfrage_wird_nichts_geloescht():
    storage = with_storage()
    store = termine()

    def kaputt(ids):
        raise RuntimeError("Firebase nicht erreichbar")

    try:
        privacy.anonymize_old_appointments(FakeDb(store), now=NOW, accounts=kaputt)
        raise AssertionError("Fehler hätte durchgereicht werden müssen")
    except RuntimeError:
        pass
    assert store["appointments"]["max"]["customerName"] == "Max"
    assert storage.values == {}  # Stand nicht weitergerückt, morgen neuer Versuch


def test_lauf_merkt_sich_den_stand():
    storage = with_storage()
    store = termine()
    privacy.anonymize_old_appointments(FakeDb(store), now=NOW, accounts=lambda ids: set())
    assert storage.values[privacy._CURSOR_KEY] == days_ago(90).isoformat()
    store["appointments"]["spaet"] = {"customerId": "walk-in", "customerName": "Vorher", "startTime": days_ago(200)}
    assert privacy.anonymize_old_appointments(FakeDb(store), now=NOW, accounts=lambda ids: set()) == 0


# --- Kunden-Einträge des Ladens -----------------------------------------------------------------


def test_frist_fuer_kunden_eintraege():
    assert customer_expired({"createdAt": days_ago(400)}, None, NOW)
    assert not customer_expired({"createdAt": days_ago(400)}, days_ago(60), NOW)
    assert not customer_expired({"createdAt": days_ago(400)}, NOW + timedelta(days=3), NOW)  # kommender Termin
    assert not customer_expired({"createdAt": days_ago(400), "updatedAt": days_ago(20)}, None, NOW)  # neuer Link
    assert not customer_expired({"createdAt": days_ago(30)}, None, NOW)
    assert customer_expired({}, None, NOW)
    assert not customer_expired({"createdAt": datetime(2026, 10, 1)}, None, NOW)  # ohne Zeitzone = UTC


def kunden():
    return {
        "customers": {
            "alt": {"shopId": "laden1", "name": "Alt", "email": "alt@example.com", "phone": "0170", "createdAt": days_ago(500)},
            "stamm": {"shopId": "laden1", "name": "Stamm", "email": "stamm@example.com", "createdAt": days_ago(500)},
            "verbunden": {"shopId": "laden1", "name": "Eva", "email": "eva@example.com", "userId": "kontoEva", "createdAt": days_ago(500)},
            "konto_weg": {"shopId": "laden1", "name": "Weg", "email": "weg@example.com", "userId": "geloescht", "createdAt": days_ago(500)},
            "frisch": {"shopId": "laden1", "name": "Neu", "email": "neu@example.com", "createdAt": days_ago(5)},
        },
        "appointments": {
            "a1": {"customerId": "alt", "customerName": "Alt", "startTime": days_ago(450)},
            "s1": {"customerId": "stamm", "customerName": "Stamm", "startTime": days_ago(40)},
        },
    }


def test_alte_kunden_eintraege_ohne_konto_werden_geloescht():
    store = kunden()
    deleted = privacy.delete_stale_customers(FakeDb(store), now=NOW, accounts=lambda ids: {"kontoEva"} & set(ids))
    assert deleted == 2
    assert set(store["customers"]) == {"stamm", "verbunden", "frisch"}
    assert store["appointments"]["a1"]["customerName"] == ANONYMIZED_NAME  # falls der 90-Tage-Lauf ihn nicht hatte
    assert store["appointments"]["s1"]["customerName"] == "Stamm"


def laden():
    return {
        "shops": {"laden1": {"name": "Barbershop Kaya", "owner": "inhaber"}, "laden2": {"name": "Anderer", "owner": "fremd"}},
        "staff": {"st1": {"shopId": "laden1", "userId": "mitarbeiter"}, "st2": {"shopId": "laden2", "userId": "fremdteam"}},
        "users": {"kontoEva": {"role": "customer"}, "inhaber": {"role": "shopOwner"}},
        "customers": {
            "kunde1": {"shopId": "laden1", "name": "Max", "email": "max@example.com", "phone": "0170"},
            "evaEintrag": {"shopId": "laden1", "name": "Eva", "email": "eva@example.com", "userId": "kontoEva"},
            "evaWoanders": {"shopId": "laden2", "name": "Eva", "email": "eva@example.com", "userId": "kontoEva"},
        },
        "appointments": {
            "m_alt": {"shopId": "laden1", "customerId": "kunde1", "customerName": "Max", "status": "completed", "startTime": days_ago(3)},
            "m_neu": {"shopId": "laden1", "customerId": "kunde1", "customerName": "Max", "status": "scheduled", "startTime": NOW + timedelta(days=2)},
            "e_alt": {"shopId": "laden1", "customerId": "kontoEva", "customerName": "Eva", "status": "completed", "startTime": days_ago(3), "notifyEmail": "eva@example.com"},
            "e_neu": {"shopId": "laden1", "customerId": "kontoEva", "customerName": "Eva", "status": "scheduled", "startTime": NOW + timedelta(hours=2)},
            "fremd": {"shopId": "laden1", "customerId": "walk-in", "customerName": "Herr Meier", "status": "scheduled", "startTime": NOW + timedelta(hours=1)},
        },
        "push_subscriptions": {"p1": {"appointmentId": "e_neu"}, "p2": {"appointmentId": "fremd"}},
        "earlier_slot_notifications": {"o1": {"userId": "kontoEva"}, "o2": {"userId": "jemand"}},
        "queue": {"q1": {"customerId": "kontoEva", "shopId": "laden1"}},
    }


def test_laden_loescht_kunden_ohne_konto():
    store = laden()
    ref = Ref(FakeDb(store), "customers", "kunde1")
    result = privacy.forget_customer(FakeDb(store), ref, store["customers"]["kunde1"], now=NOW)
    a = store["appointments"]
    assert result == {"anonymized": 2, "cancelled": 1}
    assert "kunde1" not in store["customers"]
    assert a["m_alt"]["customerName"] == ANONYMIZED_NAME and a["m_alt"]["status"] == "completed"
    assert a["m_neu"]["customerName"] == ANONYMIZED_NAME and a["m_neu"]["status"] == "cancelled"
    assert a["fremd"]["customerName"] == "Herr Meier" and a["fremd"]["status"] == "scheduled"


def test_laden_loescht_verbundenen_kunden_termine_bleiben_beim_konto():
    store = laden()
    ref = Ref(FakeDb(store), "customers", "evaEintrag")
    assert privacy.forget_customer(FakeDb(store), ref, store["customers"]["evaEintrag"], now=NOW) == {"anonymized": 0, "cancelled": 0}
    assert "evaEintrag" not in store["customers"]
    assert store["appointments"]["e_neu"]["customerName"] == "Eva"


def test_konto_loeschen_raeumt_alles_ab():
    store = laden()
    result = privacy.delete_account_data(FakeDb(store), "kontoEva", now=NOW)
    a = store["appointments"]
    assert result == {"anonymized": 2, "cancelled": 1, "customerEntries": 2}
    assert a["e_alt"]["customerName"] == ANONYMIZED_NAME and a["e_alt"]["notifyEmail"] is None
    assert a["e_neu"]["status"] == "cancelled" and a["e_neu"]["customerName"] == ANONYMIZED_NAME
    assert a["m_neu"]["customerName"] == "Max" and a["fremd"]["status"] == "scheduled"
    assert set(store["push_subscriptions"]) == {"p2"}
    assert set(store["earlier_slot_notifications"]) == {"o2"}
    assert store["queue"] == {}
    assert set(store["customers"]) == {"kunde1"}
    assert set(store["users"]) == {"inhaber"}


# --- Endpunkte ----------------------------------------------------------------------------------


def client(store, uid):
    import firebase_admin.auth as fb_auth

    import app.apis.datenschutz as api
    import app.apis.firebase_utils as fu
    from databutton_app.mw.auth_mw import get_authorized_user

    db = FakeDb(store)
    api.get_firestore_db = lambda: db
    fu.get_firestore_db = lambda: db  # owned_shop_ids in app/auth/access.py
    fu.get_firebase_app = lambda: None
    store.setdefault("_deleted_accounts", [])
    fb_auth.delete_user = lambda u, app=None: store["_deleted_accounts"].append(u)
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=f"{uid}@example.com")
    return TestClient(app)


def test_inhaber_und_team_duerfen_kunden_loeschen():
    for uid in ("inhaber", "mitarbeiter"):
        store = laden()
        r = client(store, uid).delete("/routes/datenschutz/kunde/kunde1")
        assert r.status_code == 200, (uid, r.text)
        assert "kunde1" not in store["customers"]


def test_fremde_duerfen_keine_kunden_loeschen():
    for uid in ("fremd", "fremdteam", "kontoEva"):
        store = laden()
        assert client(store, uid).delete("/routes/datenschutz/kunde/kunde1").status_code == 403, uid
        assert "kunde1" in store["customers"]
    assert client(laden(), "inhaber").delete("/routes/datenschutz/kunde/gibtsnicht").status_code == 404
    assert client(laden(), "inhaber").delete("/routes/datenschutz/kunde/a.b").status_code == 404


def test_deaktivierte_duerfen_keine_kunden_loeschen():
    store = laden()
    store["staff"]["st1"]["isActive"] = False
    assert client(store, "mitarbeiter").delete("/routes/datenschutz/kunde/kunde1").status_code == 403
    assert "kunde1" in store["customers"]


def test_kunde_loescht_eigenes_konto():
    store = laden()
    r = client(store, "kontoEva").delete("/routes/datenschutz/konto")
    assert r.status_code == 200, r.text
    assert store["_deleted_accounts"] == ["kontoEva"]
    assert "kontoEva" not in store["users"]


def test_laden_und_team_konten_nur_per_mail():
    for uid in ("inhaber", "mitarbeiter"):
        store = laden()
        r = client(store, uid).delete("/routes/datenschutz/konto")
        assert r.status_code == 409 and privacy.DATENSCHUTZ_KONTAKT in r.json()["detail"], uid
        assert store["_deleted_accounts"] == [] and set(store["users"]) == {"kontoEva", "inhaber"}


def test_kontakt_wie_in_der_datenschutzerklaerung():
    legal = (ROOT / "frontend/src/constants/legal.ts").read_text(encoding="utf-8")
    assert re.search(r"email: '([^']+)'", legal).group(1) == privacy.DATENSCHUTZ_KONTAKT
    hilfe = (ROOT / "backend/app/hilfe/artikel/datenschutz.md").read_text(encoding="utf-8")
    assert privacy.DATENSCHUTZ_KONTAKT in hilfe


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
