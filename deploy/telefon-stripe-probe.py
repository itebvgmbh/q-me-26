"""Probe in der Stripe-Sandbox: Rechnet Stripe den Telefon-Assistenten so ab, wie wir es meinen?

Legt einen Wegwerf-Kunden mit Testkarte an, bucht den Zusatz (Grundpreis + Minuten) und meldet Minuten wie nach
Anrufen (Formel „last“: 120, dann 148 → abgerechnet werden 148, nicht 268). Prüft die Vorschau der nächsten Rechnung:
29 € Grundpreis, 48 × 0,20 € = 9,60 € für die Minuten über 100. Danach Abo und Kunde wieder weg. Nur Sandbox.

Auf dem Server als root (nach stripe-setup.py --test):
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/telefon-stripe-probe.py
"""
import os
import sys
import time

sys.path.insert(0, "/opt/q-me/backend")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app.libs import telefon as tel  # noqa: E402
from app.libs.stripe_billing import TEST, client, price_id, steuer, stripe_configured  # noqa: E402
from app.libs.telefon_abrechnung import GRUNDPREIS_KEY, METER_EVENT, MINUTEN_KEY  # noqa: E402

ENV_FILE = os.environ.get("QME_ENV_FILE", "/etc/q-me.env")
WARTEN = 180  # Sekunden: Stripe verarbeitet Meter-Ereignisse nicht sofort


def load_env() -> None:
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            name, sep, value = line.strip().partition("=")
            if sep and name.startswith("STRIPE_TEST_") and not os.environ.get(name):
                os.environ[name] = value.strip()


def main() -> int:
    load_env()
    if not stripe_configured(TEST):
        sys.exit("STRIPE_TEST_SECRET_KEY fehlt oder ist kein Testschlüssel")
    c = client(TEST)
    grund, minuten = price_id(c, GRUNDPREIS_KEY, TEST), price_id(c, MINUTEN_KEY, TEST)
    kunde = c.v1.customers.create(params={
        "name": "Telefon-Probe (wird gleich gelöscht)", "email": "telefon-probe@example.com",
        "payment_method": "pm_card_visa", "invoice_settings": {"default_payment_method": "pm_card_visa"},
        "address": {"country": "DE", "postal_code": "13469", "city": "Berlin", "line1": "Zehntwerderweg 201A"},
        "metadata": {"probe": "telefon"},
    })
    fehler = []
    try:
        abo = c.v1.subscriptions.create(params={
            "customer": kunde.id,
            "items": [{"price": grund, "quantity": 1}, {"price": minuten}],
            "metadata": {"zusatz": "telefon", "probe": "telefon"},
            **steuer(c, TEST),  # feste 19 % wie im Checkout
        })
        print(f"Abo {abo.id}: {abo.status}")
        if abo.status != "active":
            fehler.append(f"Abo ist {abo.status}, erwartet active")
        erste = c.v1.invoices.retrieve(abo.latest_invoice)
        print(f"Erste Rechnung: {erste.subtotal / 100:.2f} € netto (Grundpreis im Voraus)")
        if erste.subtotal != tel.GRUNDPREIS_CENT:
            fehler.append(f"erste Rechnung {erste.subtotal} Cent, erwartet {tel.GRUNDPREIS_CENT}")
        jetzt = int(time.time())
        for wert, zeit in ((120, jetzt - 60), (148, jetzt - 30)):
            c.v1.billing.meter_events.create(params={"event_name": METER_EVENT, "timestamp": zeit,
                                                     "payload": {"stripe_customer_id": kunde.id, "value": str(wert)}})
        print("Gemeldet: 120, dann 148 Minuten")
        erwartet = (148 - tel.INKLUSIV_MINUTEN) * tel.MINUTENPREIS_CENT
        ende = time.time() + WARTEN
        betrag = None
        while time.time() < ende:
            vorschau = c.v1.invoices.create_preview(params={"customer": kunde.id, "subscription": abo.id})
            zeilen = [z.to_dict() for z in vorschau.lines.auto_paging_iter()]  # seit SDK 15 keine dicts mehr
            nutzung = [z for z in zeilen if ((z.get("pricing") or {}).get("price_details") or {}).get("price") == minuten]
            betrag = sum(z["amount"] for z in nutzung)
            if betrag == erwartet:
                break
            time.sleep(10)
        for z in zeilen:
            print(f"  Posten: {z.get('description')} – {z['amount'] / 100:.2f} €")
        print(f"Minuten in der Vorschau: {(betrag or 0) / 100:.2f} € netto, erwartet {erwartet / 100:.2f} €")
        if betrag != erwartet:
            fehler.append(f"Minuten {betrag} Cent, erwartet {erwartet} (Formel last + Stufen 1–100 frei)")
    finally:
        c.v1.customers.delete(kunde.id)  # beendet auch das Abo
        print(f"Probe-Kunde {kunde.id} gelöscht")
    print("Probe bestanden." if not fehler else "FEHLER: " + "; ".join(fehler))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
