"""
Tests für app/libs/shop_privat.py (Stripe-IDs und gesperrte Konten nicht am öffentlichen Laden) und den Wechsel des
Stripe-Modus beim Abo (app/apis/billing, known_customer). Ohne Firebase und ohne Stripe lauffähig:

    cd backend && .venv/bin/python tests/test_shop_privat.py
"""
import stripe
from google.cloud import firestore

import test_privacy
from test_privacy import FakeDb

from app.libs import shop_privat  # noqa: E402


def _update(self, values):
    """Wie Firestore: Pfade mit Punkt gehen in verschachtelte Felder, DELETE_FIELD entfernt"""
    doc = self.db.data[self.coll][self.id]
    for key, value in values.items():
        *path, last = key.split(".")
        target = doc
        for part in path:
            target = target.setdefault(part, {}) if not isinstance(target.get(part), dict) else target[part]
        if value is firestore.DELETE_FIELD:
            target.pop(last, None)
        else:
            target[last] = value


test_privacy.Ref.update = _update

LEGACY = {"name": "Alt", "billing": {"status": "active", "plan": "laden", "customerId": "cus_alt", "subscriptionId": "sub_alt"},
          "suspended": {"at": "2026-10-01", "accounts": ["u1", "u2"]}}


def test_umzug_nimmt_ids_und_konten_vom_laden():
    data = {"shops": {"alt": {**LEGACY, "billing": dict(LEGACY["billing"]), "suspended": dict(LEGACY["suspended"])}, "neu": {"name": "Neu"}}}
    db = FakeDb(data)
    assert shop_privat.migrate(db) == 1
    shop = data["shops"]["alt"]
    assert shop["billing"] == {"status": "active", "plan": "laden"}
    assert shop["suspended"] == {"at": "2026-10-01"}
    assert data["shops/alt/privat"]["stripe"]["customerId"] == "cus_alt"
    assert data["shops/alt/privat"]["stripe"]["subscriptionId"] == "sub_alt"
    assert data["shops/alt/privat"]["sperre"]["accounts"] == ["u1", "u2"]
    assert shop_privat.migrate(db) == 0  # zweites Mal nichts mehr zu tun


def test_lesen_vor_und_nach_dem_umzug():
    data = {"shops": {"alt": {**LEGACY, "billing": dict(LEGACY["billing"]), "suspended": dict(LEGACY["suspended"])}}}
    db = FakeDb(data)
    before = (shop_privat.stripe_ids(db, "alt", data["shops"]["alt"]), shop_privat.locked_accounts(db, "alt", data["shops"]["alt"]))
    shop_privat.migrate(db)
    after = (shop_privat.stripe_ids(db, "alt", data["shops"]["alt"]), shop_privat.locked_accounts(db, "alt", data["shops"]["alt"]))
    assert before == after == ({"customerId": "cus_alt", "subscriptionId": "sub_alt"}, ["u1", "u2"])


def test_speichern_raeumt_den_laden_auf():
    data = {"shops": {"l1": {"billing": {"status": "trialing", "customerId": "cus_x"}}}}
    db = FakeDb(data)
    shop_privat.save_stripe_ids(db, "l1", customer_id="cus_y", subscription_id="sub_y")
    assert data["shops"]["l1"]["billing"] == {"status": "trialing"}
    assert shop_privat.stripe_ids(db, "l1", data["shops"]["l1"]) == {"customerId": "cus_y", "subscriptionId": "sub_y"}
    shop_privat.clear_stripe_ids(db, "l1")
    assert shop_privat.stripe_ids(db, "l1", data["shops"]["l1"]) == {}


def test_testmodus_hat_eigene_ids_und_laesst_die_echten_in_ruhe():
    data = {"shops": {"l1": {"billing": {"status": "canceled"}}}}
    db = FakeDb(data)
    shop_privat.save_stripe_ids(db, "l1", customer_id="cus_live", subscription_id="sub_live")
    assert shop_privat.stripe_link(db, "l1") == ("live", {"customerId": "cus_live", "subscriptionId": "sub_live"})

    shop_privat.start_test_mode(db, "l1")
    assert shop_privat.stripe_link(db, "l1") == ("test", {})  # jeder Testmodus fängt ohne Abo an
    shop_privat.save_stripe_ids(db, "l1", customer_id="cus_sb", subscription_id="sub_sb", mode="test")
    assert shop_privat.stripe_ids(db, "l1") == {"customerId": "cus_sb", "subscriptionId": "sub_sb"}
    assert shop_privat.stripe_ids(db, "l1", mode="live") == {"customerId": "cus_live", "subscriptionId": "sub_live"}

    shop_privat.clear_stripe_ids(db, "l1", "test")  # Verknüpfung lösen im Testmodus: bleibt im Testmodus
    assert shop_privat.stripe_link(db, "l1") == ("test", {})
    shop_privat.save_stripe_ids(db, "l1", customer_id="cus_sb2", mode="test")

    shop_privat.end_test_mode(db, "l1")
    assert shop_privat.stripe_link(db, "l1") == ("live", {"customerId": "cus_live", "subscriptionId": "sub_live"})
    shop_privat.start_test_mode(db, "l1")
    assert shop_privat.stripe_ids(db, "l1") == {}  # alter Test vergessen


def test_sandbox_nur_mit_testschluessel(monkeypatch=None):
    import os

    from app.libs import stripe_billing

    saved = {k: os.environ.pop(k, None) for k in ("STRIPE_SECRET_KEY", "STRIPE_TEST_SECRET_KEY")}
    try:
        os.environ["STRIPE_SECRET_KEY"] = "sk_live_" + "x" * 24
        assert stripe_billing.stripe_configured("live") and not stripe_billing.stripe_configured("test")
        os.environ["STRIPE_TEST_SECRET_KEY"] = "sk_live_" + "y" * 24  # Live-Schlüssel im Sandbox-Platz: nie benutzen
        assert not stripe_billing.stripe_configured("test")
        try:
            stripe_billing.client("test")
            raise AssertionError("Live-Schlüssel als Sandbox angenommen")
        except RuntimeError:
            pass
        os.environ["STRIPE_TEST_SECRET_KEY"] = "sk_test_" + "z" * 24
        assert stripe_billing.stripe_configured("test") and stripe_billing.test_key("test") and not stripe_billing.test_key("live")
    finally:
        for k, v in saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v


class FakeCustomers:
    def __init__(self, known):
        self.known = known

    def retrieve(self, customer_id):
        if customer_id not in self.known:
            raise stripe.InvalidRequestError("No such customer", "id", code="resource_missing")
        return type("Customer", (), {"deleted": False})()


def _client(known):
    return type("C", (), {"v1": type("V1", (), {"customers": FakeCustomers(known)})()})()


def test_kunde_aus_dem_testmodus_wird_vergessen():
    from app.apis.billing import known_customer

    data = {"shops": {"l1": {"billing": {"status": "trialing", "plan": "laden"}, "plan": "laden"}}}
    db = FakeDb(data)
    shop_privat.save_stripe_ids(db, "l1", customer_id="cus_test")
    # Live-Modus kennt den Test-Kunden nicht: Verknüpfung und Abo-Stand weg, neuer Kunde beim nächsten Abschluss
    assert known_customer(_client(set()), db, "l1", data["shops"]["l1"]) is None
    assert data["shops"]["l1"]["billing"] is None and data["shops"]["l1"]["plan"] == "gratis"
    assert shop_privat.stripe_ids(db, "l1", data["shops"]["l1"]) == {}


def test_bekannter_kunde_bleibt():
    from app.apis.billing import known_customer

    data = {"shops": {"l1": {"billing": {"status": "active"}}}}
    db = FakeDb(data)
    shop_privat.save_stripe_ids(db, "l1", customer_id="cus_live")
    assert known_customer(_client({"cus_live"}), db, "l1", data["shops"]["l1"]) == "cus_live"
    assert data["shops"]["l1"]["billing"] == {"status": "active"}


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
