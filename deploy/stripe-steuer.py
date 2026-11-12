"""Fester Steuersatz 19 % statt Stripe Tax (Stefan, 11.11.2026): prüfen und laufende Abos umstellen.

Vorher einmal den Steuersatz anlegen (stripe-setup.py … --nur-steuer, Block in deploy/README.md „Umsatzsteuer“).
Auf dem Server als root:
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/stripe-steuer.py pruefen [--test]
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/stripe-steuer.py abos [--test] [--ausfuehren]

pruefen  Legt eine Checkout-Sitzung mit denselben Angaben wie die App an (Tarif Solo, monatlich) und beendet sie sofort
         wieder: kein Kunde, keine Zahlung. Die Sitzung muss 19 % Umsatzsteuer ausweisen. Mit --test (Sandbox)
         zusätzlich: Wegwerf-Kunde mit Testkarte, Abo mit 19 %, die erste Rechnung muss 19 % haben und als
         E-Rechnung (XRechnung) durchgehen. Danach Abo und Kunde wieder weg.
abos     Zeigt alle laufenden Abos und ob sie schon den festen Satz haben (Abos aus der Zeit davor rechnen mit
         automatic_tax, also 0 %). Mit --ausfuehren stellt es sie um: automatic_tax aus, 19 % am Abo. Gilt ab der
         nächsten Rechnung, ohne anteilige Verrechnung. Ohne --ausfuehren ändert es nichts.
"""
import os
import sys

sys.path.insert(0, "/opt/q-me/backend")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app.libs import invoices  # noqa: E402
from app.libs.stripe_billing import LIVE, TEST, client, lookup_key, price_id, steuer, steuersatz_id, stripe_configured  # noqa: E402

ENV_FILE = os.environ.get("QME_ENV_FILE", "/etc/q-me.env")
EXPAND = ["total_taxes.tax_rate_details.tax_rate"]  # wie app/apis/invoices
LAUFEND = ("active", "trialing", "past_due", "unpaid", "incomplete", "paused")


def load_env() -> None:
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            name, sep, value = line.strip().partition("=")
            if sep and name.startswith("STRIPE_") and not os.environ.get(name):
                os.environ[name] = value.strip()


def neunzehn(netto: int) -> int:
    return round(netto * 19 / 100)


def sitzung_pruefen(c, mode: str) -> list[str]:
    """Checkout wie in app/apis/billing, nur ohne Kunden; danach sofort beenden."""
    fehler = []
    sitzung = c.v1.checkout.sessions.create(params={
        "mode": "subscription",
        "line_items": [{"price": price_id(c, lookup_key("solo", "monat"), mode), "quantity": 1}],
        "subscription_data": {"metadata": {"probe": "steuer"}, **steuer(c, mode)},
        "metadata": {"probe": "steuer"},
        "tax_id_collection": {"enabled": True},
        "billing_address_collection": "required",
        "locale": "de",
        "success_url": "https://dranzeit.de/tarif?probe=1",
        "cancel_url": "https://dranzeit.de/tarif",
    })
    try:
        netto, steuer_cent = sitzung.amount_subtotal, (sitzung.total_details.amount_tax if sitzung.total_details else 0)
        print(f"Checkout-Sitzung {sitzung.id}: {netto / 100:.2f} € netto + {steuer_cent / 100:.2f} € USt.")
        if steuer_cent != neunzehn(netto):
            fehler.append(f"Checkout: {steuer_cent} Cent Steuer, erwartet {neunzehn(netto)}")
    finally:
        c.v1.checkout.sessions.expire(sitzung.id)
        print("Checkout-Sitzung beendet")
    return fehler


def abo_pruefen(c) -> list[str]:
    """Nur Sandbox: echtes Abo mit Testkarte, erste Rechnung mit 19 % und als E-Rechnung."""
    fehler = []
    kunde = c.v1.customers.create(params={
        "name": "Steuer-Probe (wird gleich gelöscht)", "email": "steuer-probe@example.com",
        "payment_method": "pm_card_visa", "invoice_settings": {"default_payment_method": "pm_card_visa"},
        "address": {"country": "DE", "postal_code": "13469", "city": "Berlin", "line1": "Zehntwerderweg 201A"},
        "metadata": {"probe": "steuer"},
    })
    abo = None
    try:
        abo = c.v1.subscriptions.create(params={
            "customer": kunde.id,
            "items": [{"price": price_id(c, lookup_key("solo", "monat"), TEST), "quantity": 1}],
            "metadata": {"probe": "steuer"},
            **steuer(c, TEST),
        })
        inv = c.v1.invoices.retrieve(abo.latest_invoice, params={"expand": EXPAND}).to_dict()
        netto, steuer_cent = inv["subtotal"], invoices._tax_total(inv)
        gruende = sorted({str(t.get("taxability_reason")) for line in inv["lines"]["data"] for t in line.get("taxes") or []})
        print(f"Rechnung {inv.get('number')} ({inv.get('status')}): {netto / 100:.2f} € netto + {steuer_cent / 100:.2f} € USt., "
              f"Begründung von Stripe: {', '.join(gruende)}")
        if steuer_cent != neunzehn(netto):
            fehler.append(f"Rechnung: {steuer_cent} Cent Steuer, erwartet {neunzehn(netto)}")
        try:
            invoices.einvoice_check(inv)
            xml = invoices.build_xrechnung(inv, "steuer-probe").decode("utf-8")
            if "<ram:CategoryCode>S</ram:CategoryCode>" not in xml or "<ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>" not in xml:
                fehler.append("E-Rechnung ohne Kategorie S / 19 %")
            else:
                print("E-Rechnung: Kategorie S, 19 %")
        except invoices.NotSupported as e:
            fehler.append(f"E-Rechnung abgelehnt: {e}")
    finally:
        if abo is not None:
            c.v1.subscriptions.cancel(abo.id)
        c.v1.customers.delete(kunde.id)
        print("Probe-Abo und -Kunde gelöscht")
    return fehler


def abos(c, mode: str, ausfuehren: bool) -> int:
    rate_id = steuersatz_id(c, mode)
    umstellen = []
    for s in c.v1.subscriptions.list(params={"status": "all", "limit": 100}).auto_paging_iter():
        if s.status not in LAUFEND:
            continue
        meta = s.metadata.to_dict() if s.metadata else {}
        auto = bool(s.automatic_tax and s.automatic_tax.enabled)
        saetze = [r if isinstance(r, str) else r.id for r in (s.default_tax_rates or [])]
        passt = not auto and saetze == [rate_id]
        art = "Telefon" if meta.get("zusatz") else "Tarif"
        print(f"{s.id} {s.status:9} {art:7} Laden {meta.get('shopId', '?')}: automatic_tax {'an' if auto else 'aus'}, "
              f"Steuersatz {', '.join(saetze) or '–'} → {'passt' if passt else 'umstellen'}")
        if not passt:
            umstellen.append(s.id)
    if not umstellen:
        print("Alle laufenden Abos haben den festen Satz.")
        return 0
    if not ausfuehren:
        print(f"{len(umstellen)} Abo(s) umzustellen. Nichts geändert; mit --ausfuehren umstellen.")
        return 0
    for sub_id in umstellen:
        c.v1.subscriptions.update(sub_id, params={
            "automatic_tax": {"enabled": False}, "default_tax_rates": [rate_id], "proration_behavior": "none",
        })
        print(f"{sub_id}: umgestellt auf 19 %")
    return 0


def main() -> int:
    args = sys.argv[1:]
    mode = TEST if "--test" in args else LIVE
    befehl = next((a for a in args if not a.startswith("--")), "")
    if befehl not in ("pruefen", "abos"):
        sys.exit("Aufruf: stripe-steuer.py pruefen|abos [--test] [--ausfuehren]")
    load_env()
    if not stripe_configured(mode):
        sys.exit("Stripe-Schlüssel fehlt" + (" (Sandbox: nur Testschlüssel)" if mode == TEST else ""))
    c = client(mode)
    print(f"Stripe {'Sandbox' if mode == TEST else 'live'}, Steuersatz {steuersatz_id(c, mode)}")
    if befehl == "abos":
        return abos(c, mode, "--ausfuehren" in args)
    fehler = sitzung_pruefen(c, mode)
    if mode == TEST:
        fehler += abo_pruefen(c)
    for f in fehler:
        print(f"FEHLER: {f}")
    print("Alles wie erwartet." if not fehler else f"{len(fehler)} Abweichung(en).")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
