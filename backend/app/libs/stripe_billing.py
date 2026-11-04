"""Abo-Abrechnung der Läden mit Stripe (Checkout für den Abschluss, Kundenportal zum Wechseln und Kündigen).

Einstellungen in /etc/q-me.env (setzt Stefan selbst, deploy/README.md "Abo-Abrechnung"):
    STRIPE_SECRET_KEY=rk_... oder sk_...   eingeschränkter Schlüssel empfohlen
    STRIPE_WEBHOOK_SECRET=whsec_...         schreibt deploy/stripe-setup.py beim Anlegen des Webhooks
    STRIPE_PORTAL_CONFIG=bpc_...            schreibt deploy/stripe-setup.py (kein Geheimnis)

Testmodus je Laden (Betreiber-Bereich, app/libs/shop_privat.py): Solche Läden buchen in der Stripe-Sandbox, mit
    STRIPE_TEST_SECRET_KEY=sk_test_...      nur ein Testschlüssel wird angenommen
    STRIPE_TEST_WEBHOOK_SECRET, STRIPE_TEST_PORTAL_CONFIG   schreibt deploy/stripe-setup.py --test

Produkte und Preise legt deploy/stripe-setup.py an; gefunden werden sie über ihren lookup_key.
Preise sind netto (tax_behavior "exclusive"), die Mehrwertsteuer rechnet Stripe Tax dazu.
"""

import os
from datetime import datetime, timezone

import stripe

# Preise in Cent, netto. Gleich wie frontend/src/utils/plans.ts.
CATALOG = {
    "solo": {"name": "Dranzeit Solo", "monat": 1900, "jahr": 19000},
    "laden": {"name": "Dranzeit Laden", "monat": 3900, "jahr": 39000},
    "team": {"name": "Dranzeit Team", "monat": 5900, "jahr": 59000},
}
FOUNDER_PRICES = {"monat": 1900, "jahr": 19000}  # Gründerangebot: Laden zum Solo-Preis
INTERVALS = {"monat": "month", "jahr": "year"}


def lookup_key(plan: str, interval: str, founder: bool = False) -> str:
    if founder and plan == "laden":
        return f"dranzeit_laden_gruender_{interval}"
    return f"dranzeit_{plan}_{interval}"


def parse_lookup_key(key: str | None) -> tuple[str | None, str | None]:
    """dranzeit_laden_gruender_monat -> ("laden", "monat")"""
    if not key or not key.startswith("dranzeit_"):
        return None, None
    parts = key.split("_")
    plan, interval = parts[1], parts[-1]
    if plan not in CATALOG or interval not in INTERVALS:
        return None, None
    return plan, interval


LIVE, TEST = "live", "test"  # gleich wie app/libs/shop_privat.py
KEY_ENV = {LIVE: "STRIPE_SECRET_KEY", TEST: "STRIPE_TEST_SECRET_KEY"}
WEBHOOK_ENV = {LIVE: "STRIPE_WEBHOOK_SECRET", TEST: "STRIPE_TEST_WEBHOOK_SECRET"}
PORTAL_ENV = {LIVE: "STRIPE_PORTAL_CONFIG", TEST: "STRIPE_TEST_PORTAL_CONFIG"}


def _key(mode: str) -> str:
    return os.environ.get(KEY_ENV[mode], "").strip()


def stripe_configured(mode: str = LIVE) -> bool:
    """Schlüssel für den Modus da? Für die Sandbox zählt nur ein Testschlüssel – nie echte Zahlungen im Testmodus."""
    key = _key(mode)
    return bool(key) and (mode == LIVE or "_test_" in key)


def test_key(mode: str = LIVE) -> bool:
    """Probe-Zahlungen in diesem Modus (Sandbox, oder vor dem Live-Start auch der Hauptschlüssel)"""
    return "_test_" in _key(mode)


def client(mode: str = LIVE) -> stripe.StripeClient:
    if not stripe_configured(mode):
        raise RuntimeError(f"{KEY_ENV[mode]} fehlt")
    return stripe.StripeClient(_key(mode))


def portal_config(mode: str = LIVE) -> str:
    return os.environ.get(PORTAL_ENV[mode], "").strip()


_price_cache: dict[tuple[str, str], str] = {}


def price_id(c: stripe.StripeClient, key: str, mode: str = LIVE) -> str:
    if (mode, key) not in _price_cache:
        prices = c.v1.prices.list(params={"lookup_keys": [key], "active": True, "limit": 1})
        if not prices.data:
            raise RuntimeError(f"Preis {key} fehlt in Stripe ({mode}) – deploy/stripe-setup.py ausführen")
        _price_cache[(mode, key)] = prices.data[0].id
    return _price_cache[(mode, key)]


_accounts: dict[str, str] = {}


def dashboard_url(mode: str, customer_id: str) -> str:
    """Link auf den Kunden im Stripe-Dashboard, im richtigen Konto (die Organisation hat mehrere) und Modus"""
    key = _key(mode)
    if not key or not customer_id:
        return ""
    if key not in _accounts:
        try:
            _accounts[key] = stripe.StripeClient(key, max_network_retries=0).v1.accounts.retrieve_current().id
        except Exception as e:  # eingeschränkter Schlüssel darf das Konto nicht lesen: Link ohne Konto
            print(f"Stripe-Konto ({mode}) nicht ermittelt: {e}")
            _accounts[key] = ""
    account = f"{_accounts[key]}/" if _accounts[key] else ""
    return f"https://dashboard.stripe.com/{account}{'test/' if '_test_' in key else ''}customers/{customer_id}"


def billing_fields(subscription) -> dict:
    """Was am Laden gespeichert wird (Feld billing), aus dem aktuellen Stand eines Stripe-Abos."""
    if hasattr(subscription, "to_dict"):
        subscription = subscription.to_dict()
    items = (subscription.get("items") or {}).get("data") or []
    item = items[0] if items else {}
    price = item.get("price", {}) if item else {}
    plan, interval = parse_lookup_key(price.get("lookup_key"))
    period_end = item.get("current_period_end") if item else None
    return {
        "plan": plan,
        "interval": interval,
        "status": subscription.get("status"),
        "subscriptionId": subscription.get("id"),
        "customerId": subscription.get("customer"),
        "cancelAtPeriodEnd": bool(subscription.get("cancel_at_period_end")),
        "currentPeriodEnd": datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None,
    }


def shop_update_from_subscription(subscription) -> dict:
    """Firestore-Update für den Laden. plan bleibt die Kurzinfo für die Oberfläche; maßgeblich ist billing."""
    if hasattr(subscription, "to_dict"):
        subscription = subscription.to_dict()
    fields = billing_fields(subscription)
    active = fields["status"] in ("active", "trialing", "past_due") and fields["plan"]
    # Stripe-Kunde und -Abo stehen nicht am (öffentlich lesbaren) Laden, sondern in privat (app/libs/shop_privat.py)
    update = {f"billing.{k}": v for k, v in fields.items() if k not in ("customerId", "subscriptionId")}
    update["plan"] = fields["plan"] if active else "gratis"
    return update
