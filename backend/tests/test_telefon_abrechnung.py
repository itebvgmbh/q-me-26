"""
Tests für den Telefon-Assistenten als bezahlten Zusatz: Preisregeln, Zählung je Abrechnungsmonat, Meldung an Stripe,
Deckel, Warnungen, Kündigung, Webhook und das Zubuchen (app/libs/telefon.py, telefon_laeden.py, telefon_abrechnung.py,
app/apis/telefon_einrichtung, app/apis/stripe_webhook). Datenbank und Stripe nachgebildet, ohne Konten lauffähig:

    cd backend && .venv/bin/python tests/test_telefon_abrechnung.py
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import FakeDb  # noqa: E402  (setzt auch den Pfad zum Backend)

import stripe  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.stripe_webhook as wh  # noqa: E402
import app.apis.telefon_einrichtung as einrichtung  # noqa: E402
import app.libs.mail as mail  # noqa: E402
import app.libs.onboarding_mail as onboarding_mail  # noqa: E402
import app.libs.stripe_billing as stripe_billing  # noqa: E402
from app.libs import telefon as t  # noqa: E402
from app.libs import telefon_abrechnung as ta  # noqa: E402
from app.libs import telefon_laeden as tl  # noqa: E402

JETZT = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
START = int(datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc).timestamp())
ENDE = int(datetime(2026, 12, 5, 9, 0, tzinfo=timezone.utc).timestamp())
SECRET = "whsec_test_geheim"
SALON = "+493055555555"


# --- Nachbildungen -----------------------------------------------------------------------------------------------------


class Obj(SimpleNamespace):
    def to_dict(self):
        return dict(self._daten)


def obj(**daten):
    o = Obj(**daten)
    o._daten = daten
    return o


class FakeStripe:
    """Was unser Code bei Stripe aufruft, mit Protokoll"""

    def __init__(self):
        self.meter, self.checkouts, self.updates, self.cancels = [], [], [], []
        self.fehler = False
        stripe_client = self

        class MeterEvents:
            def create(self, params):
                if stripe_client.fehler:
                    raise stripe.APIConnectionError("kein Netz")
                stripe_client.meter.append(params)
                return obj(**params)

        class Sessions:
            def create(self, params):
                stripe_client.checkouts.append(params)
                return obj(url="https://checkout.stripe.com/c/pay/cs_test_1")

        class Subscriptions:
            def update(self, sub_id, params):
                stripe_client.updates.append((sub_id, params))
                return obj(**telefon_abo(cancel=params.get("cancel_at_period_end", False), sub_id=sub_id))

            def cancel(self, sub_id):
                stripe_client.cancels.append(sub_id)
                return obj(**telefon_abo(status="canceled", sub_id=sub_id))

            def retrieve(self, sub_id):
                return obj(**telefon_abo(sub_id=sub_id))

        class Customers:
            def retrieve(self, customer_id):
                return obj(id=customer_id, deleted=False)

        class Prices:
            def list(self, params):
                return obj(data=[obj(id="price_" + params["lookup_keys"][0])])

        class Portal:
            sessions = obj(create=lambda params: obj(url="https://billing.stripe.com/p/session/1"))

        self.v1 = SimpleNamespace(
            billing=SimpleNamespace(meter_events=MeterEvents()),
            checkout=SimpleNamespace(sessions=Sessions()),
            subscriptions=Subscriptions(),
            customers=Customers(),
            prices=Prices(),
            billing_portal=Portal(),
        )


def telefon_abo(status="active", cancel=False, sub_id="sub_tel", shop="salon", start=START, ende=ENDE, customer="cus_1"):
    return {
        "id": sub_id, "object": "subscription", "status": status, "customer": customer, "cancel_at_period_end": cancel,
        "metadata": {"shopId": shop, "zusatz": "telefon"},
        "items": {"object": "list", "data": [
            {"price": {"lookup_key": ta.GRUNDPREIS_KEY}, "current_period_start": start, "current_period_end": ende},
            {"price": {"lookup_key": ta.MINUTEN_KEY}, "current_period_start": start, "current_period_end": ende},
        ]},
    }


def tarif_abo(status="active", shop="salon"):
    return {
        "id": "sub_tarif", "object": "subscription", "status": status, "customer": "cus_1", "cancel_at_period_end": False,
        "metadata": {"shopId": shop},
        "items": {"object": "list", "data": [{"price": {"lookup_key": "dranzeit_solo_monat"}, "current_period_end": ENDE}]},
    }


def gebucht(**mehr) -> dict:
    zusatz = {"status": "active", "subscriptionId": "sub_tel", "customerId": "cus_1", "modus": "live",
              "periodeStart": START, "periodeEnde": ENDE, "cancelAtPeriodEnd": False}
    zusatz.update(mehr.pop("zusatz", {}))
    return {"shopId": "salon", "aktiv": True, "anschluss": SALON, "status": "aktiv", "sekunden": 0, "zusatz": zusatz, **mehr}


def im_monat(sekunden: int, **mehr) -> dict:
    return gebucht(periode=START, periodeSekunden=sekunden, **mehr)


class Welt:
    """Datenbank, Stripe und Mails"""

    def __init__(self, laden=None, shop=None, offen=False):
        self.data = {
            "shops": {"salon": {"name": "Salon Nora", "phone": "030 55555555", "owner": "uid1", "email": "nora@salon.de",
                                "billing": {"plan": "solo", "status": "active"}, **(shop or {})}},
            "shops/salon/privat": {"stripe": {"customerId": "cus_1", "subscriptionId": "sub_tarif"}},
            t.LAEDEN: {"salon": laden} if laden is not None else {},
            t.ANRUFE: {},
            "meta": {"telefon": {"offen": offen}},
            "users": {},
        }
        self.db = FakeDb(self.data)
        self.stripe = FakeStripe()
        self.mails = []
        os.environ["STRIPE_SECRET_KEY"] = "sk_live_attrappe"
        os.environ["STRIPE_STEUERSATZ"] = "txr_ust19"
        stripe_billing._steuer_cache.clear()
        stripe_billing.client = lambda mode="live": self.stripe
        einrichtung.client = lambda mode="live": self.stripe
        einrichtung.get_firestore_db = lambda: self.db
        einrichtung.require_shop_of_owner = lambda user, shop_id: None
        wh.get_firestore_db = lambda: self.db
        wh.client = lambda mode="live": self.stripe
        mail.send_mail = lambda to, subject, html_body, text="", reply_to="": self.mails.append((to, subject, text)) or True
        onboarding_mail._owner_email = lambda shop: shop.get("email") or ""

    @property
    def laden(self) -> dict:
        return self.data[t.LAEDEN]["salon"]

    def anruf(self, sekunden: int, sid: str = "CA1", jetzt: datetime = JETZT) -> None:
        tl.anruf_merken(self.db, sid, "salon")
        shop_id = tl.anruf_ende(self.db, sid, sekunden, jetzt)
        if shop_id:
            ta.nach_anruf(self.db, shop_id, jetzt)


NUTZER = SimpleNamespace(sub="uid1", email="nora@salon.de")
ANFRAGE = SimpleNamespace(headers={})


def abgelehnt(aufruf, status: int) -> str:
    try:
        aufruf()
    except (HTTPException, tl.Abgelehnt) as nein:
        code = getattr(nein, "status_code", None) or nein.status
        assert code == status, (code, getattr(nein, "detail", None) or nein.text)
        return str(getattr(nein, "detail", None) or nein.text)
    raise AssertionError("nicht abgelehnt")


# --- Preis und Deckel --------------------------------------------------------------------------------------------------


def test_minuten_werden_aufgerundet():
    assert [t.minuten(s) for s in (0, 1, 59, 60, 61, 119, 120)] == [0, 1, 1, 1, 2, 2, 2]


def test_deckel_in_minuten_und_kosten():
    assert t.deckel_minuten(59) == 250  # Standard: 29 € + 150 × 0,20 €
    assert t.deckel_minuten(29) == 100  # nur der Grundpreis
    assert t.deckel_minuten(30) == 105
    assert t.kosten_cent(0) == 2900 and t.kosten_cent(100) == 2900
    assert t.kosten_cent(148) == 2900 + 48 * 20
    assert t.kosten_cent(250) == 5900


def test_deckel_ohne_angabe_und_ausserhalb_der_grenzen():
    assert t.deckel_von({}) == 59
    assert t.deckel_von({"deckel": 10}) == t.DECKEL_MIN
    assert t.deckel_von({"deckel": 10_000}) == t.DECKEL_MAX
    assert t.deckel_von({"deckel": "kaputt"}) == 59


def test_abzurechnen_ist_die_aufgerundete_monatssumme_hoechstens_bis_zum_deckel():
    assert t.abzurechnen(im_monat(100 * 60 + 1), JETZT) == 101
    assert t.abzurechnen(im_monat(300 * 60), JETZT) == 250  # Gespräch über den Deckel: zahlt der Laden nicht
    assert t.abzurechnen(im_monat(300 * 60, deckel=99), JETZT) == 300


def test_monatszaehler_gilt_nur_fuer_den_gespeicherten_monat():
    assert t.periode_sekunden(im_monat(600), JETZT) == 600
    alt = im_monat(600)
    alt["zusatz"]["periodeStart"] = ENDE  # Stripe hat schon den nächsten Monat gemeldet
    assert t.periode_sekunden(alt, JETZT) == 0
    assert t.periode_sekunden(im_monat(600), datetime.fromtimestamp(ENDE, tz=timezone.utc)) == 0


# --- Wann er abnimmt ---------------------------------------------------------------------------------------------------


def test_gruende_fuer_die_ansage():
    faelle = [
        (gebucht(), False, None),
        (gebucht(), True, t.GESPERRT),
        (gebucht(gesperrt=True), False, t.GESPERRT),
        (gebucht(aktiv=False), False, t.AUS),
        (im_monat(250 * 60), False, t.DECKEL),
        (im_monat(250 * 60 - 1), False, None),
        (im_monat(260 * 60, deckel=99), False, None),
        (gebucht(zusatz={"status": "past_due"}), False, t.ZAHLUNG),
        (gebucht(zusatz={"status": "unpaid"}), False, t.ZAHLUNG),
        (gebucht(zusatz={"status": "canceled"}), False, t.GEKUENDIGT),
        (gebucht(zusatz={"status": "canceled"}, freigegeben=True), False, t.GEKUENDIGT),
        ({"aktiv": True}, False, t.NICHT_FREI),
        ({"aktiv": True, "freigegeben": True, "sekunden": 1799}, False, None),
        ({"aktiv": True, "freigegeben": True, "sekunden": 1800}, False, t.TEST_VERBRAUCHT),
        ({"aktiv": True, "freigegeben": True, "freiminuten": 120, "sekunden": 1800}, False, None),
    ]
    for daten, gesperrt, erwartet in faelle:
        assert t.grund(daten, gesperrt, JETZT) == erwartet, (daten, erwartet)
        assert t.entscheiden(daten, gesperrt, JETZT) == (t.ANNEHMEN if erwartet is None else t.ANSAGE)


def test_gekuendigt_zum_monatsende_nimmt_bis_dahin_ab():
    assert t.grund(gebucht(zusatz={"cancelAtPeriodEnd": True}), False, JETZT) is None


def test_im_neuen_monat_nimmt_er_nach_dem_deckel_wieder_ab():
    voll = im_monat(250 * 60)
    assert t.grund(voll, False, JETZT) == t.DECKEL
    voll["zusatz"].update({"periodeStart": ENDE, "periodeEnde": ENDE + 30 * 86400})
    assert t.grund(voll, False, JETZT) is None


def test_warnstufen():
    assert [t.warnstufe(a) for a in (0, 0.79, 0.8, 0.99, 1.0, 1.4)] == [0, 0, 80, 80, 100, 100]


# --- Zählen und an Stripe melden ---------------------------------------------------------------------------------------


def test_anruf_zaehlt_im_abrechnungsmonat_und_geht_aufgerundet_an_stripe():
    w = Welt(gebucht())
    w.anruf(61)
    assert w.laden["sekunden"] == 61 and w.laden["periodeSekunden"] == 61 and w.laden["periode"] == START
    assert w.stripe.meter == [{"event_name": ta.METER_EVENT, "timestamp": int(JETZT.timestamp()),
                               "payload": {"stripe_customer_id": "cus_1", "value": "2"}}]
    w.anruf(59, "CA2", JETZT + timedelta(minutes=5))
    assert w.laden["periodeSekunden"] == 120 and w.laden["gemeldet"] == 2
    assert len(w.stripe.meter) == 1  # 120 Sekunden sind weiter 2 Minuten: nichts Neues zu melden
    w.anruf(1, "CA3", JETZT + timedelta(minutes=6))
    assert [e["payload"]["value"] for e in w.stripe.meter] == ["2", "3"]


def test_meldungen_sind_zeitlich_geordnet_auch_in_derselben_sekunde():
    w = Welt(gebucht())
    w.anruf(60, "CA1")
    w.anruf(60, "CA2")
    zeiten = [e["timestamp"] for e in w.stripe.meter]
    assert zeiten == sorted(zeiten) and len(set(zeiten)) == 2


def test_nie_mehr_als_der_deckel_an_stripe():
    w = Welt(im_monat(249 * 60))
    w.anruf(600)
    assert w.stripe.meter[-1]["payload"]["value"] == "250"
    assert t.grund(w.laden, False, JETZT) == t.DECKEL


def test_neuer_monat_faengt_bei_null_an():
    w = Welt(im_monat(5000, gemeldet=84))
    w.laden["zusatz"].update({"periodeStart": ENDE, "periodeEnde": ENDE + 30 * 86400})  # Verlängerung kam per Webhook
    w.anruf(30, jetzt=datetime.fromtimestamp(ENDE + 3600, tz=timezone.utc))
    assert w.laden["periode"] == ENDE and w.laden["periodeSekunden"] == 30
    assert w.stripe.meter[-1]["payload"]["value"] == "1"


def test_ist_der_monat_vorbei_und_stripe_noch_still_beginnt_der_naechste_am_ende_des_alten():
    w = Welt(im_monat(5000, gemeldet=84))
    w.anruf(90, jetzt=datetime.fromtimestamp(ENDE + 60, tz=timezone.utc))
    assert w.laden["periode"] == ENDE and w.laden["zusatz"]["periodeStart"] == ENDE
    assert w.laden["periodeSekunden"] == 90 and w.stripe.meter[-1]["payload"]["value"] == "2"
    # Danach meldet Stripe den Monat: Der Zähler läuft weiter, weil der Beginn derselbe ist
    ta.uebernehmen(w.db, telefon_abo(start=ENDE, ende=ENDE + 30 * 86400), "live")
    assert t.periode_sekunden(w.laden, datetime.fromtimestamp(ENDE + 120, tz=timezone.utc)) == 90


def test_testminuten_gehen_nicht_an_stripe():
    w = Welt({"shopId": "salon", "freigegeben": True, "aktiv": True, "anschluss": SALON, "status": "aktiv", "sekunden": 0})
    w.anruf(300)
    assert w.laden["sekunden"] == 300 and not w.stripe.meter and "periode" not in w.laden


def test_ohne_netz_meldet_der_abgleich_spaeter():
    w = Welt(gebucht())
    w.stripe.fehler = True
    w.anruf(125)
    assert not w.stripe.meter and not w.laden.get("gemeldet")
    w.stripe.fehler = False
    assert ta.abgleich(w.db, JETZT + timedelta(minutes=5)) == 1
    assert w.stripe.meter[-1]["payload"]["value"] == "3" and w.laden["gemeldet"] == 3
    assert ta.abgleich(w.db, JETZT + timedelta(minutes=10)) == 0  # schon gemeldet


def test_hoeherer_deckel_meldet_nach():
    w = Welt(im_monat(300 * 60, gemeldet=250))
    einrichtung.deckel("salon", einrichtung.Deckel(deckel=99), NUTZER)
    assert w.laden["deckel"] == 99 and w.stripe.meter[-1]["payload"]["value"] == "300"


def test_deckel_nur_in_den_grenzen():
    w = Welt(gebucht())
    abgelehnt(lambda: einrichtung.deckel("salon", einrichtung.Deckel(deckel=20), NUTZER), 400)
    abgelehnt(lambda: einrichtung.deckel("salon", einrichtung.Deckel(deckel=501), NUTZER), 400)
    assert "deckel" not in w.laden


# --- Warnungen ---------------------------------------------------------------------------------------------------------


def test_warnung_bei_80_und_100_prozent_je_einmal_im_monat():
    w = Welt(im_monat(199 * 60))
    w.anruf(60)  # 200 von 250 Minuten
    assert len(w.mails) == 1 and "80 %" in w.mails[0][1] and w.mails[0][0] == "nora@salon.de"
    w.anruf(60, "CA2")
    assert len(w.mails) == 1
    w.anruf(50 * 60, "CA3")
    assert len(w.mails) == 2 and "Kostendeckel erreicht" in w.mails[1][1]
    w.anruf(60, "CA4")
    assert len(w.mails) == 2


def test_warnung_auch_fuer_die_testminuten():
    w = Welt({"shopId": "salon", "freigegeben": True, "aktiv": True, "anschluss": SALON, "status": "aktiv", "sekunden": 0})
    w.anruf(25 * 60)
    assert len(w.mails) == 1 and "Testminuten" in w.mails[0][1]
    w.anruf(10 * 60, "CA2")
    assert len(w.mails) == 2 and "aufgebraucht" in w.mails[1][1]
    assert t.grund(w.laden, False) == t.TEST_VERBRAUCHT


def test_sprung_ueber_beide_stufen_gibt_nur_eine_mail():
    w = Welt(im_monat(0))
    w.anruf(260 * 60)
    assert len(w.mails) == 1 and "Kostendeckel erreicht" in w.mails[0][1]
    assert w.laden["gewarnt"] == {"80": str(START), "100": str(START)}


def test_keine_mail_an_testadressen():
    w = Welt(im_monat(199 * 60), {"email": "q-me-test-1@example.com"})
    w.anruf(60)
    assert not w.mails and w.laden["gewarnt"]["80"] == str(START)


def test_warnmail_nennt_zahlen():
    betreff, _, absaetze, _ = ta.warnmail(80, im_monat(200 * 60), "Salon <Nora>", "https://dranzeit.de", "de", JETZT)
    assert "80 %" in betreff
    assert "200 Minuten" in absaetze[0] and "49,00 €" in absaetze[0] and "59 €" in absaetze[0] and "Salon &lt;Nora&gt;" in absaetze[0]


# --- Stripe-Webhook ----------------------------------------------------------------------------------------------------


def signed(event: dict) -> tuple[bytes, str]:
    payload = json.dumps(event).encode()
    ts = int(time.time())
    return payload, f"t={ts},v1={stripe.WebhookSignature._compute_signature(f'{ts}.{payload.decode()}', SECRET)}"


def webhook(w: Welt, kind: str, sub: dict):
    os.environ["STRIPE_WEBHOOK_SECRET"] = SECRET
    app = FastAPI()
    app.include_router(wh.router, prefix="/routes")
    payload, header = signed({"id": "evt_1", "object": "event", "type": kind, "data": {"object": sub}})
    r = TestClient(app).post("/routes/stripe/webhook", content=payload, headers={"stripe-signature": header})
    assert r.status_code == 200, r.text


def test_webhook_schreibt_den_zusatz_und_laesst_den_tarif_in_ruhe():
    w = Welt({"shopId": "salon", "freigegeben": True})
    tarif_vorher = dict(w.data["shops"]["salon"]["billing"])
    webhook(w, "customer.subscription.created", telefon_abo())
    assert w.laden["zusatz"]["status"] == "active" and w.laden["zusatz"]["periodeStart"] == START
    assert w.laden["zusatz"]["subscriptionId"] == "sub_tel" and w.laden["zusatz"]["modus"] == "live"
    assert w.data["shops"]["salon"]["billing"] == tarif_vorher and "plan" not in w.data["shops"]["salon"]
    assert w.data["shops/salon/privat"]["stripe"]["subscriptionId"] == "sub_tarif"


def test_webhook_kuendigung_und_ende():
    w = Welt(gebucht())
    webhook(w, "customer.subscription.updated", telefon_abo(cancel=True))
    assert w.laden["zusatz"]["cancelAtPeriodEnd"] is True and t.grund(w.laden, False, JETZT) is None
    webhook(w, "customer.subscription.deleted", telefon_abo(status="canceled", cancel=True))
    assert t.grund(w.laden, False, JETZT) == t.GEKUENDIGT


def test_webhook_zahlung_offen():
    w = Welt(gebucht())
    webhook(w, "customer.subscription.updated", telefon_abo(status="past_due"))
    assert t.grund(w.laden, False, JETZT) == t.ZAHLUNG


def test_webhook_aus_anderem_modus_oder_von_anderem_kunden_zaehlt_nicht():
    w = Welt({"shopId": "salon", "freigegeben": True})
    w.data["shops/salon/privat"]["stripe_test"] = {"aktiv": True, "customerId": "cus_test"}
    webhook(w, "customer.subscription.created", telefon_abo())  # Live-Abo, Laden bucht in der Sandbox
    assert "zusatz" not in w.laden
    w.data["shops/salon/privat"].pop("stripe_test")
    webhook(w, "customer.subscription.created", telefon_abo(customer="cus_fremd"))
    assert "zusatz" not in w.laden


def test_ende_des_tarifs_kuendigt_den_zusatz_zum_monatsende():
    w = Welt(gebucht())
    webhook(w, "customer.subscription.deleted", tarif_abo(status="canceled"))
    assert w.stripe.updates == [("sub_tel", {"cancel_at_period_end": True})]
    assert w.laden["zusatz"]["cancelAtPeriodEnd"] is True
    assert w.data["shops"]["salon"]["plan"] == "gratis"


def test_tarif_abo_wird_nicht_als_telefon_erkannt():
    assert ta.ist_telefon(telefon_abo()) and not ta.ist_telefon(tarif_abo())
    ohne_metadata = {**telefon_abo(), "metadata": {"shopId": "salon"}}
    assert ta.ist_telefon(ohne_metadata)  # an den Preisen erkannt


# --- Einrichtung: testen, zubuchen, kündigen ---------------------------------------------------------------------------


def test_testen_erst_wenn_fuer_alle_geoeffnet():
    w = Welt()
    abgelehnt(lambda: einrichtung.testen("salon", NUTZER), 403)
    assert not w.data[t.LAEDEN]
    w = Welt(offen=True)
    stand = einrichtung.testen("salon", NUTZER)
    assert w.laden["freigegeben"] is True and w.laden["freiminuten"] == 30
    assert stand["freigegeben"] and not stand["kannTesten"] and stand["sichtbar"]


def test_testen_ab_solo():
    alt = datetime.now(timezone.utc) - timedelta(days=60)
    w = Welt(offen=True, shop={"billing": None, "createdAt": alt, "trialEndsAt": alt + timedelta(days=30)})
    assert einrichtung.ansehen("salon", NUTZER)["tarif"] is False
    abgelehnt(lambda: einrichtung.testen("salon", NUTZER), 403)
    w = Welt(offen=True, shop={"billing": None, "trialEndsAt": datetime.now(timezone.utc) + timedelta(days=5)})
    einrichtung.testen("salon", NUTZER)  # in der Testphase von Dranzeit gilt alles
    assert w.laden["freigegeben"] is True


def test_gesperrt_kein_testen_kein_zubuchen():
    w = Welt({"shopId": "salon", "gesperrt": True}, offen=True)
    abgelehnt(lambda: einrichtung.testen("salon", NUTZER), 403)
    abgelehnt(lambda: einrichtung.buchen("salon", NUTZER, ANFRAGE), 403)
    abgelehnt(lambda: einrichtung.speichern("salon", einrichtung.Einstellung(aktiv=True, anschluss=SALON), NUTZER), 403)
    assert not w.stripe.checkouts


def test_kachel_nur_fuer_freigegebene_bis_zur_oeffnung():
    assert Welt().db and einrichtung.ansehen("salon", NUTZER)["sichtbar"] is False
    Welt({"shopId": "salon", "freigegeben": True})
    assert einrichtung.ansehen("salon", NUTZER)["sichtbar"] is True
    Welt(offen=True)
    assert einrichtung.ansehen("salon", NUTZER)["sichtbar"] is True


def test_zubuchen_ueber_stripe_checkout():
    w = Welt({"shopId": "salon", "freigegeben": True, "sekunden": 1800})
    antwort = einrichtung.buchen("salon", NUTZER, ANFRAGE)
    assert antwort["url"].startswith("https://checkout.stripe.com/")
    params = w.stripe.checkouts[0]
    assert params["mode"] == "subscription" and params["customer"] == "cus_1"
    assert params["line_items"] == [{"price": f"price_{ta.GRUNDPREIS_KEY}", "quantity": 1}, {"price": f"price_{ta.MINUTEN_KEY}"}]
    assert params["subscription_data"]["metadata"] == {"shopId": "salon", "zusatz": "telefon"}
    assert params["subscription_data"]["default_tax_rates"] == ["txr_ust19"] and "automatic_tax" not in params  # feste 19 %
    assert params["success_url"].endswith("/telefon-assistent?gebucht=1")
    assert "trial_end" not in params["subscription_data"]


def test_zubuchen_braucht_ein_abo_ab_solo():
    w = Welt({"shopId": "salon", "freigegeben": True}, {"billing": None, "trialEndsAt": datetime.now(timezone.utc) + timedelta(days=5)})
    text = abgelehnt(lambda: einrichtung.buchen("salon", NUTZER, ANFRAGE), 409)
    assert "Solo" in text and not w.stripe.checkouts


def test_zubuchen_vor_der_oeffnung_nur_mit_freigabe():
    w = Welt()
    abgelehnt(lambda: einrichtung.buchen("salon", NUTZER, ANFRAGE), 403)
    assert not w.stripe.checkouts


def test_schon_gebucht_geht_ins_kundenportal():
    w = Welt(gebucht())
    assert einrichtung.buchen("salon", NUTZER, ANFRAGE)["url"].startswith("https://billing.stripe.com/")
    assert not w.stripe.checkouts


def test_kuendigen_zum_monatsende_und_zuruecknehmen():
    w = Welt(gebucht())
    stand = einrichtung.kuendigen("salon", einrichtung.Kuendigung(), NUTZER)
    assert w.stripe.updates[-1] == ("sub_tel", {"cancel_at_period_end": True})
    assert stand["zusatz"]["kuendigtZum"] and stand["grund"] is None  # nimmt bis zum Monatsende ab
    stand = einrichtung.kuendigen("salon", einrichtung.Kuendigung(zurueck=True), NUTZER)
    assert w.stripe.updates[-1] == ("sub_tel", {"cancel_at_period_end": False}) and stand["zusatz"]["kuendigtZum"] is None


def test_kuendigen_ohne_zusatz_geht_nicht():
    Welt({"shopId": "salon", "freigegeben": True})
    abgelehnt(lambda: einrichtung.kuendigen("salon", einrichtung.Kuendigung(), NUTZER), 409)


def test_stand_fuer_die_seite():
    w = Welt(im_monat(210 * 60, deckel=59))
    stand = einrichtung.ansehen("salon", NUTZER)
    assert stand["verbrauch"]["art"] == "zusatz" and stand["verbrauch"]["minuten"] == 210 and stand["verbrauch"]["grenze"] == 250
    assert stand["verbrauch"]["kostenCent"] == 2900 + 110 * 20 and stand["warnung"] == 80 and stand["deckel"] == 59
    assert stand["zusatz"]["status"] == "active" and stand["kannBuchen"] is False and stand["abo"] is True
    assert w.laden["zusatz"]["customerId"] == "cus_1"


def test_eingeschaltet_bleibt_es_nach_dem_zubuchen_ohne_freigabe():
    w = Welt(gebucht(freigegeben=False, aktiv=False))
    einrichtung.speichern("salon", einrichtung.Einstellung(aktiv=True, anschluss="030 55555555"), NUTZER)
    assert w.laden["aktiv"] is True


def test_vergessen_beendet_nur_den_zusatz_im_selben_modus():
    w = Welt(gebucht(zusatz={"modus": "test"}))
    assert ta.vergessen(w.db, "salon", "live") == ""
    assert ta.vergessen(w.db, "salon", "test", beenden=True) == "sub_tel"
    assert w.stripe.cancels == ["sub_tel"] and not w.laden.get("zusatz")


if __name__ == "__main__":
    tests = [(n, f) for n, f in list(globals().items()) if n.startswith("test_") and callable(f)]
    fehler = 0
    for name, fn in tests:
        try:
            fn()
            print(f"ok    {name}")
        except Exception as e:  # noqa: BLE001
            fehler += 1
            print(f"FEHL  {name}: {type(e).__name__}: {e}")
            import traceback

            traceback.print_exc()
    print(f"{len(tests) - fehler} von {len(tests)} bestanden")
    sys.exit(1 if fehler else 0)
