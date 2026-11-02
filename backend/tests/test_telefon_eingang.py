"""
Tests für den Eingang des Telefon-Assistenten und seine Einrichtung (app/apis/telefon_eingang, app/libs/telefon_laeden.py)
mit nachgebauter Datenbank. Ohne Firebase-Zugang und ohne pytest lauffähig:

    cd backend && uv run python tests/test_telefon_eingang.py
"""
import base64
import hashlib
import hmac
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import FakeDb  # noqa: E402  (setzt auch den Pfad zum Backend)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.telefon as tel  # noqa: E402
import app.apis.telefon_eingang as eingang  # noqa: E402
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

    def _assistent(self, shop_id, name, begruessung, anrufer):
        self.vapi.append((shop_id, name, anrufer))
        self.begruessung = begruessung
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
    assert d.begruessung == "Hallo, hier ist der KI-Assistent von Salon Nora & Co. Ich kann Ihnen direkt einen Termin buchen, Bart oder Haarschnitt. Was darf es sein?"


def test_begruessung_je_nach_angebot():
    kopf = "Hallo, hier ist der KI-Assistent von Nora."
    assert t.begruessung("Nora", ["Bart"]) == f"{kopf} Ich kann Ihnen direkt einen Termin für Bart buchen. Soll ich schauen, wann der nächste frei ist?"
    assert t.begruessung("Nora", ["A", "B", "C"]).endswith("buchen, A, B oder C. Was darf es sein?")
    assert t.begruessung("Nora", ["A", "B", "C", "D"]).endswith("buchen, zum Beispiel A, B oder C. Was darf es sein?")
    assert t.begruessung("Nora") == f"{kopf} Ich kann Ihnen direkt einen Termin buchen. Was darf es sein?"
    assert "Nummer für heute" in t.begruessung("Nora", ["A"], termine=False)
    assert "KI-Assistent" in t.begruessung("Nora", ["A"], termine=False)


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
    assert d.data[t.LAEDEN]["salon"]["sekunden"].value == 65
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
