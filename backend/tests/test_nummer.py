"""
Tests für die Nummer ohne Konto: öffentliche Kurzfassung (app/libs/public_appointments.py), Zurückgeben und Übernehmen
mit dem Schlüssel (app/apis/nummer), Benachrichtigungen nur mit Schlüssel oder eigenem Konto (app/apis/push) und den
Umzug der Kontaktdaten des Teams (app/libs/staff_contacts.py). Ohne Firebase und ohne pytest lauffähig:

    cd backend && .venv/bin/python tests/test_nummer.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402

from app.libs import public_appointments as pa  # noqa: E402
from app.libs.links import token_hash, token_matches  # noqa: E402
from app.libs.schedule import BERLIN, day_key  # noqa: E402

KEY = "Schluessel-der-Nummer-1234567890"
START = (datetime.now(BERLIN) + timedelta(hours=2)).replace(second=0, microsecond=0).astimezone(timezone.utc)
END = START + timedelta(minutes=30)
DAY = day_key(START)


# --- nachgebaute Datenbank mit Transaktionen (wie tests/test_accept_slot.py) ---------------------

class Snap:
    def __init__(self, ref, data):
        self.reference, self.id, self._data = ref, ref.id, data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class Ref:
    def __init__(self, db, coll, doc_id):
        self.db, self.coll, self.id = db, coll, doc_id

    def _docs(self):
        return self.db.store.setdefault(self.coll, {})

    def get(self, transaction=None):
        if transaction is not None:
            assert not transaction.writes, "Firestore: erst lesen, dann schreiben"
        data = self._docs().get(self.id)
        return Snap(self, dict(data) if data is not None else None)

    def collection(self, name):
        return Query(self.db, f"{self.coll}/{self.id}/{name}")

    def set(self, data, merge=False):
        doc = dict(self._docs().get(self.id) or {}) if merge else {}
        for k, v in data.items():
            if v is gcf.DELETE_FIELD:
                doc.pop(k, None)
            else:
                doc[k] = v
        self._docs()[self.id] = doc

    def update(self, data):
        doc = self._docs()[self.id]
        for k, v in data.items():
            if v is gcf.DELETE_FIELD:
                doc.pop(k, None)
            else:
                doc[k] = v

    def delete(self):
        self._docs().pop(self.id, None)


class Query:
    def __init__(self, db, coll, filters=()):
        self.db, self.coll, self.filters = db, coll, list(filters)

    def where(self, field, op, value):
        assert op == "=="
        return Query(self.db, self.coll, self.filters + [(field, value)])

    def limit(self, _n):
        return self

    def stream(self):
        for doc_id, data in list(self.db.store.get(self.coll, {}).items()):
            if all(data.get(f) == v for f, v in self.filters):
                yield Snap(Ref(self.db, self.coll, doc_id), dict(data))

    def document(self, doc_id):
        return Ref(self.db, self.coll, doc_id)


class Writes:
    """Transaktion oder Batch: Schreibvorgänge erst am Ende"""

    def __init__(self):
        self.writes = []

    def set(self, ref, data, merge=False):
        self.writes.append(lambda: ref.set(data, merge=merge))

    def update(self, ref, data):
        self.writes.append(lambda: ref.update(data))

    def delete(self, ref):
        self.writes.append(ref.delete)

    def commit(self):
        for write in self.writes:
            write()


class Db:
    def __init__(self, store):
        self.store = store

    def collection(self, name):
        return Query(self, name)

    def transaction(self):
        return Writes()

    def batch(self):
        return Writes()


def transactional(fn):
    def run(tx):
        result = fn(tx)
        tx.commit()
        return result

    return run


def ticket(**extra):
    """Nummer ohne Konto, wie sie die App zieht (QueueBookingService) – mit Name und Handynummer"""
    return {
        "shopId": "laden1", "staffId": "robin", "serviceId": "schnitt", "type": "queue", "status": "scheduled",
        "startTime": START, "endTime": END, "isAnonymous": True, "referenceCode": "42", "customerName": "Kim",
        "customerPhone": "0170 123", "ticketKeyHash": token_hash(KEY), **extra,
    }


def store_with(appt=None):
    appt = appt or ticket()
    return {
        "appointments": {"t1": appt},
        "public_appointments": {"t1": pa.public_view(appt)},
        "schedules": {f"robin_{DAY}": {"shopId": "laden1", "staffId": "robin", "day": DAY, "slots": {"t1": {"start": START, "end": END}}}},
        "shops": {"laden1": {"name": "Barbershop Kaya", "owner": "inhaber"}},
        "users": {"konto1": {"uid": "konto1", "displayName": "Kim Muster", "email": "kim@example.com"}},
    }


def nummer_client(store, uid=None):
    import app.apis.check_slots as cs
    import app.apis.nummer as api
    from databutton_app.mw.auth_mw import get_authorized_user
    from fastapi import HTTPException

    db = Db(store)
    api.get_firestore_db = lambda: db
    api.firestore.transactional = transactional
    store.setdefault("_checks", [])
    cs.trigger_check_in_background = lambda shop_id=None, staff_id=None: store["_checks"].append((shop_id, staff_id))
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")

    def user():
        if not uid:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return type("User", (), {"sub": uid, "email": f"{uid}@example.com"})()

    app.dependency_overrides[get_authorized_user] = user
    return TestClient(app)


# --- Kurzfassung ---------------------------------------------------------------------------------

def test_kurzfassung_ohne_personendaten():
    view = pa.public_view(ticket(customerId=None, notifyEmail="kim@example.com", price=20, checkEarlierOptions=True))
    assert set(view) <= set(pa.PUBLIC_FIELDS) | {"staffDay", "shopDay"}
    for private in ("customerName", "customerPhone", "customerId", "notifyEmail", "ticketKeyHash", "price"):
        assert private not in view
    assert view["staffDay"] == f"robin_{DAY}" and view["shopDay"] == f"laden1_{DAY}"
    assert view["referenceCode"] == "42" and view["isAnonymous"] is True and view["status"] == "scheduled"


def test_kurzfassung_tag_nach_deutscher_zeit():
    # 23:30 deutscher Zeit ist in UTC schon/noch ein anderer Tag – zählen soll der deutsche
    late = datetime(2026, 10, 23, 23, 30, tzinfo=BERLIN).astimezone(timezone.utc)
    assert pa.public_view(ticket(startTime=late))["staffDay"] == "robin_2026-10-23"
    assert pa.public_view(None) is None


def test_abgleich_beim_ersten_start():
    store = store_with()
    store["appointments"]["t2"] = ticket(referenceCode="43")
    store["public_appointments"]["t1"]["status"] = "in-progress"  # abweichend
    store["public_appointments"]["weg"] = {"shopId": "laden1", "status": "scheduled"}  # Termin gibt es nicht mehr
    result = pa.backfill_all(Db(store))
    assert result == {"geschrieben": 2, "entfernt": 1}
    assert store["public_appointments"]["t1"]["status"] == "scheduled"
    assert store["public_appointments"]["t2"]["referenceCode"] == "43"
    assert "weg" not in store["public_appointments"]


# --- Zurückgeben ---------------------------------------------------------------------------------

def test_zurueckgeben_mit_schluessel():
    store = store_with()
    r = nummer_client(store).post("/routes/nummer/absagen", json={"appointment_id": "t1", "key": KEY})
    assert r.status_code == 200, r.text
    assert store["appointments"]["t1"]["status"] == "cancelled"
    assert store["public_appointments"]["t1"]["status"] == "cancelled"
    assert "t1" not in store["schedules"][f"robin_{DAY}"]["slots"]  # Platz ist frei
    assert store["_checks"] == [("laden1", "robin")]  # „Früher dran“ verteilt gleich neu
    # zweimal schadet nicht
    assert nummer_client(store).post("/routes/nummer/absagen", json={"appointment_id": "t1", "key": KEY}).status_code == 200


def test_zurueckgeben_ohne_passenden_schluessel_abgelehnt():
    for appt in (ticket(), ticket(ticketKeyHash=None), ticket(isAnonymous=False, customerId="konto1")):
        store = store_with(appt)
        for key in ("falscher-schluessel-123456", KEY):
            if appt.get("ticketKeyHash") and key == KEY and appt.get("isAnonymous"):
                continue
            r = nummer_client(store).post("/routes/nummer/absagen", json={"appointment_id": "t1", "key": key})
            assert r.status_code == 403, (appt, key, r.text)
            assert store["appointments"]["t1"]["status"] == "scheduled"
    r = nummer_client(store_with()).post("/routes/nummer/absagen", json={"appointment_id": "gibtsnicht", "key": KEY})
    assert r.status_code == 404
    # Ohne Schlüssel und ohne Anmeldung: nicht erlaubt (mit Konto: tests/test_nummer_ziehen.py)
    r = nummer_client(store_with()).post("/routes/nummer/absagen", json={"appointment_id": "t1"})
    assert r.status_code == 403


def test_schon_dran_nicht_zurueckgeben():
    store = store_with(ticket(status="in-progress"))
    r = nummer_client(store).post("/routes/nummer/absagen", json={"appointment_id": "t1", "key": KEY})
    assert r.status_code == 409 and store["appointments"]["t1"]["status"] == "in-progress"


# --- Übernehmen ----------------------------------------------------------------------------------

def test_uebernehmen_ins_konto():
    store = store_with()
    r = nummer_client(store, uid="konto1").post("/routes/nummer/uebernehmen", json={"appointment_id": "t1", "key": KEY})
    assert r.status_code == 200, r.text
    appt = store["appointments"]["t1"]
    assert appt["customerId"] == "konto1" and appt["customerName"] == "Kim Muster" and appt["isAnonymous"] is False
    assert appt["customerPhone"] == "0170 123"  # bleibt für den Tresen
    public = store["public_appointments"]["t1"]
    assert public["isAnonymous"] is False and "customerId" not in public and "customerName" not in public
    # danach gehört sie dem Konto: ein zweites Konto übernimmt sie nicht mehr
    assert nummer_client(store, uid="konto2").post("/routes/nummer/uebernehmen", json={"appointment_id": "t1", "key": KEY}).status_code == 403


def test_uebernehmen_nur_angemeldet_und_mit_schluessel():
    store = store_with()
    assert nummer_client(store).post("/routes/nummer/uebernehmen", json={"appointment_id": "t1", "key": KEY}).status_code == 401
    r = nummer_client(store, uid="konto1").post("/routes/nummer/uebernehmen", json={"appointment_id": "t1", "key": "falscher-schluessel-123456"})
    assert r.status_code == 403
    assert "customerId" not in store["appointments"]["t1"]


# --- Benachrichtigungen --------------------------------------------------------------------------

def push_client(store, uid=None):
    import app.apis.push as push

    db = Db(store)
    push.get_firestore_db = lambda: db
    push.mail_configured = lambda: True
    push.push_configured = lambda: True
    push._require_notifications = lambda shop_id: None
    push.wake = lambda: None
    push.request_uid = lambda request: uid
    app = FastAPI()
    app.include_router(push.router, prefix="/routes")
    return TestClient(app)


def test_email_nur_mit_schluessel_oder_eigenem_konto():
    store = store_with()
    body = {"appointment_id": "t1", "email": "kim@example.com"}
    assert push_client(store).post("/routes/push/notify-email", json=body).status_code == 403
    assert push_client(store, uid="fremd").post("/routes/push/notify-email", json=body).status_code == 403
    assert "notifyEmail" not in store["appointments"]["t1"]
    assert push_client(store).post("/routes/push/notify-email", json={**body, "key": KEY}).status_code == 200
    assert store["appointments"]["t1"]["notifyEmail"] == "kim@example.com"
    assert "notifyEmail" not in store["public_appointments"]["t1"]

    own = store_with(ticket(isAnonymous=False, customerId="konto1", ticketKeyHash=None))
    assert push_client(own, uid="konto1").post("/routes/push/notify-email", json=body).status_code == 200


def test_push_anmelden_nur_mit_schluessel():
    store = store_with()
    sub = {"appointment_id": "t1", "endpoint": "https://push.example.com/abc", "p256dh": "p" * 20, "auth": "a" * 10}
    assert push_client(store).post("/routes/push/subscribe", json=sub).status_code == 403
    assert push_client(store).post("/routes/push/subscribe", json={**sub, "key": KEY}).status_code == 200
    assert len(store["push_subscriptions"]) == 1


def test_push_und_email_merken_sich_die_sprache():
    """Die zuletzt gewählte Sprache steht an der Anmeldung und am Termin; ohne Angabe gilt Accept-Language."""
    store = store_with()
    sub = {"appointment_id": "t1", "key": KEY, "endpoint": "https://push.example.com/abc", "p256dh": "p" * 20, "auth": "a" * 10}
    assert push_client(store).post("/routes/push/subscribe", json={**sub, "language": "tr"}).status_code == 200
    assert [s["language"] for s in store["push_subscriptions"].values()] == ["tr"]
    assert store["appointments"]["t1"]["language"] == "tr"
    assert "language" not in store["public_appointments"]["t1"]
    other = {**sub, "endpoint": "https://push.example.com/zweites-geraet"}
    assert push_client(store).post("/routes/push/subscribe", json=other, headers={"Accept-Language": "ar,en;q=0.5"}).status_code == 200
    assert sorted(s["language"] for s in store["push_subscriptions"].values()) == ["ar", "tr"]
    body = {"appointment_id": "t1", "key": KEY, "email": "kim@example.com", "language": "en"}
    assert push_client(store).post("/routes/push/notify-email", json=body).status_code == 200
    assert store["appointments"]["t1"]["language"] == "en"
    # Unbekanntes wird Deutsch, Abmelden der E-Mail ändert die Sprache nicht
    assert push_client(store).post("/routes/push/notify-email", json={**body, "language": "xx"}).status_code == 200
    assert store["appointments"]["t1"]["language"] == "de"
    assert push_client(store).post("/routes/push/notify-email", json={**body, "email": None, "language": "tr"}).status_code == 200
    assert store["appointments"]["t1"]["language"] == "de"


# --- Schlüssel, Kontaktdaten des Teams -----------------------------------------------------------

def test_schluessel_vergleich():
    assert token_matches(token_hash(KEY), KEY)
    assert not token_matches(token_hash(KEY), "anders")
    assert not token_matches(None, KEY) and not token_matches(token_hash(KEY), None) and not token_matches("", "")


def test_kontaktdaten_ziehen_um():
    from app.libs.staff_contacts import contact_of, migrate

    store = {
        "staff": {
            "robin": {"shopId": "laden1", "name": "Robin", "email": "robin@salon.de", "phone": "0171", "inviteEmailTo": "robin@salon.de"},
            "alex": {"shopId": "laden1", "name": "Alex", "email": "", "phone": ""},
            "neu": {"shopId": "laden1", "name": "Neu"},
        },
    }
    db = Db(store)
    assert migrate(db) == 2
    assert store["staff"]["robin"] == {"shopId": "laden1", "name": "Robin"}
    assert store["staff"]["alex"] == {"shopId": "laden1", "name": "Alex"}
    contacts = store["shops/laden1/staff_contacts"]
    assert contacts["robin"]["email"] == "robin@salon.de" and contacts["robin"]["phone"] == "0171"
    assert contacts["robin"]["inviteEmailTo"] == "robin@salon.de"
    assert "alex" not in contacts  # nichts umzuziehen, nur die leeren Felder weg
    assert contact_of(db, "robin", store["staff"]["robin"])["email"] == "robin@salon.de"
    assert migrate(db) == 0


# --- Nachrichten an das Team: Kunde zieht, bucht, sagt ab (app/libs/team_notify.py) ------------------

def test_zurueckgeben_meldet_dem_team():
    store = store_with()
    assert nummer_client(store).post("/routes/nummer/absagen", json={"appointment_id": "t1", "key": KEY}).status_code == 200
    appt = store["appointments"]["t1"]
    assert appt["teamNotice"] == "cancelled" and appt["teamCancelledAt"]
    # Merker sind privat
    assert not any(k.startswith("team") for k in store["public_appointments"]["t1"])


def test_team_ereignis_nur_mit_schluessel_oder_eigenem_konto():
    now = datetime.now(timezone.utc)
    store = store_with(ticket(createdAt=now))
    body = {"appointment_id": "t1", "kind": "new"}
    assert push_client(store).post("/routes/push/team-event", json=body).status_code == 404
    assert "teamNotice" not in store["appointments"]["t1"]
    assert push_client(store).post("/routes/push/team-event", json={**body, "key": KEY}).json() == {"status": "ok"}
    assert store["appointments"]["t1"]["teamNotice"] == "new"
    # Zweimal melden: keine zweite Nachricht
    assert push_client(store).post("/routes/push/team-event", json={**body, "key": KEY}).json() == {"status": "ignored"}

    own = store_with(ticket(isAnonymous=False, customerId="konto1", ticketKeyHash=None, type="booked", createdAt=now))
    assert push_client(own, uid="fremd").post("/routes/push/team-event", json=body).status_code == 404
    assert push_client(own, uid="konto1").post("/routes/push/team-event", json=body).json() == {"status": "ok"}


def test_team_ereignis_nur_frisch_und_passend():
    now = datetime.now(timezone.utc)
    old = store_with(ticket(createdAt=now - timedelta(hours=1)))
    body = {"appointment_id": "t1", "kind": "new", "key": KEY}
    assert push_client(old).post("/routes/push/team-event", json=body).json() == {"status": "ignored"}
    # Absage nur, wenn der Termin wirklich gerade abgesagt ist
    store = store_with(ticket(createdAt=now, updatedAt=now))
    cancel = {**body, "kind": "cancelled"}
    assert push_client(store).post("/routes/push/team-event", json=cancel).json() == {"status": "ignored"}
    store["appointments"]["t1"].update(status="cancelled", teamNoticeSentAt=now, teamNewAt=now)
    assert push_client(store).post("/routes/push/team-event", json=cancel).json() == {"status": "ok"}
    assert store["appointments"]["t1"]["teamNotice"] == "cancelled"


def team_client(store, uid):
    import app.apis.team_push as api
    from databutton_app.mw.auth_mw import get_authorized_user

    api.get_firestore_db = lambda: Db(store)
    api.push_configured = lambda: True
    api.fcm_configured = lambda: True
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: type("User", (), {"sub": uid, "email": f"{uid}@example.com"})()
    return TestClient(app)


def test_team_geraet_anmelden_fuer_alle_laeden_des_kontos():
    store = store_with()
    store["shops"]["laden2"] = {"name": "Zweiter Laden", "owner": "jemand"}
    store["shops"]["laden3"] = {"name": "Ehemals", "owner": "jemand"}
    store["staff"] = {
        "robin": {"shopId": "laden1", "userId": "konto-robin", "name": "Robin"},
        "robin2": {"shopId": "laden2", "userId": "konto-robin", "name": "Robin"},
        "robin3": {"shopId": "laden3", "userId": "konto-robin", "name": "Robin", "isActive": False},
    }
    device = {"endpoint": "https://push.example.com/geraet", "p256dh": "p" * 20, "auth": "a" * 10}
    r = team_client(store, "konto-robin").post("/routes/team-push/subscribe", json={**device, "events": {"absage": False}, "language": "tr"})
    assert r.status_code == 200, r.text
    subs = sorted(store["team_push_subscriptions"].values(), key=lambda s: s["shopId"])
    assert [(s["shopId"], s["staffId"]) for s in subs] == [("laden1", "robin"), ("laden2", "robin2")]
    assert subs[0]["events"] == {"nummer": True, "buchung": True, "absage": False} and subs[0]["language"] == "tr"
    # Inhaber: eigener Laden ohne Eintrag im Team; App mit Token
    app_device = {"token": "fcm-token-iphone-1234567890", "platform": "ios"}
    assert team_client(store, "inhaber").post("/routes/team-push/subscribe", json=app_device).status_code == 200
    owner = [s for s in store["team_push_subscriptions"].values() if s["uid"] == "inhaber"]
    assert [(s["shopId"], s["staffId"], s["token"]) for s in owner] == [("laden1", None, "fcm-token-iphone-1234567890")]
    # Nicht mehr im Team: beim nächsten Auffrischen dort abgemeldet
    store["staff"]["robin2"]["isActive"] = False
    assert team_client(store, "konto-robin").post("/routes/team-push/subscribe", json=device).status_code == 200
    assert sorted(s["shopId"] for s in store["team_push_subscriptions"].values() if s["uid"] == "konto-robin") == ["laden1"]
    # Abmelden nimmt nur das eigene Gerät dieses Kontos weg
    assert team_client(store, "konto-robin").post("/routes/team-push/unsubscribe", json=device).status_code == 200
    assert [s["uid"] for s in store["team_push_subscriptions"].values()] == ["inhaber"]


def test_team_geraet_nur_mit_laden_und_tarif():
    store = store_with()
    device = {"endpoint": "https://push.example.com/geraet", "p256dh": "p" * 20, "auth": "a" * 10}
    assert team_client(store, "kundin").post("/routes/team-push/subscribe", json=device).status_code == 403
    store["shops"]["laden1"]["trialEndsAt"] = datetime.now(timezone.utc) - timedelta(days=1)
    assert team_client(store, "inhaber").post("/routes/team-push/subscribe", json=device).status_code == 403
    assert "team_push_subscriptions" not in store or not store["team_push_subscriptions"]
    store["shops"]["laden1"]["trialEndsAt"] = datetime.now(timezone.utc) + timedelta(days=1)
    bad = {**device, "endpoint": "http://unsicher.example.com/x"}
    assert team_client(store, "inhaber").post("/routes/team-push/subscribe", json=bad).status_code == 400


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
