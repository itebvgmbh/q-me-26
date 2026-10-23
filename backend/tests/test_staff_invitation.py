"""
Tests für die Team-Einladung (/staff-registration): Inhaber erzeugt Link oder E-Mail, die Person nimmt an.
Ohne Firebase lauffähig (Datenbank nachgebildet):

    cd backend && .venv/bin/python tests/test_staff_invitation.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from google.cloud import firestore as gcf  # noqa: E402

NOW = datetime.now(timezone.utc)


def _value(v):
    return "ZEIT" if v is gcf.SERVER_TIMESTAMP else v


class Ref:
    def __init__(self, db, coll, doc_id):
        self.db, self.coll, self.id = db, coll, doc_id

    def get(self):
        return Snap(self, self.db.data[self.coll].get(self.id))

    def collection(self, name):
        return self.db.collection(f"{self.coll}/{self.id}/{name}")

    def set(self, values, merge=False):
        doc = self.db.data[self.coll].get(self.id) if merge else None
        doc = dict(doc or {})
        for k, v in values.items():
            if v is gcf.DELETE_FIELD:
                doc.pop(k, None)
            else:
                doc[k] = _value(v)
        self.db.data[self.coll][self.id] = doc

    def update(self, values):
        doc = self.db.data[self.coll][self.id]
        for k, v in values.items():
            if v is gcf.DELETE_FIELD:
                doc.pop(k, None)
            else:
                doc[k] = _value(v)


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


class FakeDb:
    def __init__(self, data):
        self.data = data

    def collection(self, name):
        self.data.setdefault(name, {})
        return Query(self, name)


def data(**person):
    return {
        "shops": {"laden1": {"name": "Barbershop Kaya", "owner": "inhaber"}, "laden2": {"name": "Zweitladen", "owner": "inhaber2"}},
        "staff": {
            "p1": {"shopId": "laden1", "name": "Robin", "email": "robin@salon-kaya.de", "userId": "", "isActive": True, **person},
            "chef": {"shopId": "laden1", "name": "Chef", "email": "chef@example.com", "userId": "inhaber", "isActive": True},
        },
        "users": {},
    }


def client(store, uid="kontoRobin", mails=None, mail_result=True):
    import app.apis.firebase_utils as fu
    import app.apis.staff_invitation as api
    import app.auth.access as access
    from databutton_app.mw.auth_mw import get_authorized_user
    from app.libs.mail import MailError

    db = FakeDb(store)
    api.get_firestore_db = lambda: db
    fu.get_firestore_db = lambda: db
    access.is_admin = lambda _u: False

    def fake_send(to, subject, html, text=""):
        if mail_result == "fehler":
            raise MailError("Resend lehnt ab (403)")
        if mails is not None:
            mails.append({"to": to, "subject": subject, "html": html, "text": text})
        return mail_result

    api.send_mail = fake_send
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    if uid:
        app.dependency_overrides[get_authorized_user] = lambda: type("User", (), {"sub": uid, "email": f"{uid}@example.com"})()
    return TestClient(app)


def invite(store, send_email=False, **kw):
    """Als Inhaber einen Link für Robin erzeugen; Rückgabe (Antwort, Token)"""
    r = client(store, uid="inhaber", **kw).post(
        "/routes/staff-invitation", json={"staff_id": "p1", "send_email": send_email}, headers={"Origin": "https://q-me.spielmacherei.de"}
    )
    assert r.status_code == 200, r.text
    link = r.json()["link"]
    return r.json(), parse_qs(urlparse(link).query)["token"][0]


def test_link_erzeugen_speichert_nur_hash():
    store = data()
    body, token = invite(store)
    assert body["link"].startswith("https://q-me.spielmacherei.de/staff-registration?token=")
    assert body["email_sent"] is False and body["email_problem"] == ""
    p1 = store["staff"]["p1"]
    assert token not in str(p1), "Token im Klartext gespeichert"
    import app.apis.staff_invitation as api

    assert p1["inviteTokenHash"] == api.token_hash(token)
    assert abs((p1["inviteExpires"] - NOW) - timedelta(days=api.VALID_DAYS)) < timedelta(minutes=1)


def test_fremde_adresse_wird_nicht_in_den_link_uebernommen():
    store = data()
    r = client(store, uid="inhaber").post("/routes/staff-invitation", json={"staff_id": "p1"}, headers={"Origin": "https://boese.example"})
    assert r.json()["link"].startswith("https://dranzeit.de/staff-registration?token=")


def test_neuer_link_ersetzt_den_alten():
    store = data()
    _, alt = invite(store)
    _, neu = invite(store)
    c = client(store, uid=None)
    assert c.get(f"/routes/staff-invitation/{alt}").status_code == 404
    assert c.get(f"/routes/staff-invitation/{neu}").json()["status"] == "offen"


def test_nur_der_inhaber_darf_einladen():
    store = data()
    r = client(store, uid="inhaber2").post("/routes/staff-invitation", json={"staff_id": "p1"})
    assert r.status_code == 403
    assert "inviteTokenHash" not in store["staff"]["p1"]


def test_kein_link_fuer_verbundene_oder_deaktivierte():
    assert client(data(userId="jemand"), uid="inhaber").post("/routes/staff-invitation", json={"staff_id": "p1"}).status_code == 409
    assert client(data(isActive=False), uid="inhaber").post("/routes/staff-invitation", json={"staff_id": "p1"}).status_code == 409


def test_email_wird_verschickt_und_vermerkt():
    store, mails = data(), []
    body, token = invite(store, send_email=True, mails=mails)
    assert body["email_sent"] is True and body["email_problem"] == ""
    assert len(mails) == 1 and mails[0]["to"] == "robin@salon-kaya.de"
    assert "Barbershop Kaya" in mails[0]["subject"] and token in mails[0]["html"] and token in mails[0]["text"]
    # Die Adresse steht bei den Kontaktdaten des Ladens (nur Inhaber), nicht am öffentlichen Eintrag
    assert store["shops/laden1/staff_contacts"]["p1"]["inviteEmailTo"] == "robin@salon-kaya.de"
    assert "inviteEmailTo" not in store["staff"]["p1"] and store["staff"]["p1"]["inviteEmailSentAt"] == "ZEIT"


def test_email_aus_den_kontaktdaten():
    """Neuer Aufbau: E-Mail nur bei den Kontaktdaten (app/libs/staff_contacts.py), nicht am Eintrag"""
    store, mails = data(), []
    del store["staff"]["p1"]["email"]
    store["shops/laden1/staff_contacts"] = {"p1": {"email": "robin@salon-kaya.de"}}
    body, token = invite(store, send_email=True, mails=mails)
    assert body["email_sent"] is True and mails[0]["to"] == "robin@salon-kaya.de"
    assert client(store, uid=None).get(f"/routes/staff-invitation/{token}").json()["email"] == "robin@salon-kaya.de"
    assert "email" not in store["staff"]["p1"]


def test_email_ohne_versand_ist_ehrlich():
    store = data()
    body, _ = invite(store, send_email=True, mail_result=False)
    assert body["email_sent"] is False and "nicht eingerichtet" in body["email_problem"]
    assert "inviteEmailSentAt" not in store["staff"]["p1"]
    body, token = invite(store, send_email=True, mail_result="fehler")
    assert body["email_sent"] is False and "nicht verschickt" in body["email_problem"]
    # Der Link gilt trotzdem und lässt sich von Hand weitergeben
    assert client(store, uid=None).get(f"/routes/staff-invitation/{token}").json()["status"] == "offen"


def test_keine_mail_an_testadressen():
    store, mails = data(email="kim@example.com"), []
    body, token = invite(store, send_email=True, mails=mails)
    assert mails == [] and body["email_sent"] is False and "Testadressen" in body["email_problem"]
    assert client(store, uid=None).get(f"/routes/staff-invitation/{token}").json()["status"] == "offen"


def test_email_ohne_adresse():
    r = client(data(email=""), uid="inhaber").post("/routes/staff-invitation", json={"staff_id": "p1", "send_email": True})
    assert r.status_code == 400 and "Adresse" in r.json()["detail"]


def test_info_ohne_anmeldung():
    store = data()
    _, token = invite(store)
    r = client(store, uid=None).get(f"/routes/staff-invitation/{token}")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "offen", "shopName": "Barbershop Kaya", "name": "Robin", "email": "robin@salon-kaya.de"}
    assert client(store, uid=None).get("/routes/staff-invitation/kurz").status_code == 404


def test_altes_einladungstoken_gilt_nicht():
    store = data()
    store["staff-invitations"] = {"alt": {"token": "altertokenaltertoken", "email": "robin@salon-kaya.de", "shopId": "laden1"}}
    assert client(store, uid=None).get("/routes/staff-invitation/altertokenaltertoken").status_code == 404


def test_annehmen_verbindet_genau_diesen_eintrag():
    store = data()
    _, token = invite(store)
    r = client(store).post(f"/routes/staff-invitation/{token}")
    assert r.status_code == 200, r.text
    assert r.json() == {"shopName": "Barbershop Kaya", "staffId": "p1"}
    assert store["staff"]["p1"]["userId"] == "kontoRobin"
    assert store["users"]["kontoRobin"]["role"] == "employee"
    # Team-Vermerk für die Firestore-Regeln (app/libs/team.py)
    assert store["shops/laden1/members"]["kontoRobin"]["staffId"] == "p1"
    assert client(store, uid=None).get(f"/routes/staff-invitation/{token}").json()["status"] == "verbunden"
    # zweimal annehmen schadet nicht, ein anderes Konto kann nicht übernehmen
    assert client(store).post(f"/routes/staff-invitation/{token}").status_code == 200
    assert client(store, uid="fremd").post(f"/routes/staff-invitation/{token}").status_code == 409
    assert store["staff"]["p1"]["userId"] == "kontoRobin"


def test_andere_email_beim_konto_ist_erlaubt():
    """Der Link zählt, nicht die E-Mail: Robin nimmt mit einer anderen Adresse an"""
    store = data(email="")
    _, token = invite(store)
    assert client(store, uid="robinPrivat").post(f"/routes/staff-invitation/{token}").status_code == 200
    assert store["staff"]["p1"]["userId"] == "robinPrivat"
    # leere Adresse wird ergänzt – bei den Kontaktdaten, nicht am öffentlichen Eintrag
    assert store["shops/laden1/staff_contacts"]["p1"]["email"] == "robinPrivat@example.com"
    assert store["staff"]["p1"]["email"] == ""


def test_kundenkonto_wird_mitarbeiterkonto():
    store = data()
    store["users"]["kontoRobin"] = {"uid": "kontoRobin", "role": "customer", "email": "robin@salon-kaya.de"}
    _, token = invite(store)
    assert client(store).post(f"/routes/staff-invitation/{token}").status_code == 200
    assert store["users"]["kontoRobin"]["role"] == "employee"


def test_inhaber_eines_anderen_ladens_bleibt_inhaber():
    store = data()
    store["users"]["inhaber2"] = {"uid": "inhaber2", "role": "shopOwner"}
    _, token = invite(store)
    assert client(store, uid="inhaber2").post(f"/routes/staff-invitation/{token}").status_code == 200
    assert store["users"]["inhaber2"]["role"] == "shopOwner"
    assert store["staff"]["p1"]["userId"] == "inhaber2"


def test_ladenkonto_kann_nicht_annehmen():
    store = data()
    _, token = invite(store)
    r = client(store, uid="inhaber").post(f"/routes/staff-invitation/{token}")
    assert r.status_code == 409 and "Konto des Ladens" in r.json()["detail"]
    assert store["staff"]["p1"]["userId"] == ""


def test_schon_im_team_dieses_ladens():
    store = data()
    store["staff"]["p2"] = {"shopId": "laden1", "name": "Robin alt", "userId": "kontoRobin", "isActive": True}
    _, token = invite(store)
    r = client(store).post(f"/routes/staff-invitation/{token}")
    assert r.status_code == 409 and "Robin alt" in r.json()["detail"]
    # deaktivierter alter Eintrag blockiert nicht
    store["staff"]["p2"]["isActive"] = False
    assert client(store).post(f"/routes/staff-invitation/{token}").status_code == 200


def test_abgelaufen_oder_deaktiviert():
    store = data()
    _, token = invite(store)
    store["staff"]["p1"]["inviteExpires"] = NOW - timedelta(minutes=1)
    assert client(store, uid=None).get(f"/routes/staff-invitation/{token}").json()["status"] == "abgelaufen"
    assert client(store).post(f"/routes/staff-invitation/{token}").status_code == 410
    store["staff"]["p1"]["inviteExpires"] = NOW + timedelta(days=1)
    store["staff"]["p1"]["isActive"] = False
    assert client(store).post(f"/routes/staff-invitation/{token}").status_code == 410
    assert store["staff"]["p1"]["userId"] == ""


def test_annehmen_nur_angemeldet():
    from fastapi import HTTPException

    from databutton_app.mw.auth_mw import get_authorized_user

    store = data()
    _, token = invite(store)
    c = client(store, uid=None)

    def nicht_angemeldet():
        raise HTTPException(status_code=401, detail="Not authenticated")

    c.app.dependency_overrides[get_authorized_user] = nicht_angemeldet
    assert c.post(f"/routes/staff-invitation/{token}").status_code == 401
    assert c.post("/routes/staff-invitation", json={"staff_id": "p1"}).status_code == 401


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
