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
    assert update["billing.customerId"] == "cus_1"


def test_gekuendigtes_abo_setzt_gratis():
    assert shop_update_from_subscription(sub(status="canceled"))["plan"] == "gratis"


class FakeRef:
    def __init__(self, store, doc_id):
        self.store, self.doc_id = store, doc_id

    def get(self):
        return type("Snap", (), {"exists": self.doc_id in self.store})()

    def update(self, data):
        self.store[self.doc_id].update(data)


class FakeDb:
    def __init__(self, shops):
        self.shops = shops

    def collection(self, _name):
        return type("Coll", (), {"document": lambda _s, doc_id: FakeRef(self.shops, doc_id)})()


def signed(event: dict) -> tuple[bytes, str]:
    payload = json.dumps(event).encode()
    ts = int(time.time())
    sig = stripe.WebhookSignature._compute_signature(f"{ts}.{payload.decode()}", SECRET)
    return payload, f"t={ts},v1={sig}"


def app_with(shops):
    os.environ["STRIPE_WEBHOOK_SECRET"] = SECRET
    wh.get_firestore_db = lambda: FakeDb(shops)
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


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
