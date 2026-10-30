"""Stripe für Dranzeit einrichten: Produkte, Preise, Webhook und Kundenportal. Mehrfach ausführbar.

Auf dem Server als root (Block "Abo-Abrechnung" in deploy/README.md):
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/stripe-setup.py https://q-me.spielmacherei.de
Den Schlüssel liest das Skript selbst aus /etc/q-me.env.

- Preise netto (tax_behavior exclusive), gefunden über lookup_key (app/libs/stripe_billing.py).
- Webhook-Geheimnis und Portal-Einstellung schreibt das Skript selbst nach /etc/q-me.env.
  Das Geheimnis erscheint nirgends auf dem Bildschirm.
"""

import os
import sys

sys.path.insert(0, "/opt/q-me/backend")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app.libs.stripe_billing import CATALOG, FOUNDER_PRICES, INTERVALS, client, lookup_key  # noqa: E402

ENV_FILE = os.environ.get("QME_ENV_FILE", "/etc/q-me.env")


def load_env() -> None:
    """Stripe-Einträge aus /etc/q-me.env übernehmen (ohne die Datei per Shell einzulesen)."""
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            name, sep, value = line.strip().partition("=")
            if sep and name.startswith("STRIPE_") and not os.environ.get(name):
                os.environ[name] = value.strip()
EVENTS = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
]
SAAS_TAX_CODE = "txcd_10103001"  # Software as a Service, geschäftliche Nutzung


def set_env(name: str, value: str) -> None:
    with open(ENV_FILE, encoding="utf-8") as f:
        lines = [line for line in f.read().splitlines() if not line.startswith(f"{name}=")]
    lines.append(f"{name}={value}")
    tmp = ENV_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    st = os.stat(ENV_FILE)
    os.chmod(tmp, st.st_mode)
    os.chown(tmp, st.st_uid, st.st_gid)
    os.replace(tmp, ENV_FILE)


def ensure_products(c) -> dict[str, str]:
    existing = {}
    for p in c.v1.products.list(params={"active": True, "limit": 100}).auto_paging_iter():
        plan = (p.metadata.to_dict() if p.metadata else {}).get("dranzeit_plan")
        if plan:
            existing[plan] = p.id
    ids = {}
    for plan, info in CATALOG.items():
        if existing.get(plan):
            ids[plan] = existing[plan]
            continue
        product = c.v1.products.create(params={"name": info["name"], "tax_code": SAAS_TAX_CODE, "metadata": {"dranzeit_plan": plan}})
        ids[plan] = product.id
        print(f"Produkt angelegt: {info['name']}")
    return ids


def ensure_price(c, product_id: str, key: str, amount: int, interval: str, nickname: str) -> str:
    found = c.v1.prices.list(params={"lookup_keys": [key], "active": True, "limit": 1}).data
    if found:
        if found[0].unit_amount != amount:
            print(f"ACHTUNG: {key} kostet in Stripe {found[0].unit_amount / 100:.2f} €, erwartet {amount / 100:.2f} €")
        return found[0].id
    price = c.v1.prices.create(
        params={
            "product": product_id,
            "currency": "eur",
            "unit_amount": amount,
            "recurring": {"interval": INTERVALS[interval]},
            "tax_behavior": "exclusive",
            "lookup_key": key,
            "nickname": nickname,
        }
    )
    print(f"Preis angelegt: {key} ({amount / 100:.2f} € netto)")
    return price.id


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
        sys.exit("Aufruf: stripe-setup.py https://<adresse der app>")
    base = sys.argv[1].rstrip("/")
    load_env()
    c = client()

    products = ensure_products(c)
    standard_prices: dict[str, list[str]] = {}
    for plan, info in CATALOG.items():
        for interval in INTERVALS:
            pid = ensure_price(c, products[plan], lookup_key(plan, interval), info[interval], interval, f"{info['name']} ({interval})")
            standard_prices.setdefault(plan, []).append(pid)
    for interval, amount in FOUNDER_PRICES.items():
        ensure_price(c, products["laden"], lookup_key("laden", interval, founder=True), amount, interval, f"Dranzeit Laden Gründerpreis ({interval})")

    url = f"{base}/routes/stripe/webhook"
    all_endpoints = list(c.v1.webhook_endpoints.list(params={"limit": 100}).auto_paging_iter())
    for e in all_endpoints:  # nach einem Umzug: alten Webhook der vorigen Adresse entfernen
        if e.description == "Dranzeit Abos" and e.url != url:
            c.v1.webhook_endpoints.delete(e.id)
            print(f"Alten Webhook entfernt: {e.url}")
    endpoints = [e for e in all_endpoints if e.url == url]
    have_secret = bool(os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip())
    if endpoints and have_secret:
        c.v1.webhook_endpoints.update(endpoints[0].id, params={"enabled_events": EVENTS})
        print(f"Webhook vorhanden: {url}")
    else:
        for e in endpoints:  # Geheimnis lässt sich nicht erneut abrufen: alten löschen, neu anlegen
            c.v1.webhook_endpoints.delete(e.id)
        endpoint = c.v1.webhook_endpoints.create(params={"url": url, "enabled_events": EVENTS, "description": "Dranzeit Abos"})
        set_env("STRIPE_WEBHOOK_SECRET", endpoint.secret)
        print(f"Webhook angelegt: {url} (Geheimnis in {ENV_FILE} eingetragen)")

    existing_portal = os.environ.get("STRIPE_PORTAL_CONFIG", "").strip()
    if existing_portal:  # nach einem Umzug: Links im Kundenportal auf die neue Adresse
        c.v1.billing_portal.configurations.update(
            existing_portal,
            params={
                "business_profile": {"privacy_policy_url": f"{base}/datenschutz", "terms_of_service_url": f"{base}/agb"},
                "default_return_url": f"{base}/tarif",
            },
        )
        print(f"Kundenportal zeigt auf {base}")
    if not existing_portal:
        config = c.v1.billing_portal.configurations.create(
            params={
                "business_profile": {
                    "headline": "Dranzeit – Abo verwalten",
                    "privacy_policy_url": f"{base}/datenschutz",
                    "terms_of_service_url": f"{base}/agb",
                },
                "features": {
                    "customer_update": {"enabled": True, "allowed_updates": ["email", "address", "name", "tax_id"]},
                    "invoice_history": {"enabled": True},
                    "payment_method_update": {"enabled": True},
                    "subscription_cancel": {"enabled": True, "mode": "at_period_end"},
                    "subscription_update": {
                        "enabled": True,
                        "default_allowed_updates": ["price"],
                        "proration_behavior": "create_prorations",
                        "products": [{"product": products[p], "prices": ids} for p, ids in standard_prices.items()],
                    },
                },
                "default_return_url": f"{base}/tarif",
            }
        )
        set_env("STRIPE_PORTAL_CONFIG", config.id)
        print("Kundenportal eingerichtet")
    print("Fertig. Jetzt das Backend neu starten: systemctl restart q-me")


if __name__ == "__main__":
    main()
