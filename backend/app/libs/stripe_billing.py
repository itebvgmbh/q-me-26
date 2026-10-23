"""Abo-Abrechnung der Läden mit Stripe (Checkout für den Abschluss, Kundenportal zum Wechseln und Kündigen).

Einstellungen in /etc/q-me.env (setzt Stefan selbst, deploy/README.md "Abo-Abrechnung"):
    STRIPE_SECRET_KEY=rk_... oder sk_...   eingeschränkter Schlüssel empfohlen
    STRIPE_WEBHOOK_SECRET=whsec_...         schreibt deploy/stripe-setup.py beim Anlegen des Webhooks
    STRIPE_PORTAL_CONFIG=bpc_...            schreibt deploy/stripe-setup.py (kein Geheimnis)

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


def stripe_configured() -> bool:
    return bool(os.environ.get("STRIPE_SECRET_KEY", "").strip())


def client() -> stripe.StripeClient:
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY fehlt")
    return stripe.StripeClient(key)


_price_cache: dict[str, str] = {}


def price_id(c: stripe.StripeClient, key: str) -> str:
    if key not in _price_cache:
        prices = c.v1.prices.list(params={"lookup_keys": [key], "active": True, "limit": 1})
        if not prices.data:
            raise RuntimeError(f"Preis {key} fehlt in Stripe – deploy/stripe-setup.py ausführen")
        _price_cache[key] = prices.data[0].id
    return _price_cache[key]


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
    update = {f"billing.{k}": v for k, v in fields.items()}
    update["plan"] = fields["plan"] if active else "gratis"
    return update
