"""Stripe für Dranzeit einrichten: Produkte, Preise, Steuersatz, Webhook und Kundenportal. Mehrfach ausführbar.

Auf dem Server als root (Block "Abo-Abrechnung" in deploy/README.md):
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/stripe-setup.py https://dranzeit.de
Den Schlüssel liest das Skript selbst aus /etc/q-me.env.

Mit --test dasselbe in der Stripe-Sandbox für den Testmodus je Laden (Betreiber-Bereich): Schlüssel aus
STRIPE_TEST_SECRET_KEY, Webhook-Geheimnis und Portal nach STRIPE_TEST_WEBHOOK_SECRET und STRIPE_TEST_PORTAL_CONFIG.
Der Sandbox-Webhook zeigt auf dieselbe Adresse wie der echte.

Telefon-Assistent (eigenes Abo, app/libs/telefon_abrechnung.py): Meter, zwei Produkte und ihre Preise. In der Sandbox
immer, im Live-Konto nur mit --telefon (erst nach Stefans Freigabe der Preise).

- Preise netto (tax_behavior exclusive), gefunden über lookup_key (app/libs/stripe_billing.py).
- Umsatzsteuer als fester Steuersatz 19 % (kein Stripe Tax, Stefan 11.11.2026); seine ID kommt nach
  STRIPE_STEUERSATZ bzw. STRIPE_TEST_STEUERSATZ in /etc/q-me.env. Nur diesen Schritt: --nur-steuer
  (braucht beim eingeschränkten Schlüssel das Recht „Tax Rates: Write“).
- Webhook-Geheimnis und Portal-Einstellung schreibt das Skript selbst nach /etc/q-me.env.
  Das Geheimnis erscheint nirgends auf dem Bildschirm.
"""

import os
import sys

sys.path.insert(0, "/opt/q-me/backend")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app.libs.stripe_billing import (  # noqa: E402
    CATALOG, FOUNDER_PRICES, INTERVALS, KEY_ENV, LIVE, PORTAL_ENV, STEUER_ENV, STEUERSATZ, TEST, WEBHOOK_ENV, client,
    ist_steuersatz, lookup_key, stripe_configured,
)
from app.libs import telefon as tel  # noqa: E402
from app.libs.telefon_abrechnung import GRUNDPREIS_KEY, METER_EVENT, MINUTEN_KEY  # noqa: E402

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


def ensure_steuersatz(c, mode: str) -> str:
    """Fester Steuersatz 19 % (netto, Deutschland): vorhandenen nehmen, sonst anlegen; ID in /etc/q-me.env."""
    rate_id = next((r.id for r in c.v1.tax_rates.list(params={"active": True, "limit": 100}).auto_paging_iter() if ist_steuersatz(r)), "")
    if rate_id:
        print(f"Steuersatz vorhanden: {rate_id} (19 %)")
    else:
        rate_id = c.v1.tax_rates.create(params=STEUERSATZ).id
        print(f"Steuersatz angelegt: {rate_id} (19 %, netto, Deutschland)")
    if os.environ.get(STEUER_ENV[mode], "").strip() != rate_id:
        set_env(STEUER_ENV[mode], rate_id)
        os.environ[STEUER_ENV[mode]] = rate_id
        print(f"{STEUER_ENV[mode]} in {ENV_FILE} eingetragen")
    return rate_id


TELEFON_PRODUKTE = {
    # Name steht so auf der Rechnung: zwei Posten, Grundpreis und Minuten
    "telefon_grundpreis": "Telefon-Assistent, Grundpreis mit 100 Minuten",
    "telefon_minuten": "Telefon-Assistent, Minuten",
}


def ensure_telefon(c) -> None:
    """Meter (Formel last: letzter Wert im Monat), Grundpreis 29 € im Voraus, Minuten gestaffelt nach Nutzung"""
    meter = next((m for m in c.v1.billing.meters.list(params={"status": "active", "limit": 100}).auto_paging_iter() if m.event_name == METER_EVENT), None)
    if meter is None:
        meter = c.v1.billing.meters.create(params={
            "display_name": "Dranzeit Telefon-Minuten",
            "event_name": METER_EVENT,
            "default_aggregation": {"formula": "last"},
            "customer_mapping": {"type": "by_id", "event_payload_key": "stripe_customer_id"},
            "value_settings": {"event_payload_key": "value"},
        })
        print(f"Meter angelegt: {METER_EVENT}")
    elif meter.default_aggregation.formula != "last":
        print(f"ACHTUNG: Meter {METER_EVENT} rechnet mit {meter.default_aggregation.formula}, erwartet last")
    existing = {}
    for p in c.v1.products.list(params={"active": True, "limit": 100}).auto_paging_iter():
        art = (p.metadata.to_dict() if p.metadata else {}).get("dranzeit_zusatz")
        if art:
            existing[art] = p.id
    ids = {}
    for art, name in TELEFON_PRODUKTE.items():
        ids[art] = existing.get(art) or c.v1.products.create(params={"name": name, "tax_code": SAAS_TAX_CODE, "metadata": {"dranzeit_zusatz": art}}).id
        if art not in existing:
            print(f"Produkt angelegt: {name}")
    ensure_price(c, ids["telefon_grundpreis"], GRUNDPREIS_KEY, tel.GRUNDPREIS_CENT, "monat", "Telefon-Assistent Grundpreis")
    tiers = [{"up_to": tel.INKLUSIV_MINUTEN, "unit_amount": 0}, {"up_to": "inf", "unit_amount": tel.MINUTENPREIS_CENT}]
    found = c.v1.prices.list(params={"lookup_keys": [MINUTEN_KEY], "active": True, "limit": 1, "expand": ["data.tiers"]}).data
    if found:
        have = [(t.up_to, t.unit_amount) for t in (found[0].tiers or [])]
        if have != [(tel.INKLUSIV_MINUTEN, 0), (None, tel.MINUTENPREIS_CENT)]:
            print(f"ACHTUNG: {MINUTEN_KEY} hat bei Stripe die Stufen {have}, erwartet 1–{tel.INKLUSIV_MINUTEN} für 0, danach {tel.MINUTENPREIS_CENT} Cent")
        return
    c.v1.prices.create(params={
        "product": ids["telefon_minuten"],
        "currency": "eur",
        "billing_scheme": "tiered",
        "tiers_mode": "graduated",
        "tiers": tiers,
        "recurring": {"interval": "month", "usage_type": "metered", "meter": meter.id},
        "tax_behavior": "exclusive",
        "lookup_key": MINUTEN_KEY,
        "nickname": "Telefon-Assistent Minuten",
    })
    print(f"Preis angelegt: {MINUTEN_KEY} (bis {tel.INKLUSIV_MINUTEN} Minuten 0 €, danach {tel.MINUTENPREIS_CENT / 100:.2f} € netto)")


def main() -> None:
    flags = {"--test", "--telefon", "--nur-steuer"}
    args = [a for a in sys.argv[1:] if a not in flags]
    mode = TEST if "--test" in sys.argv[1:] else LIVE
    if len(args) != 1 or not args[0].startswith("https://"):
        sys.exit("Aufruf: stripe-setup.py https://<adresse der app> [--test] [--telefon] [--nur-steuer]")
    base = args[0].rstrip("/")
    load_env()
    if not stripe_configured(mode):
        sys.exit(f"{KEY_ENV[mode]} fehlt in {ENV_FILE}" + (" oder ist kein Testschlüssel (sk_test_/rk_test_)" if mode == TEST else ""))
    webhook_env, portal_env = WEBHOOK_ENV[mode], PORTAL_ENV[mode]
    print("Stripe-Sandbox (Testmodus je Laden)" if mode == TEST else "Stripe")
    c = client(mode)

    ensure_steuersatz(c, mode)
    if "--nur-steuer" in sys.argv[1:]:
        print("Fertig. Jetzt das Backend neu starten: systemctl restart q-me")
        return
    products = ensure_products(c)
    standard_prices: dict[str, list[str]] = {}
    for plan, info in CATALOG.items():
        for interval in INTERVALS:
            pid = ensure_price(c, products[plan], lookup_key(plan, interval), info[interval], interval, f"{info['name']} ({interval})")
            standard_prices.setdefault(plan, []).append(pid)
    for interval, amount in FOUNDER_PRICES.items():
        ensure_price(c, products["laden"], lookup_key("laden", interval, founder=True), amount, interval, f"Dranzeit Laden Gründerpreis ({interval})")
    if mode == TEST or "--telefon" in sys.argv[1:]:
        ensure_telefon(c)
    else:
        print("Telefon-Assistent: im Live-Konto nur mit --telefon")

    url = f"{base}/routes/stripe/webhook"
    all_endpoints = list(c.v1.webhook_endpoints.list(params={"limit": 100}).auto_paging_iter())
    for e in all_endpoints:  # nach einem Umzug: alten Webhook der vorigen Adresse entfernen
        if e.description == "Dranzeit Abos" and e.url != url:
            c.v1.webhook_endpoints.delete(e.id)
            print(f"Alten Webhook entfernt: {e.url}")
    endpoints = [e for e in all_endpoints if e.url == url]
    have_secret = bool(os.environ.get(webhook_env, "").strip())
    if endpoints and have_secret:
        c.v1.webhook_endpoints.update(endpoints[0].id, params={"enabled_events": EVENTS})
        print(f"Webhook vorhanden: {url}")
    else:
        for e in endpoints:  # Geheimnis lässt sich nicht erneut abrufen: alten löschen, neu anlegen
            c.v1.webhook_endpoints.delete(e.id)
        endpoint = c.v1.webhook_endpoints.create(params={"url": url, "enabled_events": EVENTS, "description": "Dranzeit Abos"})
        set_env(webhook_env, endpoint.secret)
        print(f"Webhook angelegt: {url} (Geheimnis in {ENV_FILE} eingetragen)")

    existing_portal = os.environ.get(portal_env, "").strip()
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
        set_env(portal_env, config.id)
        print("Kundenportal eingerichtet")
    print("Fertig. Jetzt das Backend neu starten: systemctl restart q-me")


if __name__ == "__main__":
    main()
