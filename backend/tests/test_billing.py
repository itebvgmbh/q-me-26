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
