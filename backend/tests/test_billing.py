"""
Tests für die Abo-Abrechnung: Preisschlüssel, Abo → Laden, Stripe-Webhook mit echter Signaturprüfung.
Ohne Firebase und ohne Stripe-Konto lauffähig:

    cd backend && .venv/bin/python tests/test_billing.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

import stripe  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.stripe_webhook as wh  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from app.libs import stripe_billing  # noqa: E402
from app.libs.stripe_billing import lookup_key, parse_lookup_key, shop_update_from_subscription  # noqa: E402

SECRET = "whsec_test_geheim"
SANDBOX_SECRET = "whsec_sandbox_geheim"


def sub(status="active", key="dranzeit_laden_monat", shop="laden1", cancel=False):
    return {
        "id": "sub_1", "object": "subscription", "status": status, "customer": "cus_1", "cancel_at_period_end": cancel,
        "metadata": {"shopId": shop},
        "items": {"object": "list", "data": [{"price": {"lookup_key": key}, "current_period_end": 1798761600}]},
    }


def test_preisschluessel():
    assert lookup_key("laden", "monat") == "dranzeit_laden_monat"
    assert lookup_key("laden", "jahr", founder=True) == "dranzeit_laden_gruender_jahr"
    assert lookup_key("solo", "monat", founder=True) == "dranzeit_solo_monat"  # Gründerpreis nur für Laden
    assert parse_lookup_key("dranzeit_laden_gruender_monat") == ("laden", "monat")
    assert parse_lookup_key("fremd_preis") == (None, None)


class Meta(dict):
    def to_dict(self):
        return dict(self)


def satz(rid, prozent=19, inklusive=False, aktiv=True, meta=None):
    return SimpleNamespace(id=rid, percentage=prozent, inclusive=inklusive, active=aktiv,
                           metadata=Meta(meta if meta is not None else {"dranzeit_steuer": "ust19"}))


def fake_stripe(saetze=(), checkouts=None):
    class Liste:
        def __init__(self, daten):
            self.data = list(daten)

        def auto_paging_iter(self):
            return iter(self.data)

    class Sessions:
        def create(self, params):
            checkouts.append(params)
            return SimpleNamespace(url="https://checkout.stripe.com/c/pay/cs_test_1")

    return SimpleNamespace(v1=SimpleNamespace(
        tax_rates=SimpleNamespace(list=lambda params: Liste(saetze)),
        prices=SimpleNamespace(list=lambda params: Liste([SimpleNamespace(id="price_" + params["lookup_keys"][0])])),
        checkout=SimpleNamespace(sessions=Sessions()),
    ))


def test_fester_steuersatz_19_prozent():
    """Kein Stripe Tax zum Start (Stefan, 11.11.2026): Abos bekommen den festen Satz, gefunden über ID oder metadata."""
    os.environ.pop("STRIPE_TEST_STEUERSATZ", None)
    stripe_billing._steuer_cache.clear()
    fremde = [satz("txr_inkl", inklusive=True), satz("txr_7", prozent=7), satz("txr_alt", aktiv=False), satz("txr_anders", meta={})]
    c = fake_stripe([*fremde, satz("txr_ust19")])
    assert stripe_billing.steuer(c, "test") == {"default_tax_rates": ["txr_ust19"]}
    stripe_billing._steuer_cache.clear()
    try:
        stripe_billing.steuersatz_id(fake_stripe(fremde), "test")
        raise AssertionError("ohne passenden Steuersatz hätte es einen Fehler geben müssen")
    except RuntimeError as e:
        assert "stripe-setup.py" in str(e)
    os.environ["STRIPE_TEST_STEUERSATZ"] = "txr_aus_env"
    stripe_billing._steuer_cache.clear()
    assert stripe_billing.steuersatz_id(fake_stripe(), "test") == "txr_aus_env"  # ohne Stripe zu fragen
    os.environ.pop("STRIPE_TEST_STEUERSATZ")
    stripe_billing._steuer_cache.clear()


def test_tarif_checkout_mit_festen_19_prozent():
    import app.apis.billing as b

    checkouts = []
    fake = fake_stripe([satz("txr_ust19")], checkouts)
    namen = ("require_shop_of_owner", "_shop", "_origin", "get_firestore_db", "stripe_link", "client", "known_customer", "_require_stripe")
    alt = {n: getattr(b, n) for n in namen}
    stripe_billing._steuer_cache.clear()
    try:
        b.require_shop_of_owner = lambda user, shop_id: None
        b._shop = lambda shop_id: {"name": "Salon Nora", "plan": "gratis"}
        b._origin = lambda request: "https://dranzeit.de"
        b.get_firestore_db = lambda: None
        b.stripe_link = lambda db, shop_id, shop: ("live", {})
        b.client = lambda mode="live": fake
        b.known_customer = lambda c, db, shop_id, shop, mode="live": "cus_1"
        b._require_stripe = lambda mode="live": None
        antwort = b.checkout(body=b.CheckoutRequest(shop_id="laden1", plan="laden", interval="monat"),
                             user=SimpleNamespace(sub="uid1", email="nora@salon.de"), request=None)
    finally:
        for n, f in alt.items():
            setattr(b, n, f)
        stripe_billing._steuer_cache.clear()
    assert antwort["url"].startswith("https://checkout.stripe.com/")
    params = checkouts[0]
    assert "automatic_tax" not in params  # Stripe Tax ohne Registrierung hätte 0 % berechnet
    assert params["subscription_data"]["default_tax_rates"] == ["txr_ust19"]
    assert params["subscription_data"]["metadata"] == {"shopId": "laden1"}
    assert params["line_items"] == [{"price": "price_dranzeit_laden_monat", "quantity": 1}]
    assert params["tax_id_collection"] == {"enabled": True}


def test_aktives_abo_setzt_tarif():
    update = shop_update_from_subscription(sub())
    assert update["plan"] == "laden"
    assert update["billing.status"] == "active" and update["billing.interval"] == "monat"
    # Stripe-Kunde und -Abo nicht am öffentlich lesbaren Laden (app/libs/shop_privat.py)
    assert "billing.customerId" not in update and "billing.subscriptionId" not in update


def test_gekuendigtes_abo_setzt_gratis():
    assert shop_update_from_subscription(sub(status="canceled"))["plan"] == "gratis"


from test_privacy import FakeDb  # noqa: E402  (Firestore zum Nachbilden, mit Unter-Sammlungen)


def signed(event: dict, secret: str = SECRET) -> tuple[bytes, str]:
    payload = json.dumps(event).encode()
    ts = int(time.time())
    sig = stripe.WebhookSignature._compute_signature(f"{ts}.{payload.decode()}", secret)
    return payload, f"t={ts},v1={sig}"


def app_with(shops, extra=None):
    os.environ["STRIPE_WEBHOOK_SECRET"] = SECRET
    os.environ["STRIPE_TEST_WEBHOOK_SECRET"] = SANDBOX_SECRET
    global store
    store = {"shops": shops, **(extra or {})}
    wh.get_firestore_db = lambda: FakeDb(store)
    app = FastAPI()
    app.include_router(wh.router, prefix="/routes")
    return TestClient(app)


def test_webhook_aktualisiert_laden():
    shops = {"laden1": {}}
    c = app_with(shops)
    payload, header = signed({"id": "evt_1", "object": "event", "type": "customer.subscription.updated", "data": {"object": sub(status="trialing")}})
    r = c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header})
    assert r.status_code == 200, r.text
    assert shops["laden1"]["plan"] == "laden" and shops["laden1"]["billing.status"] == "trialing"
    assert "billing.customerId" not in shops["laden1"]
    assert store["shops/laden1/privat"]["stripe"]["customerId"] == "cus_1"
    assert store["shops/laden1/privat"]["stripe"]["subscriptionId"] == "sub_1"


def test_webhook_ohne_gueltige_signatur_abgelehnt():
    shops = {"laden1": {}}
    c = app_with(shops)
    payload, _ = signed({"id": "evt_2", "object": "event", "type": "customer.subscription.deleted", "data": {"object": sub(status="canceled")}})
    r = c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": "t=1,v1=falsch"})
    assert r.status_code == 400
    assert shops["laden1"] == {}


def test_webhook_fremder_laden_wird_uebersprungen():
    shops = {}
    c = app_with(shops)
    payload, header = signed({"id": "evt_3", "object": "event", "type": "customer.subscription.created", "data": {"object": sub(shop="gibtsnicht")}})
    assert c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header}).status_code == 200
    assert shops == {}


def _event(subscription):
    return {"id": "evt_s", "object": "event", "type": "customer.subscription.updated", "data": {"object": subscription}}


def test_sandbox_ereignis_zaehlt_nur_fuer_laeden_im_testmodus():
    shops = {"laden1": {}, "echt": {}}
    c = app_with(shops, {"shops/laden1/privat": {"stripe_test": {"aktiv": True}}})
    payload, header = signed(_event(sub(status="trialing")), SANDBOX_SECRET)
    assert c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header}).status_code == 200
    assert shops["laden1"]["billing.status"] == "trialing"
    assert store["shops/laden1/privat"]["stripe_test"]["customerId"] == "cus_1"
    assert "stripe" not in store["shops/laden1/privat"]  # echte IDs bleiben, wie sie sind

    # Sandbox-Abo für einen Laden, der echt bucht (z. B. ein altes aus der Zeit vor dem Live-Start): nichts passiert
    payload, header = signed(_event(sub(status="trialing", shop="echt")), SANDBOX_SECRET)
    assert c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header}).status_code == 200
    assert shops["echt"] == {}


def test_echtes_ereignis_aendert_laden_im_testmodus_nicht():
    shops = {"laden1": {}}
    c = app_with(shops, {"shops/laden1/privat": {"stripe_test": {"aktiv": True}}})
    payload, header = signed(_event(sub(status="active")))
    assert c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header}).status_code == 200
    assert shops["laden1"] == {}


def test_sandbox_abo_eines_frueheren_tests_wird_uebersprungen():
    shops = {"laden1": {}}
    c = app_with(shops, {"shops/laden1/privat": {"stripe_test": {"aktiv": True, "customerId": "cus_neu"}}})
    payload, header = signed(_event(sub(status="active")), SANDBOX_SECRET)  # Kunde cus_1 statt cus_neu
    assert c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header}).status_code == 200
    assert shops["laden1"] == {}


def test_ohne_sandbox_geheimnis_nur_echte_signatur():
    shops = {"laden1": {}}
    c = app_with(shops)
    os.environ.pop("STRIPE_TEST_WEBHOOK_SECRET")
    payload, header = signed(_event(sub()), SANDBOX_SECRET)
    assert c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header}).status_code == 400
    payload, header = signed(_event(sub()))
    assert c.post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header}).status_code == 200


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
