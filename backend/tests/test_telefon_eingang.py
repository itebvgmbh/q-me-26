"""
Tests für den Eingang des Telefon-Assistenten und seine Einrichtung (app/apis/telefon_eingang, app/libs/telefon_laeden.py)
mit nachgebauter Datenbank. Ohne Firebase-Zugang und ohne pytest lauffähig:

    cd backend && uv run python tests/test_telefon_eingang.py
"""
import base64
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import FakeDb  # noqa: E402  (setzt auch den Pfad zum Backend)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.telefon as tel  # noqa: E402
import app.apis.telefon_eingang as eingang  # noqa: E402
import app.apis.telefon_hinweis as hinweis  # noqa: E402
from app import seo  # noqa: E402
from app.libs import telefon as t  # noqa: E402
from app.libs import telefon_laeden as tl  # noqa: E402

TOKEN = "geheim"
GEMEINSAM = "+493012345678"
SALON = "+493055555555"
ANRUFER = "+4915112345678"
BASIS = "https://dranzeit.de/routes"

os.environ.update({
    "QME_TWILIO_AUTH_TOKEN": TOKEN,
    "QME_TELEFON_NUMMER": GEMEINSAM,
    "QME_VAPI_API_KEY": "vapi",
    "QME_VAPI_ASSISTANT_ID": "assistent",
    "QME_VAPI_PHONE_NUMBER_ID": "nummer",
    "PUBLIC_URL": "https://dranzeit.de",
})

app = FastAPI()
app.include_router(eingang.router, prefix="/routes")
client = TestClient(app)


def signiert(pfad: str, felder: dict) -> str:
    daten = f"{BASIS}{pfad}" + "".join(k + felder[k] for k in sorted(felder))
    return base64.b64encode(hmac.new(TOKEN.encode(), daten.encode(), hashlib.sha1).digest()).decode()


def anruf(**felder):
    felder = {"To": GEMEINSAM, "From": ANRUFER, "CallSid": "CA1", **felder}
    return client.post("/routes/telefon-eingang", data=felder, headers={"X-Twilio-Signature": signiert("/telefon-eingang", felder)})


class Db:
    """Datenbank, Antwort von Vapi und was dort angekommen ist"""

    def __init__(self, laden=None, shop=None, leitungen=None):
        self.data = {
            "shops": {"salon": {"name": "Salon Nora & Co", "phone": "030 55555555", "owner": "uid", **(shop or {})}},
            t.LAEDEN: {"salon": laden} if laden else {},
            t.LEITUNGEN: leitungen or {},
            t.ANRUFE: {},
        }
        self.db = FakeDb(self.data)
        self.vapi = []
        eingang.get_firestore_db = lambda: self.db
        eingang._assistent = self._assistent

    def _assistent(self, shop_id, name, begruessung, daten, anrufer):
        self.vapi.append((shop_id, name, anrufer))
        self.begruessung, self.daten = begruessung, json.loads(daten)
        return "<Response><Connect/></Response>"


def aktiv(**mehr):
    return {"shopId": "salon", "freigegeben": True, "aktiv": True, "anschluss": SALON, "status": "aktiv", "freiminuten": 30, "sekunden": 0, **mehr}


# --- Zugang ------------------------------------------------------------------------------------------------------------


def test_ohne_gueltige_signatur_kein_zugang():
    Db(aktiv())
    assert client.post("/routes/telefon-eingang", data={"To": GEMEINSAM}).status_code == 403
    antwort = client.post("/routes/telefon-eingang", data={"To": GEMEINSAM}, headers={"X-Twilio-Signature": "falsch"})
    assert antwort.status_code == 403


def test_signatur_prueft_adresse_und_felder():
    felder = {"CallSid": "CA1234567890ABCDE", "From": "+12349013030", "To": "+18005551212"}
    daten = "https://example.com/myapp" + "".join(k + felder[k] for k in sorted(felder))
    richtig = base64.b64encode(hmac.new(b"12345", daten.encode(), hashlib.sha1).digest()).decode()
    assert t.twilio_signatur_ok("https://example.com/myapp", felder, richtig, "12345")
    assert not t.twilio_signatur_ok("https://example.com/anders", felder, richtig, "12345")
    assert not t.twilio_signatur_ok("https://example.com/myapp", {**felder, "To": "+1999"}, richtig, "12345")


# --- Wer kommt durch ---------------------------------------------------------------------------------------------------


def test_umleitung_vom_freigegebenen_laden_geht_zum_assistenten():
    d = Db(aktiv())
    antwort = anruf(ForwardedFrom=SALON)
    assert antwort.status_code == 200 and "Connect" in antwort.text
    assert antwort.headers["content-type"].startswith("text/xml")
    assert d.vapi == [("salon", "Salon Nora & Co", ANRUFER)]
    assert d.data[t.ANRUFE]["CA1"]["shopId"] == "salon"


def test_anrufer_nummer_bleibt_der_kunde_nicht_der_laden():
    d = Db(aktiv())
    anruf(ForwardedFrom=SALON, From="+4917099999999")
    assert d.vapi[0][2] == "+4917099999999"


def test_unterdrueckte_nummer_geht_ohne_anrufer():
    d = Db(aktiv())
    anruf(ForwardedFrom=SALON, From="anonymous")
    assert d.vapi == [("salon", "Salon Nora & Co", None)]


def test_direktanruf_wird_abgewiesen_und_kostet_nichts():
    d = Db(aktiv())
    antwort = anruf()
    assert "<Reject/>" in antwort.text and not d.vapi and not d.data[t.ANRUFE]


def test_fremder_laden_wird_abgewiesen():
    d = Db(aktiv())
    antwort = anruf(ForwardedFrom="+493099999999")
    assert "<Reject/>" in antwort.text and not d.vapi


def test_calledvia_zaehlt_wie_forwardedfrom():
    d = Db(aktiv())
    anruf(CalledVia=SALON)
    assert d.vapi


def test_nummer_in_anderer_schreibweise():
    d = Db(aktiv())
    anruf(ForwardedFrom="03055555555")
    assert d.vapi


def test_eigene_nummer_gilt_auch_ohne_umleitungsangabe():
    d = Db({"shopId": "salon", "freigegeben": True, "aktiv": True}, leitungen={"+493077777777": {"shopId": "salon"}})
    anruf(To="+493077777777")
    assert d.vapi == [("salon", "Salon Nora & Co", ANRUFER)]


def test_ansage_ohne_ki():
    faelle = [
        (aktiv(aktiv=False), {}),
        (aktiv(freigegeben=False), {}),
        (aktiv(sekunden=1800), {}),
        (aktiv(), {"suspended": True}),
    ]
    for laden, shop in faelle:
        d = Db(laden, shop)
        antwort = anruf(ForwardedFrom=SALON)
        assert "<Say" in antwort.text and "Salon Nora &amp; Co" in antwort.text, laden
        assert not d.vapi and not d.data[t.ANRUFE], laden


def test_begruessung_nennt_was_man_buchen_kann():
    d = Db(aktiv(), {"trialEndsAt": datetime.now(timezone.utc) + timedelta(days=5)})
    d.data["services"] = {
        "a": {"shopId": "salon", "name": "Haarschnitt"},
        "b": {"shopId": "salon", "name": "Bart"},
        "c": {"shopId": "salon", "name": "Alt", "archived": True},
        "d": {"shopId": "anderer", "name": "Fremd"},
    }
    anruf(ForwardedFrom=SALON)
    assert d.begruessung == "Hallo, hier ist der KI-Assistent von Salon Nora & Co. Möchten Sie einen Termin für Bart oder Haarschnitt?"


def test_daten_des_ladens_gehen_gleich_mit():
    d = Db(aktiv(), {"street": "Hauptstr. 1", "postalCode": "10115", "city": "Berlin", "businessHours": "9:00-17:00"})
    d.data["services"] = {"a": {"shopId": "salon", "name": "Haarschnitt", "duration": 30, "price": 23}}
    anruf(ForwardedFrom=SALON)
    assert "Hauptstr. 1" in d.daten["adresse"] and d.daten["oeffnungszeiten"] == ["täglich 9 bis 17 Uhr"]
    assert d.daten["leistungen"][0]["name"] == "Haarschnitt" and d.daten["name"] == "Salon Nora & Co"


def test_bekannter_anrufer_wird_mit_namen_begruesst():
    d = Db(aktiv(), {"trialEndsAt": datetime.now(timezone.utc) + timedelta(days=5)})
    d.data["services"] = {"a": {"shopId": "salon", "name": "Haarschnitt"}, "b": {"shopId": "salon", "name": "Bart"}}
    d.data["staff"] = {"kim": {"shopId": "salon", "name": "Kim Yilmaz", "isActive": True}}
    d.data["customers"] = {"k1": {"shopId": "salon", "name": "Stefan Tittmann", "phone": "0151 12345678"}}
    d.data["appointments"] = {"t1": {"shopId": "salon", "customerId": "k1", "serviceId": "b", "staffId": "kim", "status": "completed",
                                     "startTime": datetime.now(timezone.utc) - timedelta(days=20)}}
    anruf(ForwardedFrom=SALON)
    assert d.begruessung == "Hallo Stefan, hier ist der KI-Assistent von Salon Nora & Co. Möchten Sie wieder einen Termin für Bart?"
    assert d.daten["anrufer"]["name"] == "Stefan Tittmann" and d.daten["anrufer"]["zuletzt"]["person"] == "Kim", d.daten
    # Fremde Nummer: wie bisher, ohne Namen und ohne Angaben zum Anrufer
    anruf(ForwardedFrom=SALON, From="+4917099999999")
    assert d.begruessung.startswith("Hallo, hier ist") and "anrufer" not in d.daten


def test_klemmt_die_kundenliste_nimmt_er_trotzdem_ab():
    d = Db(aktiv())
    echt = eingang.tk.bekannt
    eingang.tk.bekannt = lambda *a, **k: 1 / 0
    try:
        antwort = anruf(ForwardedFrom=SALON)
    finally:
        eingang.tk.bekannt = echt
    assert "Connect" in antwort.text and d.begruessung.startswith("Hallo, hier ist")


def test_begruessung_je_nach_angebot():
    kopf = "Hallo, hier ist der KI-Assistent von Nora."
    assert t.begruessung("Nora", ["Bart"]) == f"{kopf} Möchten Sie einen Termin für Bart?"
    assert t.begruessung("Nora", ["A", "B", "C"]) == f"{kopf} Möchten Sie einen Termin für A, B oder C?"
    assert t.begruessung("Nora", ["A", "B", "C", "D"]) == f"{kopf} Möchten Sie einen Termin, zum Beispiel für A, B oder C?"
    assert t.begruessung("Nora") == f"{kopf} Möchten Sie einen Termin?"
    assert "Nummer für heute" in t.begruessung("Nora", ["A"], termine=False)
    assert "KI-Assistent" in t.begruessung("Nora", ["A"], termine=False)
    stefan = {"anrede": "Stefan", "zuletzt": {"leistung": "Dauerwelle"}}
    assert t.begruessung("Nora", ["Bart"], kunde=stefan) == "Hallo Stefan, hier ist der KI-Assistent von Nora. Möchten Sie einen Termin für Bart?", \
        "letzte Leistung gibt es nicht mehr"
    assert t.begruessung("Nora", ["A"], termine=False, kunde=stefan).startswith("Hallo Stefan, hier ist der KI-Assistent")


def test_kurz_vor_dem_limit_nimmt_er_noch_ab():
    d = Db(aktiv(sekunden=1799))
    anruf(ForwardedFrom=SALON)
    assert d.vapi


def test_stoerung_bei_vapi_gibt_eine_verstaendliche_ansage():
    d = Db(aktiv())

    def kaputt(*_):
        raise RuntimeError("Vapi antwortet nicht")

    eingang._assistent = kaputt
    antwort = anruf(ForwardedFrom=SALON)
    assert antwort.status_code == 200 and "<Say" in antwort.text and "später" in antwort.text
    assert not d.data[t.ANRUFE]


# --- Probeanruf --------------------------------------------------------------------------------------------------------


def test_probeanruf_schaltet_frei():
    d = Db(aktiv(status="wartet", wartetSeit=datetime.now(timezone.utc)))
    anruf(ForwardedFrom=SALON)
    assert d.data[t.LAEDEN]["salon"]["status"] == "aktiv"
    assert d.data[t.LAEDEN]["salon"]["probeAm"] is not None


def test_direktanruf_ist_kein_probeanruf():
    d = Db(aktiv(status="wartet"))
    anruf()
    assert d.data[t.LAEDEN]["salon"]["status"] == "wartet"


# --- Minuten -----------------------------------------------------------------------------------------------------------


def test_ende_zaehlt_die_gespraechszeit():
    d = Db(aktiv())
    anruf(ForwardedFrom=SALON)
    felder = {"CallSid": "CA1", "CallStatus": "completed", "CallDuration": "65"}
    antwort = client.post("/routes/telefon-eingang/status", data=felder, headers={"X-Twilio-Signature": signiert("/telefon-eingang/status", felder)})
    assert antwort.status_code == 204
    assert d.data[t.LAEDEN]["salon"]["sekunden"] == 65
    assert not d.data[t.ANRUFE]


def test_ende_eines_abgewiesenen_anrufs_zaehlt_nicht():
    d = Db(aktiv())
    felder = {"CallSid": "CA9", "CallStatus": "completed", "CallDuration": "65"}
    client.post("/routes/telefon-eingang/status", data=felder, headers={"X-Twilio-Signature": signiert("/telefon-eingang/status", felder)})
    assert d.data[t.LAEDEN]["salon"]["sekunden"] == 0


def test_status_ohne_signatur_zaehlt_nicht():
    d = Db(aktiv())
    anruf(ForwardedFrom=SALON)
    antwort = client.post("/routes/telefon-eingang/status", data={"CallSid": "CA1", "CallStatus": "completed", "CallDuration": "999"})
    assert antwort.status_code == 403 and "CA1" in d.data[t.ANRUFE]


# --- Einrichtung -------------------------------------------------------------------------------------------------------


def abgelehnt(aufruf, status):
    try:
        aufruf()
    except tl.Abgelehnt as nein:
        assert nein.status == status, nein.text
        return
    raise AssertionError("nicht abgelehnt")


def test_stand_ohne_eintrag():
    d = Db()
    stand = tl.stand(d.db, "salon", d.data["shops"]["salon"])
    assert stand["freigegeben"] is False and stand["status"] == "aus" and stand["freiminuten"] == 30
    assert stand["zielnummer"] == GEMEINSAM and stand["vorschlag"] == SALON


def test_ohne_freigabe_keine_einrichtung():
    d = Db()
    abgelehnt(lambda: tl.einstellen(d.db, "salon", True, SALON), 403)


def test_einschalten_wartet_auf_den_probeanruf():
    d = Db({"shopId": "salon", "freigegeben": True})
    tl.einstellen(d.db, "salon", True, "030 55555555")
    laden = d.data[t.LAEDEN]["salon"]
    assert laden["anschluss"] == SALON and laden["status"] == "wartet" and laden["aktiv"] is True


def test_neue_nummer_braucht_neuen_probeanruf_gleiche_nicht():
    d = Db(aktiv())
    tl.einstellen(d.db, "salon", False, SALON)
    assert d.data[t.LAEDEN]["salon"]["status"] == "aktiv" and d.data[t.LAEDEN]["salon"]["aktiv"] is False
    tl.einstellen(d.db, "salon", True, "030 66666666")
    assert d.data[t.LAEDEN]["salon"]["status"] == "wartet"


def test_falsche_nummern():
    d = Db({"shopId": "salon", "freigegeben": True})
    abgelehnt(lambda: tl.einstellen(d.db, "salon", True, "abc"), 400)
    abgelehnt(lambda: tl.einstellen(d.db, "salon", True, ""), 400)
    abgelehnt(lambda: tl.einstellen(d.db, "salon", True, "+33123456789"), 400)
    abgelehnt(lambda: tl.einstellen(d.db, "salon", True, GEMEINSAM), 400)


def test_nummer_eines_anderen_ladens_geht_nicht():
    d = Db(aktiv())
    d.data[t.LAEDEN]["neu"] = {"shopId": "neu", "freigegeben": True}
    abgelehnt(lambda: tl.einstellen(d.db, "neu", True, SALON), 409)


def test_lange_unbestaetigte_nummer_wird_wieder_frei():
    d = Db(aktiv(status="wartet", wartetSeit=datetime.now(timezone.utc) - timedelta(days=8)))
    d.data[t.LAEDEN]["neu"] = {"shopId": "neu", "freigegeben": True}
    tl.einstellen(d.db, "neu", True, SALON)
    assert d.data[t.LAEDEN]["neu"]["anschluss"] == SALON
    assert d.data[t.LAEDEN]["salon"]["anschluss"] is None and d.data[t.LAEDEN]["salon"]["aktiv"] is False


def test_frisch_eingetragene_nummer_bleibt_belegt():
    d = Db(aktiv(status="wartet", wartetSeit=datetime.now(timezone.utc) - timedelta(days=1)))
    d.data[t.LAEDEN]["neu"] = {"shopId": "neu", "freigegeben": True}
    abgelehnt(lambda: tl.einstellen(d.db, "neu", True, SALON), 409)


def test_eigene_nummer_braucht_keinen_probeanruf():
    d = Db(leitungen={"+493077777777": {"shopId": "salon"}})
    tl.eigene_nummer_zugeordnet(d.db, "salon")
    stand = tl.stand(d.db, "salon", d.data["shops"]["salon"])
    assert stand["freigegeben"] and stand["aktiv"] and stand["status"] == "aktiv"
    assert stand["zielnummer"] == "+493077777777" and stand["eigeneNummer"]


# --- Hinweise für Kunden -----------------------------------------------------------------------------------------------


MIT_TERMINEN = {"trialEndsAt": datetime.now(timezone.utc) + timedelta(days=5)}
OHNE_TERMINE = {"trialEndsAt": datetime.now(timezone.utc) - timedelta(days=1)}


def test_hinweis_wenn_der_anruf_auf_die_ladennummer_beim_assistenten_landet():
    assert tl.nimmt_an(Db(aktiv(), MIT_TERMINEN).db, "salon") is True


def test_kein_hinweis_wenn_niemand_abnimmt_oder_nichts_gebucht_werden_kann():
    faelle = [
        (aktiv(aktiv=False), MIT_TERMINEN),
        (aktiv(freigegeben=False), MIT_TERMINEN),
        (aktiv(sekunden=1800), MIT_TERMINEN),
        (aktiv(status="wartet"), MIT_TERMINEN),
        (aktiv(), {**MIT_TERMINEN, "suspended": {"at": datetime.now(timezone.utc)}}),
        (aktiv(), OHNE_TERMINE),
    ]
    for laden, shop in faelle:
        assert tl.nimmt_an(Db(laden, shop).db, "salon") is False, (laden, shop)


def test_kein_hinweis_neben_einer_nummer_die_nicht_umleitet():
    assert tl.nimmt_an(Db(aktiv(), {**MIT_TERMINEN, "phone": "030 66666666"}).db, "salon") is False
    assert tl.nimmt_an(Db(aktiv(), {**MIT_TERMINEN, "phone": ""}).db, "salon") is False


def test_kein_hinweis_ohne_eintrag_oder_ohne_laden():
    assert tl.nimmt_an(Db(shop=MIT_TERMINEN).db, "salon") is False
    assert tl.nimmt_an(Db(aktiv(), MIT_TERMINEN).db, "gibts-nicht") is False


def test_hinweis_bei_eigener_nummer_ohne_probeanruf():
    laden = {"shopId": "salon", "freigegeben": True, "aktiv": True}
    d = Db(laden, MIT_TERMINEN, leitungen={"+493077777777": {"shopId": "salon"}})
    assert tl.nimmt_an(d.db, "salon") is True


def test_stand_sagt_ob_der_laden_es_weitersagen_kann():
    d = Db(aktiv(), MIT_TERMINEN)
    assert tl.stand(d.db, "salon", d.data["shops"]["salon"])["weitersagen"] is True
    d = Db(aktiv(status="wartet"), MIT_TERMINEN)
    assert tl.stand(d.db, "salon", d.data["shops"]["salon"])["weitersagen"] is False
    d = Db(aktiv(sekunden=1800), MIT_TERMINEN)
    assert tl.stand(d.db, "salon", d.data["shops"]["salon"])["weitersagen"] is False


def test_weitersagen_haengt_nicht_an_der_nummer_in_den_ladendaten():
    """Der Laden gibt die umgeleitete Nummer selbst weiter, auch wenn in den Ladendaten eine andere steht"""
    d = Db(aktiv(), {**MIT_TERMINEN, "phone": "030 66666666"})
    assert tl.stand(d.db, "salon", d.data["shops"]["salon"])["weitersagen"] is True


def hinweis_app(db):
    seo._cache.clear()
    hinweis.get_firestore_db = db
    app_hinweis = FastAPI()
    app_hinweis.include_router(hinweis.router, prefix="/routes")
    return TestClient(app_hinweis)


def test_schnittstelle_nennt_nur_die_laeden_die_abnehmen():
    d = Db(aktiv(sekunden=600), MIT_TERMINEN)
    d.data["shops"].update({
        "ausgeschaltet": {"name": "A", "phone": "030 11111111", **MIT_TERMINEN},
        "andere-nummer": {"name": "B", "phone": "030 22222222", **MIT_TERMINEN},
    })
    d.data[t.LAEDEN].update({
        "ausgeschaltet": aktiv(aktiv=False, anschluss="+493011111111"),
        "andere-nummer": aktiv(anschluss="+493033333333"),
    })
    antwort = hinweis_app(lambda: d.db).get("/routes/telefon-hinweis")
    assert antwort.status_code == 200 and antwort.json() == {"laeden": ["salon"], "offen": False}
    assert "max-age" in antwort.headers["cache-control"]


def test_schnittstelle_ohne_laeden():
    d = Db(shop=MIT_TERMINEN)
    assert hinweis_app(lambda: d.db).get("/routes/telefon-hinweis").json() == {"laeden": [], "offen": False}


def test_schnittstelle_sagt_ob_er_fuer_alle_offen_ist():
    d = Db(shop=MIT_TERMINEN)
    d.data["meta"] = {"telefon": {"offen": True}}
    assert hinweis_app(lambda: d.db).get("/routes/telefon-hinweis").json() == {"laeden": [], "offen": True}


def test_schnittstelle_schweigt_bei_einer_stoerung():
    def kaputt():
        raise RuntimeError("Datenbank weg")

    antwort = hinweis_app(kaputt).get("/routes/telefon-hinweis")
    assert antwort.status_code == 200 and antwort.json() == {"laeden": [], "offen": False}


def test_schnittstelle_braucht_keine_anmeldung():
    pfad = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routers.json")
    with open(pfad, encoding="utf-8") as datei:
        assert json.load(datei)["routers"]["telefon_hinweis"]["disableAuth"] is True


# --- Werkzeuge: welcher Laden ------------------------------------------------------------------------------------------


def test_werkzeuge_nehmen_die_laden_id_vom_eingang():
    d = Db(aktiv())
    shop_id, shop = tel._laden(d.db, tel.Anruf(angerufen=GEMEINSAM, laden_id="salon"))
    assert shop_id == "salon" and shop["name"] == "Salon Nora & Co"


def test_werkzeuge_ohne_freigabe_kennen_den_laden_nicht():
    d = Db()
    try:
        tel._laden(d.db, tel.Anruf(angerufen=GEMEINSAM, laden_id="salon"))
    except tel._Nein as nein:
        assert nein.grund == "kein_laden"
        return
    raise AssertionError("kein Fehler")


def test_werkzeuge_mit_unaufgeloester_variable_nehmen_die_gewaehlte_nummer():
    d = Db(leitungen={GEMEINSAM: {"shopId": "salon"}})
    shop_id, _ = tel._laden(d.db, tel.Anruf(angerufen=GEMEINSAM, laden_id="{{laden_id}}"))
    assert shop_id == "salon"


if __name__ == "__main__":
    tests = [(name, fn) for name, fn in list(globals().items()) if name.startswith("test_") and callable(fn)]
    fehler = 0
    for name, fn in tests:
        try:
            fn()
            print(f"ok    {name}")
        except AssertionError as e:
            fehler += 1
            print(f"FEHLER {name}: {e}")
    print(f"{len(tests) - fehler} von {len(tests)} bestanden")
    sys.exit(1 if fehler else 0)
