"""Probe in der Stripe-Sandbox: Kommt der ganze Abo-Ablauf eines Ladens am Server an?

Die Checkout-Seite von Stripe hat einen Bot-Schutz, deshalb geht diese Probe über die API: Sie legt für den Testladen
„Testbarb“ (steht im Betreiber-Bereich auf Sandbox) einen Wegwerf-Kunden mit Testuhr an, bezahlt mit Stripes
Test-Zahlungsmittel und spielt durch:

  1. Abo Laden (Gründerpreis) abschließen  -> Laden hat Tarif laden, Abo active, erste Rechnung mit 19 %
  2. Tarif wechseln auf Team               -> Laden hat Tarif team
  3. Folgemonat mit abgelehnter Karte      -> Abo past_due, Laden behält den Tarif (Mahnlauf)
  4. Kündigen                              -> Abo canceled, Laden fällt auf gratis

Geprüft wird jeweils, was der Webhook (/routes/stripe/webhook, Sandbox-Geheimnis) am Laden gespeichert hat. Zum
Schluss löscht die Probe Testuhr, Kunde und Abo in der Sandbox und stellt Tarif und Abrechnung des Testladens wieder
her. Nur Sandbox, kein Geld, keine Mail an echte Adressen.

Auf dem Server als root:
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/abo-sandbox-probe.py
"""
import os
import sys
import time

sys.path.insert(0, "/opt/q-me/backend")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

ENV_FILE = os.environ.get("QME_ENV_FILE", "/etc/q-me.env")
SHOP = os.environ.get("QME_ABO_PROBE_SHOP", "U7A84y5UJQtwVGGlK6eK")  # Testbarb
WARTEN = 90  # Sekunden je Schritt, bis der Webhook den Laden geändert hat


def load_env() -> None:
    """Wie systemd (EnvironmentFile): alle Zeilen NAME=WERT, ohne sie auszugeben"""
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            name, sep, value = line.partition("=")
            if sep and not os.environ.get(name):
                os.environ[name] = value.strip().strip('"').strip("'")


load_env()

from app.apis.firebase_utils import get_firestore_db  # noqa: E402
from app.libs.shop_privat import TEST, privat_ref, save_stripe_ids, stripe_link  # noqa: E402
from app.libs.shop_privat import TEST_DOC  # noqa: E402
from app.libs.stripe_billing import client, lookup_key, price_id, stripe_configured  # noqa: E402
from app.libs.stripe_billing import steuer as feste_steuer  # noqa: E402  (main hat eine Variable steuer)

ergebnis: list[tuple[str, bool, str]] = []


def pruefe(name: str, ok: bool, detail: str = "") -> None:
    ergebnis.append((name, ok, detail))
    print(f"{'OK  ' if ok else 'FEHL'} {name}" + (f" ({detail})" if detail else ""))


def laden(db) -> dict:
    return db.collection("shops").document(SHOP).get().to_dict() or {}


def warte_auf(db, bedingung, beschreibung: str) -> dict:
    ende = time.time() + WARTEN
    while time.time() < ende:
        shop = laden(db)
        if bedingung(shop):
            return shop
        time.sleep(3)
    print(f"     … nach {WARTEN} s noch nicht: {beschreibung}")
    return laden(db)


def warte_uhr(c, uhr_id: str) -> None:
    for _ in range(90):
        if c.v1.test_helpers.test_clocks.retrieve(uhr_id).status == "ready":
            return
        time.sleep(2)


def main() -> int:
    if not stripe_configured(TEST):
        sys.exit("STRIPE_TEST_SECRET_KEY fehlt oder ist kein Testschlüssel")
    db = get_firestore_db()
    shop = laden(db)
    modus, ids_vorher = stripe_link(db, SHOP, shop)
    if not shop or modus != TEST:
        sys.exit(f"Abbruch: Laden {SHOP} gibt es nicht oder er steht nicht auf Sandbox (Betreiber-Bereich)")
    vorher = {"plan": shop.get("plan"), "billing": shop.get("billing")}
    print(f"Laden {shop.get('name')} ({SHOP}), vorher Tarif {vorher['plan']}")
    c = client(TEST)
    uhr = c.v1.test_helpers.test_clocks.create(params={"frozen_time": int(time.time()), "name": "Dranzeit Abo-Probe"})
    try:
        kunde = c.v1.customers.create(params={
            "name": f"{shop.get('name')} (Abo-Probe)", "email": "abo-probe@example.com", "preferred_locales": ["de"],
            "address": {"country": "DE", "postal_code": "13469", "city": "Berlin", "line1": "Teststraße 1"},
            "metadata": {"shopId": SHOP, "probe": "abo"}, "test_clock": uhr.id,
        })
        karte = c.v1.payment_methods.attach("pm_card_visa", params={"customer": kunde.id})
        c.v1.customers.update(kunde.id, params={"invoice_settings": {"default_payment_method": karte.id}})
        save_stripe_ids(db, SHOP, customer_id=kunde.id, mode=TEST)  # wie der Checkout

        # 1. Abschluss
        preis = lookup_key("laden", "monat", bool(shop.get("founder")))
        abo = c.v1.subscriptions.create(params={
            "customer": kunde.id, "items": [{"price": price_id(c, preis, TEST)}],
            "metadata": {"shopId": SHOP}, **feste_steuer(c, TEST),  # feste 19 % wie im Checkout (app/libs/stripe_billing.py)
        })
        pruefe("Abo abgeschlossen", abo.status == "active", f"{preis}, {abo.status}")
        rechnung = c.v1.invoices.retrieve(abo.latest_invoice)
        steuer = rechnung.total - (rechnung.total_excluding_tax or 0)
        pruefe("Erste Rechnung mit 19 % Umsatzsteuer", rechnung.subtotal > 0 and abs(steuer - round(rechnung.subtotal * 0.19)) <= 1,
               f"netto {rechnung.subtotal / 100:.2f} €, Steuer {steuer / 100:.2f} €, {rechnung.status}")
        s = warte_auf(db, lambda x: (x.get("billing") or {}).get("status") == "active" and x.get("plan") == "laden", "Tarif laden, active")
        pruefe("Webhook: Laden hat Tarif laden, Abo active", s.get("plan") == "laden" and (s.get("billing") or {}).get("status") == "active",
               f"plan {s.get('plan')}, billing {(s.get('billing') or {}).get('status')}")

        # 2. Wechsel auf Team
        abo = c.v1.subscriptions.retrieve(abo.id)
        c.v1.subscriptions.update(abo.id, params={
            "items": [{"id": abo["items"].data[0].id, "price": price_id(c, lookup_key("team", "monat"), TEST)}],
            "proration_behavior": "always_invoice",
        })
        s = warte_auf(db, lambda x: x.get("plan") == "team", "Tarif team")
        pruefe("Webhook: Tarifwechsel auf team", s.get("plan") == "team", f"plan {s.get('plan')}")

        # 3. Folgemonat, Karte wird abgelehnt
        schlecht = c.v1.payment_methods.attach("pm_card_chargeCustomerFail", params={"customer": kunde.id})
        c.v1.customers.update(kunde.id, params={"invoice_settings": {"default_payment_method": schlecht.id}})
        c.v1.subscriptions.update(abo.id, params={"default_payment_method": schlecht.id})
        jetzt = c.v1.test_helpers.test_clocks.retrieve(uhr.id).frozen_time
        c.v1.test_helpers.test_clocks.advance(uhr.id, params={"frozen_time": jetzt + 32 * 86400})
        warte_uhr(c, uhr.id)
        abo = c.v1.subscriptions.retrieve(abo.id)
        pruefe("Folgemonat: Zahlung abgelehnt, Abo past_due", abo.status == "past_due", abo.status)
        s = warte_auf(db, lambda x: (x.get("billing") or {}).get("status") == "past_due", "billing past_due")
        pruefe("Webhook: Laden zeigt Zahlung offen, Tarif bleibt", (s.get("billing") or {}).get("status") == "past_due" and s.get("plan") == "team",
               f"plan {s.get('plan')}, billing {(s.get('billing') or {}).get('status')}")

        # 4. Kündigen
        c.v1.subscriptions.cancel(abo.id)
        s = warte_auf(db, lambda x: (x.get("billing") or {}).get("status") == "canceled", "billing canceled")
        pruefe("Webhook: gekündigt, Laden fällt auf gratis", (s.get("billing") or {}).get("status") == "canceled" and s.get("plan") == "gratis",
               f"plan {s.get('plan')}, billing {(s.get('billing') or {}).get('status')}")
    except Exception as e:  # Stripe- oder Datenbankfehler: trotzdem aufräumen
        pruefe("Probe ohne Fehler durchgelaufen", False, f"{type(e).__name__}: {str(e)[:300]}")
    finally:
        c.v1.test_helpers.test_clocks.delete(uhr.id)  # nimmt Kunde und Abo mit
        time.sleep(5)  # letzte Meldungen (Abo gelöscht) abwarten, dann Testladen zurücksetzen
        db.collection("shops").document(SHOP).update(vorher)
        privat_ref(db, SHOP, TEST_DOC).set({"customerId": ids_vorher.get("customerId"), "subscriptionId": ids_vorher.get("subscriptionId")}, merge=True)
        print(f"Aufgeräumt: Testuhr samt Kunde gelöscht, {shop.get('name')} wieder auf Tarif {vorher['plan']}")

    fehler = [n for n, ok, _ in ergebnis if not ok]
    print(f"\n{len(ergebnis) - len(fehler)} von {len(ergebnis)} Prüfungen bestanden" + (f"; FEHL: {', '.join(fehler)}" if fehler else ""))
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
