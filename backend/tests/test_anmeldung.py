"""
Tests für die eigene Anmeldung (app/libs/anmeldung.py, app/apis/anmeldung, databutton_app/mw/auth_mw.py,
app/libs/konto_auth.py; requirements/eigene-datenbank.md Stufe 4).

Ohne Datenbank laufen nur die Teile ohne PostgreSQL. Mit Wegwerf-Datenbank alles (so auf GitHub, Workflow „Datenbank“):

    cd backend && QME_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/q_me_test .venv/bin/python tests/test_anmeldung.py

Achtung: Der Test leert konten, sitzungen und einmal_links in der Datenbank hinter QME_TEST_DATABASE_URL.
"""
import os
import sys
from datetime import timedelta
from types import SimpleNamespace

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from fastapi import APIRouter, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.libs import anmeldung  # noqa: E402
from app.libs.anmeldung import AnmeldeFehler  # noqa: E402

TEST_URL = os.environ.get("QME_TEST_DATABASE_URL", "").strip()
DRANZEIT = {"Origin": "https://dranzeit.de"}


def _fehler(fn, *args) -> str:
    try:
        fn(*args)
    except AnmeldeFehler as e:
        return e.code
    raise AssertionError("kein Fehler")


def test_passwort_hash():
    h = anmeldung.passwort_hash("geheim123")
    assert h.startswith("$argon2id$") and "geheim123" not in h
    assert anmeldung.passwort_stimmt(h, "geheim123")
    assert not anmeldung.passwort_stimmt(h, "geheim124")
    assert not anmeldung.passwort_stimmt(None, "geheim123") and not anmeldung.passwort_stimmt("kaputt", "x")


def test_eingaben_pruefen():
    assert anmeldung.email_pruefen(" Kim@Salon.de ") == "Kim@Salon.de"
    assert _fehler(anmeldung.email_pruefen, "kim@salon") == "auth/invalid-email"
    assert _fehler(anmeldung.passwort_pruefen, "") == "auth/missing-password"
    assert _fehler(anmeldung.passwort_pruefen, "12345") == "auth/weak-password"
    assert _fehler(anmeldung.passwort_pruefen, "x" * 201) == "auth/password-too-long"
    assert anmeldung.passwort_pruefen("123456") == "123456"


def test_neue_ids_wie_firebase():
    ids = {anmeldung.neue_uid() for _ in range(50)}
    assert len(ids) == 50 and all(len(i) == 28 and i.isalnum() for i in ids)


def test_fehlversuche_sperren():
    anmeldung.versuche_vergessen()
    for _ in range(anmeldung.FEHLVERSUCHE_EMAIL[0]):
        assert not anmeldung._zu_viele("mail:kim@salon.de", anmeldung.FEHLVERSUCHE_EMAIL)
        anmeldung._fehlversuch("Kim@Salon.de", "ip1")
    assert anmeldung._zu_viele("mail:kim@salon.de", anmeldung.FEHLVERSUCHE_EMAIL)
    assert not anmeldung._zu_viele("mail:andere@salon.de", anmeldung.FEHLVERSUCHE_EMAIL)
    anmeldung.versuche_vergessen()


def test_ohne_cookie_nicht_angemeldet():
    from databutton_app.mw.auth_mw import user_from_session

    assert user_from_session(SimpleNamespace(cookies={})) is None


def test_im_router_eingetragen_ohne_anmeldung():
    import json

    with open(os.path.join(BACKEND, "routers.json"), encoding="utf-8") as f:
        assert json.load(f)["routers"]["anmeldung"]["disableAuth"] is True


# --- ab hier nur mit Wegwerf-Datenbank ---------------------------------------------------------------------------


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
        conn.execute(text("truncate konten cascade"))
    anmeldung.versuche_vergessen()


def _app():
    from app.apis.anmeldung import router
    from app.auth import AuthorizedUser
    from app.i18n import uebersetzte_fehler

    geschuetzt = APIRouter()

    @geschuetzt.get("/geheim")
    def geheim(user: AuthorizedUser) -> dict:
        return {"uid": user.sub, "email": user.email, "verified": user.email_verified}

    @geschuetzt.post("/geheim")
    def geheim_schreiben(user: AuthorizedUser) -> dict:
        return {"uid": user.sub}

    app = FastAPI()
    uebersetzte_fehler(app)
    app.include_router(router, prefix="/routes")
    app.include_router(geschuetzt, prefix="/routes")
    # TestClient spricht http://testserver; das Cookie ist Secure, httpx schickt es trotzdem nur über https
    return TestClient(app, base_url="https://testserver")


def _code(r) -> str:
    return r.headers.get("x-anmeldung-fehler", "")


def db_test_registrieren_anmelden_abmelden():
    _schema()
    c = _app()
    r = c.post("/routes/anmeldung/registrieren", json={"email": " Kim@Salon.de ", "passwort": "geheim123"}, headers=DRANZEIT)
    assert r.status_code == 200, r.text
    ich = r.json()
    assert ich["email"] == "Kim@Salon.de" and ich["emailVerified"] is False and len(ich["uid"]) == 28
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
    assert c.get("/routes/anmeldung/ich").json()["uid"] == ich["uid"]
    assert c.get("/routes/geheim").json() == {"uid": ich["uid"], "email": "Kim@Salon.de", "verified": False}

    # Dieselbe Adresse in anderer Schreibweise gibt es schon
    zweiter = _app()
    r = zweiter.post("/routes/anmeldung/registrieren", json={"email": "kim@salon.DE", "passwort": "anders123"}, headers=DRANZEIT)
    assert r.status_code == 400 and _code(r) == "auth/email-already-in-use"
    assert "schon ein Konto" in r.json()["detail"]
    r = zweiter.post("/routes/anmeldung/registrieren", json={"email": "neu@salon.de", "passwort": "kurz"}, headers=DRANZEIT)
    assert _code(r) == "auth/weak-password"

    assert c.post("/routes/anmeldung/abmelden", headers=DRANZEIT).status_code == 200
    assert c.get("/routes/anmeldung/ich").json() == {"uid": None}
    assert c.get("/routes/geheim").status_code == 401

    r = c.post("/routes/anmeldung/anmelden", json={"email": "kim@salon.de", "passwort": "falsch"}, headers=DRANZEIT)
    assert r.status_code == 400 and _code(r) == "auth/invalid-credential"
    r = c.post("/routes/anmeldung/anmelden", json={"email": "nicht@da.de", "passwort": "egal123"}, headers=DRANZEIT)
    assert _code(r) == "auth/invalid-credential"
    r = c.post("/routes/anmeldung/anmelden", json={"email": "KIM@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    assert r.status_code == 200 and r.json()["uid"] == ich["uid"]
    assert c.get("/routes/geheim").status_code == 200


def db_test_fehlermeldung_in_der_sprache_der_anfrage():
    _schema()
    r = _app().post("/routes/anmeldung/anmelden", json={"email": "x@y.de", "passwort": "falsch1"},
                    headers={**DRANZEIT, "Accept-Language": "en"})
    assert r.json()["detail"] == "Email or password is incorrect."


def db_test_zu_viele_falsche_passwoerter():
    _schema()
    c = _app()
    c.post("/routes/anmeldung/registrieren", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    for _ in range(anmeldung.FEHLVERSUCHE_EMAIL[0]):
        c.post("/routes/anmeldung/anmelden", json={"email": "kim@salon.de", "passwort": "falsch"}, headers=DRANZEIT)
    r = c.post("/routes/anmeldung/anmelden", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    assert r.status_code == 429 and _code(r) == "auth/too-many-requests"


def db_test_fremder_ursprung():
    _schema()
    c = _app()
    r = c.post("/routes/anmeldung/registrieren", json={"email": "kim@salon.de", "passwort": "geheim123"},
               headers={"Origin": "https://boese.example"})
    assert r.status_code == 403 and _code(r) == "auth/wrong-origin"
    c.post("/routes/anmeldung/registrieren", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    assert c.post("/routes/geheim", headers=DRANZEIT).status_code == 200
    assert c.post("/routes/geheim").status_code == 200  # ohne Origin (Werkzeuge, alte Browser): SameSite=Lax genügt
    assert c.post("/routes/geheim", headers={"Origin": "https://boese.example"}).status_code == 401
    assert c.get("/routes/geheim", headers={"Origin": "https://boese.example"}).status_code == 200  # lesen schadet nicht


def db_test_passwort_aendern_nur_kurz_nach_bestaetigung():
    _schema()
    from sqlalchemy import text

    from app.libs import datenbank

    c, anderes = _app(), _app()
    uid = c.post("/routes/anmeldung/registrieren", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT).json()["uid"]
    anderes.post("/routes/anmeldung/anmelden", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    with datenbank.engine().begin() as conn:
        conn.execute(text("update sitzungen set bestaetigt = now() - interval '10 minutes'"))
    r = c.post("/routes/anmeldung/passwort-aendern", json={"passwort": "neues1234"}, headers=DRANZEIT)
    assert r.status_code == 403 and _code(r) == "auth/requires-recent-login"
    r = c.post("/routes/anmeldung/passwort-pruefen", json={"passwort": "falsch"}, headers=DRANZEIT)
    assert _code(r) == "auth/invalid-credential"
    assert c.post("/routes/anmeldung/passwort-pruefen", json={"passwort": "geheim123"}, headers=DRANZEIT).status_code == 200
    assert c.post("/routes/anmeldung/passwort-aendern", json={"passwort": "neues1234"}, headers=DRANZEIT).status_code == 200
    assert c.get("/routes/anmeldung/ich").json()["uid"] == uid  # eigene Sitzung bleibt
    assert anderes.get("/routes/anmeldung/ich").json() == {"uid": None}  # andere Geräte abgemeldet
    r = _app().post("/routes/anmeldung/anmelden", json={"email": "kim@salon.de", "passwort": "neues1234"}, headers=DRANZEIT)
    assert r.status_code == 200


def db_test_passwort_vergessen_und_adresse_bestaetigen():
    _schema()
    c = _app()
    c.post("/routes/anmeldung/registrieren", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    konto = anmeldung.konto_per_email("kim@salon.de")

    code = anmeldung.link_anlegen(konto, "passwort")
    assert c.get("/routes/anmeldung/passwort-neu", params={"code": code}).json() == {"email": "kim@salon.de"}
    assert _code(c.get("/routes/anmeldung/passwort-neu", params={"code": "falsch"})) == "auth/invalid-action-code"
    neuer = anmeldung.link_anlegen(konto, "passwort")  # der ältere gilt danach nicht mehr
    assert _code(c.get("/routes/anmeldung/passwort-neu", params={"code": code})) == "auth/invalid-action-code"
    r = c.post("/routes/anmeldung/passwort-neu", json={"code": neuer, "passwort": "kurz"}, headers=DRANZEIT)
    assert _code(r) == "auth/weak-password"
    r = c.post("/routes/anmeldung/passwort-neu", json={"code": neuer, "passwort": "neues1234"}, headers=DRANZEIT)
    assert r.status_code == 200, r.text
    assert c.get("/routes/anmeldung/ich").json() == {"uid": None}  # alle Sitzungen beendet
    r = c.post("/routes/anmeldung/passwort-neu", json={"code": neuer, "passwort": "nochmal123"}, headers=DRANZEIT)
    assert _code(r) == "auth/invalid-action-code"  # nur einmal
    assert anmeldung.konto(konto.uid).email_bestaetigt  # Link kam per Mail: Adresse damit bestätigt
    assert c.post("/routes/anmeldung/anmelden", json={"email": "kim@salon.de", "passwort": "neues1234"}, headers=DRANZEIT).status_code == 200

    # Bestätigungs-Link gilt nur für die Adresse, an die er ging
    anmeldung.aendern(konto.uid, email_bestaetigt=False)
    code = anmeldung.link_anlegen(anmeldung.konto(konto.uid), "bestaetigen")
    anmeldung.aendern(konto.uid, email="kim@neu.de")
    assert _code(c.post("/routes/anmeldung/email-bestaetigen", json={"code": code}, headers=DRANZEIT)) == "auth/invalid-action-code"
    code = anmeldung.link_anlegen(anmeldung.konto(konto.uid), "bestaetigen")
    r = c.post("/routes/anmeldung/email-bestaetigen", json={"code": code}, headers=DRANZEIT)
    assert r.json() == {"email": "kim@neu.de", "emailVerified": True}
    assert c.get("/routes/anmeldung/ich").json()["emailVerified"] is True

    # Abgelaufen
    from sqlalchemy import text

    from app.libs import datenbank

    code = anmeldung.link_anlegen(anmeldung.konto(konto.uid), "passwort")
    with datenbank.engine().begin() as conn:
        conn.execute(text("update einmal_links set laeuft_ab = now() - interval '1 minute'"))
    assert _code(c.get("/routes/anmeldung/passwort-neu", params={"code": code})) == "auth/expired-action-code"


def db_test_sperren_wie_firebase():
    _schema()
    from app.libs import konto_auth

    c = _app()
    uid = c.post("/routes/anmeldung/registrieren", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT).json()["uid"]
    record = konto_auth.get_user(uid)
    assert record.email == "kim@salon.de" and not record.disabled and record.user_metadata.creation_timestamp
    assert konto_auth.get_user_by_email("KIM@salon.de").uid == uid
    assert [u.uid for u in konto_auth.get_users([konto_auth.UidIdentifier(uid), konto_auth.UidIdentifier("weg")]).users] == [uid]
    konto_auth.update_user(uid, disabled=True)
    assert c.get("/routes/anmeldung/ich").json() == {"uid": None}  # Sitzungen beendet
    r = c.post("/routes/anmeldung/anmelden", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    assert r.status_code == 403 and _code(r) == "auth/user-disabled"
    konto_auth.update_user(uid, disabled=False)
    assert c.post("/routes/anmeldung/anmelden", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT).status_code == 200

    _app().post("/routes/anmeldung/registrieren", json={"email": "mo@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    try:
        konto_auth.update_user(uid, email="Mo@Salon.de")
        raise AssertionError("doppelte Adresse angenommen")
    except konto_auth.EmailAlreadyExistsError:
        pass
    assert {u.email for u in konto_auth.list_users().iterate_all()} == {"kim@salon.de", "mo@salon.de"}
    konto_auth.delete_user(uid)
    assert c.get("/routes/anmeldung/ich").json() == {"uid": None}
    try:
        konto_auth.get_user(uid)
        raise AssertionError("gelöschtes Konto gefunden")
    except konto_auth.UserNotFoundError:
        pass


def db_test_uebernahme_aus_firebase():
    """Übernommene Konten (herkunft firebase, ohne Passwort): Die erste Anmeldung prüft bei Firebase, danach nicht mehr"""
    _schema()
    from datetime import datetime, timezone

    anmeldung.anlegen("alt@salon.de", None, uid="A" * 28, bestaetigt=True, herkunft="firebase",
                      angelegt=datetime(2023, 11, 14, tzinfo=timezone.utc))
    vorher = anmeldung.firebase_passwort
    gefragt = []

    def firebase_passwort(email, passwort):
        gefragt.append(email)
        return {"uid": "A" * 28, "email": "alt@salon.de", "verified": True, "disabled": False} if passwort == "altes-pw" else None

    anmeldung.firebase_passwort = firebase_passwort
    try:
        alt = anmeldung.konto("A" * 28)
        assert alt.passwort is None and alt.email_bestaetigt and alt.herkunft == "firebase" and alt.angelegt.year == 2023
        c = _app()
        r = c.post("/routes/anmeldung/anmelden", json={"email": "alt@salon.de", "passwort": "falsch"}, headers=DRANZEIT)
        assert _code(r) == "auth/invalid-credential" and gefragt == ["alt@salon.de"]
        r = c.post("/routes/anmeldung/anmelden", json={"email": "ALT@salon.de", "passwort": "altes-pw"}, headers=DRANZEIT)
        assert r.status_code == 200 and r.json()["uid"] == "A" * 28
        assert anmeldung.konto("A" * 28).passwort.startswith("$argon2id$")
        # Ab jetzt ohne Firebase
        gefragt.clear()
        r = _app().post("/routes/anmeldung/anmelden", json={"email": "alt@salon.de", "passwort": "altes-pw"}, headers=DRANZEIT)
        assert r.status_code == 200 and gefragt == []
        # Firebase nicht erreichbar oder Projekt gelöscht: wie ein falsches Passwort
        anmeldung.anlegen("weg@salon.de", None, uid="B" * 28, herkunft="firebase")
        anmeldung.firebase_passwort = lambda email, passwort: None
        r = _app().post("/routes/anmeldung/anmelden", json={"email": "weg@salon.de", "passwort": "egal123"}, headers=DRANZEIT)
        assert _code(r) == "auth/invalid-credential"
    finally:
        anmeldung.firebase_passwort = vorher


def db_test_sitzung_ablauf():
    _schema()
    from sqlalchemy import text

    from app.libs import datenbank

    c = _app()
    c.post("/routes/anmeldung/registrieren", json={"email": "kim@salon.de", "passwort": "geheim123"}, headers=DRANZEIT)
    with datenbank.engine().begin() as conn:
        conn.execute(text("update sitzungen set zuletzt = now() - interval '1 day'"))
    assert c.get("/routes/anmeldung/ich").json()["uid"]
    with datenbank.engine().connect() as conn:
        ab = conn.execute(text("select laeuft_ab - now() from sitzungen")).scalar()
    assert ab > anmeldung.SITZUNG_DAUER - timedelta(minutes=1)  # verlängert
    with datenbank.engine().begin() as conn:
        conn.execute(text("update sitzungen set laeuft_ab = now() - interval '1 second'"))
    assert c.get("/routes/anmeldung/ich").json() == {"uid": None}


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
