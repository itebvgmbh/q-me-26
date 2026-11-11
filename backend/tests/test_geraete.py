"""
Tests fürs Koppeln eines Tablets am Tresen (app/libs/geraete.py, app/apis/geraete) und für die Tresen-Sitzung
(databutton_app/mw/auth_mw.py, app/apis/anmeldung).

Ohne Datenbank laufen nur Freigabeliste und Gerätename. Mit Wegwerf-Datenbank alles (so auf GitHub, Workflow
„Datenbank“):

    cd backend && QME_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/q_me_test .venv/bin/python tests/test_geraete.py

Achtung: Der Test leert konten (samt sitzungen) und kopplungen in der Datenbank hinter QME_TEST_DATABASE_URL.
"""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from fastapi import APIRouter, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.libs import anmeldung, geraete  # noqa: E402

TEST_URL = os.environ.get("QME_TEST_DATABASE_URL", "").strip()
DRANZEIT = {"Origin": "https://dranzeit.de"}
EIN_LADEN = [{"id": "laden1", "name": "Salon Kim"}]


# --- ohne Datenbank ---------------------------------------------------------------------------------------------------


def test_freigabeliste_tresen():
    erlaubt = [
        ("GET", "/routes/anmeldung/ich"), ("HEAD", "/routes/anmeldung/ich"), ("POST", "/routes/anmeldung/abmelden"),
        ("GET", "/routes/live/laden/abc"), ("GET", "/routes/live/ereignisse"), ("GET", "/routes/laden-live"),
        ("GET", "/routes/team/ich/laeden"), ("GET", "/routes/team/laden/abc/personen"),
        ("GET", "/routes/team/laeden/abc"), ("GET", "/routes/team/laeden/abc/"), ("GET", "/routes/team/laeden/abc/kunden"),
        ("GET", "/routes/team/laeden/abc/kunden/k1/termine"), ("GET", "/routes/team/laeden/abc/startklar"),
        ("GET", "/routes/team/termine"), ("GET", "/routes/team/termine/t1"),
        ("POST", "/routes/team/termine"), ("POST", "/routes/team/termine/t1"), ("POST", "/routes/team/kunden"),
        ("POST", "/routes/nummer/ziehen"), ("POST", "/routes/nummer/verschieben"), ("POST", "/routes/available-timeslots"),
        ("POST", "/routes/frueher-dran/t1"), ("POST", "/routes/slot-freed"), ("GET", "/routes/billing/modus"),
        ("GET", "/routes/konto/profil"),
    ]
    verboten = [
        # Tarif, Rechnungen, Telefon-Assistent buchen, API-Schlüssel
        ("POST", "/routes/billing/checkout"), ("POST", "/routes/billing/portal"), ("POST", "/routes/billing/claim-founder"),
        ("GET", "/routes/invoices/list"), ("POST", "/routes/telefon-einrichtung/abc/buchen"),
        ("GET", "/routes/telefon-einrichtung/abc/anrufe"), ("GET", "/routes/team/laeden/abc/api-schluessel"),
        ("POST", "/routes/team/laeden/abc/api-schluessel"),
        # Laden, Team, Leistungen, feste Pausen ändern; neuen Laden anlegen; Team einladen
        ("POST", "/routes/team/laeden/abc"), ("POST", "/routes/team/laeden"), ("POST", "/routes/team/laeden/abc/bild"),
        ("POST", "/routes/team/personen"), ("POST", "/routes/team/personen/p1/aktiv"), ("POST", "/routes/team/leistungen"),
        ("POST", "/routes/team/feste-pausen"), ("POST", "/routes/staff-invitation"),
        # Konto: Passwort, Profil, löschen, Kunden löschen
        ("POST", "/routes/anmeldung/passwort-pruefen"), ("POST", "/routes/anmeldung/passwort-aendern"),
        ("POST", "/routes/konto/profil"), ("DELETE", "/routes/datenschutz/konto"), ("DELETE", "/routes/datenschutz/kunde/k1"),
        # Weitere Geräte koppeln oder verwalten, Betreiber
        ("GET", "/routes/geraete"), ("GET", "/routes/geraete/koppeln/info"), ("POST", "/routes/geraete/koppeln/bestaetigen"),
        ("POST", "/routes/geraete/abc/abmelden"), ("GET", "/routes/betreiber/ich"),
        # Nur die genannten Pfade, nicht was dahinter hängt; Methode zählt
        ("GET", "/routes/team/termine/t1/x"), ("DELETE", "/routes/team/termine/t1"), ("POST", "/routes/live/laden/abc"),
        ("GET", "/routes/team/laeden/abc/kunden/k1"), ("GET", "/api/v1/laden"), ("GET", ""),
    ]
    for methode, pfad in erlaubt:
        assert geraete.erlaubt(methode, pfad), (methode, pfad)
    for methode, pfad in verboten:
        assert not geraete.erlaubt(methode, pfad), (methode, pfad)


def test_geraet_name():
    assert geraete.geraet_name("iPad") == "iPad"
    # Nur Buchstaben, Ziffern und wenige Zeichen; kein HTML
    assert geraete.geraet_name("  Tablet <b>am</b>   Tresen  ") == "Tablet bamb Tresen"
    assert len(geraete.geraet_name("x" * 100)) == geraete.MAX_NAME
    android = "Mozilla/5.0 (Linux; Android 16; SM-X230) AppleWebKit/537.36 Chrome/141.0 Safari/537.36"
    assert geraete.geraet_name("", android) == "Android-Tablet"
    assert geraete.geraet_name("", android.replace("Safari", "Mobile Safari")) == "Android-Handy"
    assert geraete.geraet_name(None, "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)") == "iPad"
    assert geraete.geraet_name(None, None) == "Gerät"


def test_im_router_eingetragen_ohne_anmeldung():
    import json

    with open(os.path.join(BACKEND, "routers.json"), encoding="utf-8") as f:
        assert json.load(f)["routers"]["geraete"]["disableAuth"] is True


# --- mit Datenbank ----------------------------------------------------------------------------------------------------


def _schema():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    from app.libs import datenbank

    os.environ["QME_DATABASE_URL"] = TEST_URL
    datenbank._engine = None
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND, "migrations"))
    command.upgrade(cfg, "head")
    with datenbank.engine().begin() as conn:
        conn.execute(text("truncate konten, kopplungen cascade"))
    anmeldung.versuche_vergessen()


def _app(laeden=None):
    """Anmeldung, Geräte und zwei Probe-Endpunkte: einer, den der Tresen darf, einer, den er nicht darf"""
    from app.apis import geraete as api
    from app.apis.anmeldung import router as anmeldung_router
    from app.auth import AuthorizedUser
    from app.i18n import uebersetzte_fehler

    api._laeden = lambda uid: [dict(s) for s in (EIN_LADEN if laeden is None else laeden)]
    probe = APIRouter()

    @probe.get("/team/termine")
    def termine(user: AuthorizedUser) -> dict:
        return {"uid": user.sub, "bereich": user.bereich}

    @probe.post("/billing/checkout")
    def checkout(user: AuthorizedUser) -> dict:
        return {"uid": user.sub}

    app = FastAPI()
    uebersetzte_fehler(app)
    app.include_router(anmeldung_router, prefix="/routes")
    app.include_router(api.router, prefix="/routes")
    app.include_router(probe, prefix="/routes")
    return TestClient(app, base_url="https://testserver")


def _inhaber(email: str = "kim@salon.de", laeden=None):
    handy = _app(laeden)
    r = handy.post("/routes/anmeldung/registrieren", json={"email": email, "passwort": "geheim123"}, headers=DRANZEIT)
    assert r.status_code == 200, r.text
    return handy, r.json()["uid"]


def _starten(tablet, geraet: str = "iPad") -> dict:
    r = tablet.post("/routes/geraete/koppeln/start", json={"geraet": geraet}, headers=DRANZEIT)
    assert r.status_code == 200, r.text
    return r.json()


def _abholen(tablet, geheimnis: str) -> dict:
    return tablet.post("/routes/geraete/koppeln/abholen", json={"abholen": geheimnis}, headers=DRANZEIT).json()


def db_test_koppeln_ablauf():
    _schema()
    handy, uid = _inhaber()
    tablet = _app()
    start = _starten(tablet)
    assert len(start["pruefzahl"]) == 4 and start["pruefzahl"].isdigit() and start["gueltigSekunden"] == 600
    assert start["code"] != start["abholen"]
    assert _abholen(tablet, start["abholen"]) == {"status": "wartet"}

    info = handy.get("/routes/geraete/koppeln/info", params={"code": start["code"]}).json()
    assert info == {"pruefzahl": start["pruefzahl"], "geraet": "iPad", "laeden": EIN_LADEN}

    # Mit dem Geheimnis des Tablets lässt sich nichts bestätigen, mit dem QR-Code nichts abholen
    assert handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["abholen"]}, headers=DRANZEIT).status_code == 404
    assert _abholen(tablet, start["code"]) == {"status": "abgelaufen"}

    r = handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"]}, headers=DRANZEIT)
    assert r.json() == {"ok": True, "laden": "laden1"}
    # Zweimal bestätigen geht nicht
    assert handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"]}, headers=DRANZEIT).status_code == 404

    fertig = _abholen(tablet, start["abholen"])
    assert fertig["status"] == "fertig" and fertig["uid"] == uid and fertig["bereich"] == "tresen" and fertig["laden"] == "laden1"
    assert _abholen(tablet, start["abholen"]) == {"status": "abgelaufen"}  # nur einmal
    ich = tablet.get("/routes/anmeldung/ich").json()
    assert ich["uid"] == uid and ich["bereich"] == "tresen" and ich["laden"] == "laden1"

    # Das Tablet darf, was der Tresen braucht, sonst nichts
    assert tablet.get("/routes/team/termine").json() == {"uid": uid, "bereich": "tresen"}
    r = tablet.post("/routes/billing/checkout", headers=DRANZEIT)
    assert r.status_code == 403 and r.headers["X-Anmeldung-Fehler"] == "auth/tresen"
    r = tablet.post("/routes/anmeldung/passwort-pruefen", json={"passwort": "geheim123"}, headers=DRANZEIT)
    assert r.status_code == 403 and r.headers["X-Anmeldung-Fehler"] == "auth/tresen"
    assert tablet.post("/routes/anmeldung/passwort-aendern", json={"passwort": "neues1234"}, headers=DRANZEIT).status_code == 403
    # … und keine weiteren Geräte koppeln oder verwalten
    weiteres = _starten(_app())
    assert tablet.get("/routes/geraete/koppeln/info", params={"code": weiteres["code"]}).status_code == 403
    assert tablet.post("/routes/geraete/koppeln/bestaetigen", json={"code": weiteres["code"]}, headers=DRANZEIT).status_code == 403
    assert tablet.get("/routes/geraete").status_code == 403

    # Das Handy behält seine volle Sitzung
    assert handy.post("/routes/billing/checkout", headers=DRANZEIT).json() == {"uid": uid}
    assert "bereich" not in handy.get("/routes/anmeldung/ich").json()

    # Liste und abmelden
    liste = handy.get("/routes/geraete").json()["geraete"]
    assert len(liste) == 1
    assert liste[0]["geraet"] == "iPad" and liste[0]["laden"] == "laden1" and liste[0]["ladenName"] == "Salon Kim"
    kennung = liste[0]["kennung"]
    assert handy.post(f"/routes/geraete/{kennung}/abmelden", headers=DRANZEIT).json() == {"ok": True}
    assert tablet.get("/routes/anmeldung/ich").json() == {"uid": None}
    assert handy.post(f"/routes/geraete/{kennung}/abmelden", headers=DRANZEIT).status_code == 404
    assert handy.get("/routes/geraete").json() == {"geraete": []}


def db_test_abgelaufen():
    _schema()
    from sqlalchemy import text

    from app.libs import datenbank

    handy, _ = _inhaber()
    tablet = _app()
    start = _starten(tablet)
    with datenbank.engine().begin() as conn:
        conn.execute(text("update kopplungen set laeuft_ab = now() - interval '1 second'"))
    r = handy.get("/routes/geraete/koppeln/info", params={"code": start["code"]})
    assert r.status_code == 404 and r.headers["X-Koppeln-Fehler"] == "ungueltig"
    assert handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"]}, headers=DRANZEIT).status_code == 404
    assert _abholen(tablet, start["abholen"]) == {"status": "abgelaufen"}
    assert _abholen(tablet, "") == {"status": "abgelaufen"}


def db_test_laden_waehlen():
    _schema()
    zwei = [{"id": "a", "name": "Salon A"}, {"id": "b", "name": "Salon B"}]
    handy, _ = _inhaber(laeden=zwei)
    tablet = _app(zwei)
    start = _starten(tablet)
    r = handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"]}, headers=DRANZEIT)
    assert r.status_code == 400 and r.headers["X-Koppeln-Fehler"] == "laden-waehlen"
    assert handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"], "laden": "fremd"},
                      headers=DRANZEIT).status_code == 404
    r = handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"], "laden": "b"}, headers=DRANZEIT)
    assert r.json() == {"ok": True, "laden": "b"}
    assert _abholen(tablet, start["abholen"])["laden"] == "b"


def db_test_ohne_laden_kein_koppeln():
    _schema()
    # Die Attrappe für die Läden gilt für alle Apps (Modul): auch das Tablet ohne Läden anlegen
    handy, _ = _inhaber(laeden=[])
    start = _starten(_app([]))
    r = handy.get("/routes/geraete/koppeln/info", params={"code": start["code"]})
    assert r.status_code == 403 and r.headers["X-Koppeln-Fehler"] == "kein-laden"
    assert handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"]}, headers=DRANZEIT).status_code == 403


def db_test_fremdes_tablet_nicht_abmelden():
    _schema()
    handy, _ = _inhaber()
    tablet = _app()
    start = _starten(tablet)
    handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"]}, headers=DRANZEIT)
    _abholen(tablet, start["abholen"])
    kennung = handy.get("/routes/geraete").json()["geraete"][0]["kennung"]
    andere, _ = _inhaber("mo@salon.de")
    assert andere.post(f"/routes/geraete/{kennung}/abmelden", headers=DRANZEIT).status_code == 404
    assert andere.get("/routes/geraete").json() == {"geraete": []}
    assert tablet.get("/routes/anmeldung/ich").json()["bereich"] == "tresen"


def db_test_passwort_aendern_meldet_tablets_ab():
    _schema()
    handy, _ = _inhaber()
    tablet = _app()
    start = _starten(tablet)
    handy.post("/routes/geraete/koppeln/bestaetigen", json={"code": start["code"]}, headers=DRANZEIT)
    _abholen(tablet, start["abholen"])
    assert handy.post("/routes/anmeldung/passwort-pruefen", json={"passwort": "geheim123"}, headers=DRANZEIT).status_code == 200
    assert handy.post("/routes/anmeldung/passwort-aendern", json={"passwort": "neues1234"}, headers=DRANZEIT).status_code == 200
    assert tablet.get("/routes/anmeldung/ich").json() == {"uid": None}


def db_test_zu_viele_starts():
    _schema()
    tablet = _app()
    for _ in range(geraete.STARTEN_IP[0]):
        _starten(tablet)
    r = tablet.post("/routes/geraete/koppeln/start", json={}, headers=DRANZEIT)
    assert r.status_code == 429 and r.headers["X-Koppeln-Fehler"] == "zu-viele"


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    db_tests = [v for k, v in dict(globals()).items() if k.startswith("db_test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    if TEST_URL:
        for t in db_tests:
            t()
            print("ok ", t.__name__)
    print(f"{len(tests) + (len(db_tests) if TEST_URL else 0)} Tests bestanden" + ("" if TEST_URL else " (ohne Datenbank)"))
