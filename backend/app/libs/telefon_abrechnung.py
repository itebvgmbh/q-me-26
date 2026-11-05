"""Telefon-Assistent als Zusatz: eigenes Stripe-Abo neben dem Tarif, die Minuten über einen Billing Meter.

Aufbau bei Stripe (legt deploy/stripe-setup.py an, Entscheidung Stefan 05.11.2026):
    Produkt „Dranzeit Telefon-Assistent“, Monatsabo mit zwei Posten auf der Rechnung
        dranzeit_telefon_grundpreis_monat   29 € netto im Voraus, 100 Minuten inklusive
        dranzeit_telefon_minuten_monat      nach Nutzung, gestaffelt: Minute 1–100 für 0 €, ab der 101. je 0,20 €
    Meter dranzeit_telefon_minuten mit der Formel „last“: Nach jedem Anruf melden wir die Minuten des laufenden Monats,
        aufgerundet und höchstens bis zum Deckel. Stripe rechnet mit dem letzten Wert im Abrechnungszeitraum, ein
        doppelt geschickter Wert schadet also nicht. Der Abgleich im Hintergrund (abgleich) holt verpasste Meldungen nach.

Warum ein eigenes Abo und kein Posten im Tarif-Abo: Das Kundenportal wechselt keine Tarife in Abos mit mehreren
Produkten oder Nutzungspreisen, ein Jahrestarif verträgt keinen Monatsposten, und in der Testphase des Tarif-Abos
wären die Minuten frei. Kunde und Zahlungsart sind dieselben.

Erkannt wird das Abo an metadata zusatz=telefon (Webhook in app/apis/stripe_webhook). Der Stand steht in
telefon_laeden/{Laden}.zusatz (app/libs/telefon_laeden.py), die Regeln in app/libs/telefon.py.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from app.i18n import t
from app.libs import telefon as tel
from app.libs import telefon_laeden as tl

log = logging.getLogger(__name__)

ZUSATZ = "telefon"  # metadata zusatz am Abo und am Checkout
GRUNDPREIS_KEY = "dranzeit_telefon_grundpreis_monat"
MINUTEN_KEY = "dranzeit_telefon_minuten_monat"
METER_EVENT = "dranzeit_telefon_minuten"
PREIS_KEYS = (GRUNDPREIS_KEY, MINUTEN_KEY)


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


def ist_telefon(subscription: dict) -> bool:
    """Gehört das Stripe-Abo zum Telefon-Assistenten (und nicht zum Tarif)?"""
    if (subscription.get("metadata") or {}).get("zusatz") == ZUSATZ:
        return True
    items = (subscription.get("items") or {}).get("data") or []
    return any(((item.get("price") or {}).get("lookup_key") or "").startswith("dranzeit_telefon_") for item in items)


def felder(subscription: dict, modus: str) -> dict:
    """Was am Laden gespeichert wird (telefon_laeden.zusatz)"""
    items = (subscription.get("items") or {}).get("data") or []
    item = next((i for i in items if (i.get("price") or {}).get("lookup_key") == GRUNDPREIS_KEY), items[0] if items else {})
    return {
        "status": subscription.get("status"),
        "subscriptionId": subscription.get("id"),
        "customerId": subscription.get("customer"),
        "modus": modus,
        "periodeStart": item.get("current_period_start"),
        "periodeEnde": item.get("current_period_end"),
        "cancelAtPeriodEnd": bool(subscription.get("cancel_at_period_end")),
    }


def uebernehmen(db, subscription: dict, modus: str) -> Optional[str]:
    """Stand des Abos an den Laden schreiben (Webhook, Kündigen). Nur für Läden im selben Stripe-Modus.
    Gibt den Laden zurück oder None, wenn übersprungen."""
    from app.libs.shop_privat import stripe_link

    shop_id = (subscription.get("metadata") or {}).get("shopId")
    if not shop_id:
        print(f"Stripe: Telefon-Abo {subscription.get('id')} ohne shopId – übersprungen")
        return None
    snap = db.collection("shops").document(shop_id).get()
    if not snap.exists:
        print(f"Stripe: Laden {shop_id} zum Telefon-Abo {subscription.get('id')} gibt es nicht")
        return None
    laden_modus, ids = stripe_link(db, shop_id, snap.to_dict() or {})
    if laden_modus != modus:
        print(f"Stripe: Telefon-Abo {subscription.get('id')} ({modus}) für Laden {shop_id} im Modus {laden_modus} – übersprungen")
        return None
    if ids.get("customerId") and ids["customerId"] != subscription.get("customer"):
        print(f"Stripe: Telefon-Abo {subscription.get('id')} gehört zu einem anderen Kunden als Laden {shop_id} – übersprungen")
        return None
    bisher = tel.zusatz(tl.eintrag(db, shop_id))
    if bisher.get("subscriptionId") and bisher["subscriptionId"] != subscription.get("id") and bisher.get("status") in tel.GEBUCHT:
        if subscription.get("status") not in tel.GEBUCHT:  # Meldung zu einem alten Abo, das neue läuft
            print(f"Stripe: altes Telefon-Abo {subscription.get('id')} von Laden {shop_id} – übersprungen")
            return None
    tl.zusatz_setzen(db, shop_id, felder(subscription, modus))
    print(f"Stripe: Laden {shop_id}, Telefon-Assistent {subscription.get('status')}" + (" (Sandbox)" if modus != "live" else ""))
    return shop_id


def melden(db, shop_id: str, jetzt: Optional[datetime] = None, stripe_client=None) -> Optional[int]:
    """Minuten des laufenden Monats an Stripe, wenn es mehr sind als zuletzt gemeldet. Gibt den gemeldeten Stand zurück,
    None, wenn es nichts zu melden gab oder Stripe nicht erreichbar war (der Abgleich versucht es wieder)."""
    from app.libs.stripe_billing import client

    jetzt = jetzt or _jetzt()
    with tl.SPERRE:
        daten = tl.eintrag(db, shop_id)
        z = tel.zusatz(daten)
        if z.get("status") not in (*tel.GEBUCHT, *tel.ZAHLUNG_OFFEN) or not z.get("customerId"):
            return None
        if daten.get("periode") != z.get("periodeStart"):
            return None  # in diesem Monat noch nicht telefoniert
        faellig, gemeldet = tel.abzurechnen(daten, jetzt), int(daten.get("gemeldet") or 0)
        if faellig <= gemeldet:
            return None
        # „last“ nimmt das späteste Ereignis: nie zwei in derselben Sekunde, das neue immer danach
        zeit = max(int(jetzt.timestamp()), int(daten.get("gemeldetUm") or 0) + 1)
        try:
            (stripe_client or client(z.get("modus") or "live")).v1.billing.meter_events.create(params={
                "event_name": METER_EVENT,
                "timestamp": zeit,
                "payload": {"stripe_customer_id": z["customerId"], "value": str(faellig)},
            })
        except Exception as e:  # Stripe-Fehler oder kein Netz: beim nächsten Anruf oder im Abgleich noch einmal
            log.warning("Telefon: Minuten von Laden %s nicht an Stripe gemeldet: %s", shop_id, e)
            return None
        db.collection(tel.LAEDEN).document(shop_id).set({"gemeldet": faellig, "gemeldetUm": zeit}, merge=True)
        return faellig


# --- Warnungen --------------------------------------------------------------------------------------------------------


def _monat_key(daten: dict) -> str:
    return "test" if not tel.zusatz(daten).get("status") else str(daten.get("periode") or "")


def faellige_warnung(daten: dict, jetzt: Optional[datetime] = None) -> int:
    """Stufe (80, 100), die der Inhaber noch nicht per Mail bekommen hat, sonst 0"""
    if not tl.zugelassen(daten):
        return 0
    stufe = tel.warnstufe(tel.verbrauch(daten, jetzt)["anteil"])
    gewarnt = daten.get("gewarnt") or {}
    return stufe if stufe and gewarnt.get(str(stufe)) != _monat_key(daten) else 0


def warnmail(stufe: int, daten: dict, name: str, base: str, sprache: str = "de", jetzt: Optional[datetime] = None) -> tuple[str, str, list, str]:
    """(Betreff, Überschrift, Absätze, Knopf) – Absätze schon entschärft und übersetzt"""
    from app.libs.mail import esc
    from app.libs.onboarding_mail import _date

    v = tel.verbrauch(daten, jetzt)
    laden = esc(name)
    if v["art"] == "test":
        if stufe >= 100:
            betreff = t("Telefon-Assistent: Testminuten aufgebraucht", sprache)
            absaetze = [t("Die {grenze} Testminuten für {laden} sind aufgebraucht. Anrufer hören jetzt nur noch eine kurze Ansage.", sprache, grenze=v["grenze"], laden=laden)]
        else:
            betreff = t("Telefon-Assistent: 80 % der Testminuten verbraucht", sprache)
            absaetze = [t("Von den {grenze} Testminuten für {laden} sind {minuten} verbraucht. Danach hören Anrufer nur noch eine kurze Ansage.", sprache, grenze=v["grenze"], minuten=v["minuten"], laden=laden)]
        absaetze.append(t("Damit er weiter abnimmt, buch den Zusatz: 29 € netto im Monat mit 100 Minuten, danach 0,20 € je Minute.", sprache))
    else:
        euro = f"{v['kostenCent'] / 100:.2f}".replace(".", ",")
        ende = tel.zusatz(daten).get("periodeEnde")
        if stufe >= 100:
            betreff = t("Telefon-Assistent: Kostendeckel erreicht", sprache)
            absaetze = [t("Der Assistent von {laden} hat diesen Monat {minuten} Minuten telefoniert und damit deinen Deckel von {deckel} € erreicht. Anrufer hören jetzt nur noch eine kurze Ansage.", sprache, laden=laden, minuten=v["minuten"], deckel=v["deckel"])]
            if ende:
                absaetze.append(t("Ab dem {datum} nimmt er wieder ab. Soll er schon vorher weitermachen, erhöh den Deckel.", sprache, datum=_date(datetime.fromtimestamp(int(ende), tz=timezone.utc), sprache)))
        else:
            betreff = t("Telefon-Assistent: 80 % des Kostendeckels erreicht", sprache)
            absaetze = [t("Der Assistent von {laden} hat diesen Monat {minuten} Minuten telefoniert, das sind {betrag} € netto. Bei {deckel} € ({grenze} Minuten) hört er bis zum Monatsende auf.", sprache, laden=laden, minuten=v["minuten"], betrag=euro, deckel=v["deckel"], grenze=v["grenze"])]
            absaetze.append(t("Den Deckel kannst du jederzeit ändern.", sprache))
    return betreff, betreff, absaetze, t("Zum Telefon-Assistenten", sprache)


def warnen(db, shop_id: str, jetzt: Optional[datetime] = None) -> int:
    """Mail an den Inhaber bei 80 % und 100 % (Testminuten oder Deckel), je Stufe einmal im Monat. Gibt die Stufe zurück."""
    from app.libs.mail import MailError, branded_html, public_url, send_mail
    from app.libs.onboarding_mail import KONTAKT, _owner_email, _owner_language, _plain, is_test_address

    with tl.SPERRE:
        daten = tl.eintrag(db, shop_id)
        stufe = faellige_warnung(daten, jetzt)
        if not stufe:
            return 0
        gewarnt = dict(daten.get("gewarnt") or {})
        for s in tel.WARNSTUFEN:
            if s <= stufe:
                gewarnt[str(s)] = _monat_key(daten)
        db.collection(tel.LAEDEN).document(shop_id).set({"gewarnt": gewarnt}, merge=True)
    snap = db.collection("shops").document(shop_id).get()
    shop = (snap.to_dict() or {}) if snap.exists else {}
    an = _owner_email(shop) if shop.get("owner") else ""
    if not an or is_test_address(an):
        return stufe
    sprache = _owner_language(db, shop)
    base = public_url()
    betreff, kopf, absaetze, knopf = warnmail(stufe, daten, shop.get("name") or "", base, sprache, jetzt)
    ziel = f"{base}/telefon-assistent"
    text = "\n\n".join([kopf, *[_plain(a) for a in absaetze], f"{knopf}: {ziel}"])
    try:
        send_mail(an, betreff, branded_html(kopf, absaetze, knopf, ziel, sprache=sprache), text, reply_to=KONTAKT)
    except MailError as e:
        print(f"Telefon: Warnung {stufe} % an Laden {shop_id} nicht verschickt: {e}")
    return stufe


def nach_anruf(db, shop_id: str, jetzt: Optional[datetime] = None) -> None:
    """Nach jedem gezählten Anruf: Minuten an Stripe, bei 80 % und 100 % Bescheid sagen"""
    melden(db, shop_id, jetzt)
    warnen(db, shop_id, jetzt)


def abgleich(db, jetzt: Optional[datetime] = None) -> int:
    """Im Hintergrund (app/apis/schedulers): verpasste Meldungen an Stripe nachholen. Gibt die Zahl der Meldungen zurück."""
    gemeldet = 0
    for snap in db.collection(tel.LAEDEN).stream():
        if tel.zusatz(snap.to_dict() or {}).get("status") and melden(db, snap.id, jetzt) is not None:
            gemeldet += 1
    return gemeldet


def tarif_beendet(db, shop_id: str, modus: str) -> None:
    """Das Tarif-Abo ist zu Ende (ab Solo nötig): Den Zusatz zum Ende seines Monats kündigen, nicht sofort, er ist bezahlt"""
    from app.libs.stripe_billing import client

    z = tel.zusatz(tl.eintrag(db, shop_id))
    if z.get("status") not in tel.GEBUCHT or z.get("cancelAtPeriodEnd") or z.get("modus") != modus or not z.get("subscriptionId"):
        return
    try:
        sub = client(modus).v1.subscriptions.update(z["subscriptionId"], params={"cancel_at_period_end": True})
        uebernehmen(db, sub.to_dict(), modus)
        print(f"Stripe: Tarif von Laden {shop_id} beendet – Telefon-Assistent zum Monatsende gekündigt")
    except Exception as e:
        print(f"Stripe: Telefon-Assistent von Laden {shop_id} nicht gekündigt: {e}")


def vergessen(db, shop_id: str, modus: str, beenden: bool = False) -> str:
    """Betreiber: Verknüpfung lösen oder Testmodus aus. Gehört der Zusatz zu diesem Stripe-Modus, steht er danach nicht
    mehr am Laden; mit beenden wird das Abo bei Stripe sofort beendet (nur für die Sandbox gedacht). Gibt die Abo-ID zurück."""
    from app.libs.stripe_billing import client

    z = tel.zusatz(tl.eintrag(db, shop_id))
    if not z.get("status") or (z.get("modus") or "live") != modus:
        return ""
    if beenden and z.get("subscriptionId") and z.get("status") in (*tel.GEBUCHT, *tel.ZAHLUNG_OFFEN):
        try:
            client(modus).v1.subscriptions.cancel(z["subscriptionId"])
        except Exception as e:  # klappt das nicht, schadet es auch nicht: Meldungen dazu werden übersprungen
            print(f"Telefon-Abo {z['subscriptionId']} von Laden {shop_id} nicht beendet: {e}")
    tl.zusatz_setzen(db, shop_id, {})
    return z.get("subscriptionId") or ""
