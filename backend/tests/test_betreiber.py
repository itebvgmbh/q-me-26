"""
Tests für den Betreiber-Bereich (app/apis/betreiber, app/libs/protokoll.py): Wer darf hinein, was ändert sich am
Laden, was steht im Protokoll, was geht beim Löschen weg? Ohne Firebase lauffähig (Datenbank und Konten nachgebildet):

    cd backend && .venv/bin/python tests/test_betreiber.py
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import NOW, FakeDb, days_ago  # noqa: E402  (setzt auch den Pfad zum Backend)

os.environ["QME_ADMIN_EMAILS"] = "chef@dranzeit.de"
os.environ["QME_ADMIN_UIDS"] = ""
os.environ["QME_BETREIBER_DIR"] = tempfile.mkdtemp(prefix="betreiber-")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.betreiber as api  # noqa: E402
from app.auth.access import require_admin  # noqa: E402
from app.libs import konten, protokoll  # noqa: E402
from app.libs.plans import has_feature  # noqa: E402
from databutton_app.mw.auth_mw import get_authorized_user  # noqa: E402

ITEBV = konten.ITEBV_SHOP
FUTURE = datetime.now(timezone.utc) + timedelta(days=400)


class FakeAuth:
    class UserNotFoundError(Exception):
        pass

    class EmailAlreadyExistsError(Exception):
        pass

    def __init__(self, users):
        self.users, self.revoked, self.deleted = users, [], []

    def get_user(self, uid, app=None):
        if uid not in self.users:
            raise self.UserNotFoundError(uid)
        u = self.users[uid]
        meta = SimpleNamespace(creation_timestamp=1_700_000_000_000, last_sign_in_timestamp=None, last_refresh_timestamp=None)
        return SimpleNamespace(uid=uid, email=u.get("email"), email_verified=u.get("verified", False),
                               disabled=u.get("disabled", False), user_metadata=meta, provider_data=[])

    def update_user(self, uid, app=None, **changes):
        if uid not in self.users:
            raise self.UserNotFoundError(uid)
        if "email" in changes and any(o.get("email") == changes["email"] for k, o in self.users.items() if k != uid):
            raise self.EmailAlreadyExistsError(changes["email"])
        for key, value in changes.items():
            self.users[uid]["verified" if key == "email_verified" else key] = value

    def revoke_refresh_tokens(self, uid, app=None):
        self.revoked.append(uid)

    def delete_user(self, uid, app=None):
        if uid not in self.users:
            raise self.UserNotFoundError(uid)
        self.users.pop(uid)
        self.deleted.append(uid)


class FakeTransaction:
    def update(self, ref, values):
        ref.update(values)

    def set(self, ref, values, merge=False):
        ref.set(values, merge=merge)


class TxDb(FakeDb):
    def transaction(self):
        return FakeTransaction()


def daten():
    return {
        "users": {
            "chef": {"role": "shopOwner", "email": "chef@dranzeit.de"},
            "inhaber": {"role": "shopOwner", "email": "inhaber@laden.de", "displayName": "Ina Haber"},
            "mitarbeiter": {"role": "employee", "email": "kim@laden.de"},
            "kunde": {"role": "customer", "email": "kunde@web.de"},
            "fixture": {"role": "shopOwner"},
        },
        "shops": {
            ITEBV: {"name": "ITEBV GmbH", "owner": "chef", "createdAt": days_ago(300), "industry": "barbershop"},
            "laden": {"name": "Salon Schnitt", "owner": "inhaber", "city": "Berlin", "createdAt": days_ago(60),
                      "trialEndsAt": days_ago(30), "billing": {"plan": "laden", "status": "active", "interval": "monat",
                                                                "customerId": "cus_1", "subscriptionId": "sub_1"}},
            "neu": {"name": "Neuer Laden", "owner": "neuling", "createdAt": days_ago(2), "trialEndsAt": datetime.now(timezone.utc) + timedelta(days=3)},
            "test": {"name": "Testladen (wird gleich gelöscht)", "owner": "fixture", "createdAt": days_ago(1)},
        },
        "staff": {
            "s1": {"shopId": "laden", "userId": "mitarbeiter", "name": "Kim", "isActive": True},
            "s2": {"shopId": ITEBV, "userId": "chef", "name": "Chef", "isActive": True},
            "s3": {"shopId": "neu", "userId": "", "name": "Ohne Konto"},
        },
        "services": {"sv1": {"shopId": "neu"}},
        "customers": {"c1": {"shopId": "neu", "userId": ""}},
        "appointments": {
            "a1": {"shopId": "laden", "customerId": "kunde", "customerName": "Kunde", "status": "completed", "startTime": days_ago(3)},
            "a2": {"shopId": "neu", "customerId": "walk-in", "customerName": "Laufkunde", "status": "completed", "startTime": days_ago(1)},
        },
        "meta": {"gruender": {"count": 5}},
    }


def konten_daten():
    return {
        "chef": {"email": "chef@dranzeit.de", "verified": True},
        "inhaber": {"email": "inhaber@laden.de"},
        "neuling": {"email": "neu@laden.de"},
        "mitarbeiter": {"email": "kim@laden.de"},
        "kunde": {"email": "kunde@web.de"},
        "fixture": {"email": "q-me-test-1760000000@example.com"},
    }


def setup(uid="chef", email="chef@dranzeit.de", store=None, users=None):
    store = store if store is not None else daten()
    auth = FakeAuth(users if users is not None else konten_daten())
    db = TxDb(store)
    api.get_firestore_db = lambda: db
    api.get_firebase_app = lambda: None
    api._auth = lambda: auth
    api.gcf = SimpleNamespace(transactional=lambda fn: fn)
    konten.auth_accounts = lambda app: [konten.account_row(auth.get_user(u)) for u in list(auth.users)]
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=email)
    return TestClient(app), store, auth


def protokoll_zeilen():
    path = Path(os.environ["QME_BETREIBER_DIR"]) / "protokoll.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


# --- Zugang -------------------------------------------------------------------------------------------------------


def test_alle_endpunkte_ausser_ich_nur_fuer_betreiber():
    for route in api.router.routes:
        deps = [d.dependency for d in route.dependencies]
        if route.path == "/betreiber/ich":
            assert deps == [], route.path
        else:
            assert require_admin in deps, f"{route.path} ohne require_admin"


def test_im_router_eingetragen_mit_anmeldung():
    routers = json.loads((Path(__file__).resolve().parents[1] / "routers.json").read_text(encoding="utf-8"))["routers"]
    assert routers["betreiber"]["disableAuth"] is False


def test_andere_konten_werden_abgewiesen():
    client, store, auth = setup("inhaber", "inhaber@laden.de")
    assert client.get("/routes/betreiber/ich").json() == {"admin": False}
    assert client.get("/routes/betreiber/uebersicht").status_code == 403
    r = client.post("/routes/betreiber/laden/laden/sperren", json={"reason": "Test"})
    assert r.status_code == 403
    assert not store["shops"]["laden"].get("suspended") and not auth.users["inhaber"].get("disabled")
    assert client.post("/routes/betreiber/loeschen", json={"shopIds": ["laden"], "confirm": "Salon Schnitt"}).status_code == 403
    assert "laden" in store["shops"]


def test_betreiber_kommt_hinein():
    client, _, _ = setup()
    assert client.get("/routes/betreiber/ich").json() == {"admin": True}


# --- Übersicht ----------------------------------------------------------------------------------------------------


def test_uebersicht_zaehlt_nur_echte_laeden():
    client, _, _ = setup()
    data = client.get("/routes/betreiber/uebersicht").json()
    shops = {s["id"]: s for s in data["shops"]}
    assert shops[ITEBV]["kind"] == "intern" and shops["test"]["kind"] == "test" and shops["laden"]["kind"] == "echt"
    assert shops["laden"]["source"] == "abo" and shops["neu"]["source"] == "test"
    stats = data["stats"]
    assert stats["shops"] == 2 and stats["shopsTest"] == 2
    assert stats["paying"] == 1 and stats["mrr"] == 39.0
    assert stats["inTrial"] == 1 and stats["trialEndingSoon"] == 1
    assert stats["founders"] == {"taken": 5, "limit": 100}
    accounts = {a["uid"]: a for a in data["accounts"]}
    assert accounts["chef"]["kind"] == "intern" and accounts["fixture"]["kind"] == "test"
    assert "stripe" in data["system"] and "resend" in data["system"]


def test_umsatz_jahresabo_und_gruenderpreis():
    assert api.monthly_net({"billing": "active", "plan": "team", "interval": "jahr"}) == round(590 / 12, 2)
    assert api.monthly_net({"billing": "active", "plan": "laden", "interval": "monat", "founder": True}) == 19.0
    assert api.monthly_net({"billing": "trialing", "plan": "laden", "interval": "monat"}) == 0.0
    assert api.monthly_net({"billing": "past_due", "plan": "solo", "interval": "monat"}) == 19.0


def test_systemstand_zeigt_keine_schluessel():
    os.environ["STRIPE_SECRET_KEY"] = "sk_test_geheim123"
    try:
        status = api.system_status()
        assert status["stripe"] == "test"
        assert "geheim" not in json.dumps(status)
    finally:
        os.environ.pop("STRIPE_SECRET_KEY")


# --- Eingriffe am Laden -------------------------------------------------------------------------------------------


def test_freischalten_mit_enddatum_und_grund_im_protokoll():
    client, store, _ = setup()
    bis = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    assert client.post("/routes/betreiber/laden/neu/freischaltung", json={"plan": "solo", "until": bis, "reason": ""}).status_code == 400
    assert "grant" not in store["shops"]["neu"]  # ohne Grund ändert sich nichts
    assert client.post("/routes/betreiber/laden/neu/freischaltung", json={"plan": "gold", "until": bis, "reason": "Partner"}).status_code == 400
    r = client.post("/routes/betreiber/laden/neu/freischaltung", json={"plan": "laden", "until": bis, "reason": "Partner Messe"})
    assert r.status_code == 200, r.text
    grant = store["shops"]["neu"]["grant"]
    assert grant["plan"] == "laden" and grant["until"].astimezone(konten.BERLIN).strftime("%Y-%m-%d %H:%M") == f"{bis} 23:59"
    assert "Partner Messe" not in json.dumps(store["shops"]["neu"], default=str)  # Grund nur im Protokoll
    last = protokoll_zeilen()[-1]
    assert last["action"] == "Freigeschaltet" and last["reason"] == "Partner Messe" and last["by"] == "chef@dranzeit.de"
    gestern = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    assert client.post("/routes/betreiber/laden/neu/freischaltung", json={"plan": "laden", "until": gestern, "reason": "x y z"}).status_code == 400
    assert client.post("/routes/betreiber/laden/neu/freischaltung-beenden", json={}).status_code == 200
    assert store["shops"]["neu"]["grant"] is None


def test_testphase_bis_tagesende():
    client, store, _ = setup()
    r = client.post("/routes/betreiber/laden/laden/testphase", json={"until": "2026-12-24"})
    assert r.status_code == 200, r.text
    assert store["shops"]["laden"]["trialEndsAt"].astimezone(konten.BERLIN).strftime("%d.%m.%Y %H:%M") == "24.12.2026 23:59"
    assert client.post("/routes/betreiber/laden/laden/testphase", json={"until": "24.12.2026"}).status_code == 400


def test_gruender_vergeben_und_entziehen_zaehlt_mit():
    client, store, _ = setup()
    assert client.post("/routes/betreiber/laden/neu/gruender", json={"founder": True}).json()["count"] == 6
    shop = store["shops"]["neu"]
    assert shop["founder"] is True and shop["trialEndsAt"] > datetime.now(timezone.utc) + timedelta(days=89)
    assert client.post("/routes/betreiber/laden/neu/gruender", json={"founder": True}).json()["count"] == 6  # schon Gründer
    assert client.post("/routes/betreiber/laden/neu/gruender", json={"founder": False}).json()["count"] == 5
    assert store["shops"]["neu"]["founder"] is False
    store["meta"]["gruender"]["count"] = 100
    assert client.post("/routes/betreiber/laden/neu/gruender", json={"founder": True}).status_code == 409


def test_stripe_loesen_braucht_grund_und_merkt_den_alten_stand():
    client, store, _ = setup()
    assert client.post("/routes/betreiber/laden/laden/stripe-loesen", json={"reason": ""}).status_code == 400
    assert store["shops"]["laden"]["billing"]["customerId"] == "cus_1"  # ohne Grund ändert sich nichts
    r = client.post("/routes/betreiber/laden/laden/stripe-loesen", json={"reason": "Sandbox-Kunde vor Live-Start"})
    assert r.json() == {"changed": True}
    assert store["shops"]["laden"]["billing"] is None and store["shops"]["laden"]["plan"] == "gratis"
    assert protokoll_zeilen()[-1]["before"]["billing"]["customerId"] == "cus_1"


def test_laden_sperren_sperrt_inhaber_und_team_aber_nie_den_betreiber():
    client, store, auth = setup()
    r = client.post("/routes/betreiber/laden/laden/sperren", json={"reason": "Zahlung offen seit Monaten"})
    assert r.json()["accounts"] == 2
    assert auth.users["inhaber"]["disabled"] and auth.users["mitarbeiter"]["disabled"]
    assert set(auth.revoked) == {"inhaber", "mitarbeiter"}
    assert store["shops"]["laden"]["suspended"]["accounts"] == ["inhaber", "mitarbeiter"]
    assert not has_feature(store["shops"]["laden"], "termine")
    # Laden des Betreibers: dessen Konto bleibt offen
    r = client.post(f"/routes/betreiber/laden/{ITEBV}/sperren", json={"reason": "Probe"})
    assert r.json()["skipped"] == ["chef@dranzeit.de"] and not auth.users["chef"].get("disabled")


def test_entsperren_laesst_einzeln_gesperrte_konten_zu():
    client, store, auth = setup()
    client.post("/routes/betreiber/laden/laden/sperren", json={"reason": "Prüfung"})
    client.post("/routes/betreiber/konto/mitarbeiter/sperren", json={"reason": "Missbrauch gemeldet"})
    r = client.post("/routes/betreiber/laden/laden/entsperren", json={})
    assert r.json() == {"changed": True, "accounts": 1, "kept": 1}
    assert not auth.users["inhaber"]["disabled"] and auth.users["mitarbeiter"]["disabled"]
    assert store["shops"]["laden"]["suspended"] is None
    client.post("/routes/betreiber/konto/mitarbeiter/entsperren", json={})
    assert not auth.users["mitarbeiter"]["disabled"]
    assert "mitarbeiter" not in protokoll.blocked_accounts()


# --- Konten -------------------------------------------------------------------------------------------------------


def test_betreiber_konto_laesst_sich_nicht_sperren():
    client, _, auth = setup()
    assert client.post("/routes/betreiber/konto/chef/sperren", json={"reason": "Versehen"}).status_code == 409
    assert not auth.users["chef"].get("disabled")


def test_email_aendern():
    client, store, auth = setup()
    assert client.post("/routes/betreiber/konto/kunde/email", json={"email": "kaputt"}).status_code == 400
    assert client.post("/routes/betreiber/konto/kunde/email", json={"email": "kim@laden.de"}).status_code == 409
    r = client.post("/routes/betreiber/konto/kunde/email", json={"email": " Neu@Web.de "})
    assert r.json() == {"email": "neu@web.de", "changed": True}
    assert auth.users["kunde"]["email"] == "neu@web.de" and auth.users["kunde"]["verified"] is False
    assert store["users"]["kunde"]["email"] == "neu@web.de"


def test_email_als_bestaetigt_markieren():
    client, _, auth = setup()
    assert client.post("/routes/betreiber/konto/kunde/email-bestaetigt", json={"verified": True}).json() == {"emailVerified": True}
    assert auth.users["kunde"]["verified"] is True
    assert client.post("/routes/betreiber/konto/gibtsnicht/email-bestaetigt", json={"verified": True}).status_code == 404


# --- Löschen ------------------------------------------------------------------------------------------------------


def test_loeschen_erst_mit_dem_namen_dann_mit_sicherung():
    client, store, auth = setup()
    probe = client.post("/routes/betreiber/loeschen/probe", json={"shopIds": ["neu"], "uids": ["neuling"]}).json()
    assert probe["problems"] == [] and probe["confirmWord"] == "Neuer Laden"
    assert probe["shops"][0]["related"] == {"services": 1, "staff": 1, "appointments": 1, "customers": 1}
    assert "neu" in store["shops"]  # Probelauf ändert nichts
    r = client.post("/routes/betreiber/loeschen", json={"shopIds": ["neu"], "uids": ["neuling"], "confirm": "Neuer"})
    assert r.status_code == 400 and "neu" in store["shops"]
    r = client.post("/routes/betreiber/loeschen", json={"shopIds": ["neu"], "uids": ["neuling"], "confirm": " neuer laden "})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["left"] == [] and body["result"]["shops"] == 1 and body["result"]["accounts"] == 1
    assert "neu" not in store["shops"] and "neuling" not in auth.users
    assert not [a for a in store["appointments"].values() if a.get("shopId") == "neu"]
    backup = Path(os.environ["QME_BETREIBER_DIR"]) / "sicherungen" / body["backup"]
    saved = json.loads(backup.read_text(encoding="utf-8"))
    assert "shops/neu" in saved["dokumente"] and "services/sv1" in saved["dokumente"]
    last = protokoll_zeilen()[-1]
    assert last["action"] == "Gelöscht" and last["target"]["shopIds"] == ["neu"]


def test_loeschen_verweigert_abo_itebv_betreiber_und_fremde_inhaber():
    client, store, _ = setup()
    for body, word in (({"shopIds": ["laden"]}, "Salon Schnitt"), ({"shopIds": [ITEBV]}, "ITEBV GmbH"),
                       ({"uids": ["chef"]}, "chef@dranzeit.de"), ({"uids": ["inhaber"]}, "inhaber@laden.de")):
        probe = client.post("/routes/betreiber/loeschen/probe", json=body).json()
        assert probe["problems"], body
        r = client.post("/routes/betreiber/loeschen", json={**body, "confirm": word})
        assert r.status_code == 409, (body, r.text)
    assert {"laden", ITEBV} <= set(store["shops"])
    assert client.post("/routes/betreiber/loeschen/probe", json={"shopIds": ["a", "b"]}).status_code == 400


def test_kunden_konto_loeschen_wie_im_profil():
    client, store, auth = setup()
    r = client.post("/routes/betreiber/loeschen", json={"uids": ["kunde"], "confirm": "kunde@web.de"})
    assert r.status_code == 200, r.text
    assert "kunde" not in auth.users and "kunde" not in store["users"]
    assert store["appointments"]["a1"]["customerName"] != "Kunde"  # Termin bleibt im Laden, ohne Namen


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
