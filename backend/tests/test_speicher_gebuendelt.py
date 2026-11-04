"""
Wächter für die Speicher-Schicht (app/store, requirements/eigene-datenbank.md, Stufe 1): Kein Code im Backend greift an
ihr vorbei direkt auf Firestore zu. Nur so lässt sich in Stufe 3 Firestore gegen PostgreSQL tauschen, ohne den übrigen
Code anzufassen. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_speicher_gebuendelt.py

Schlägt der Test an: Sonderwerte, Transaktionen, Filter und Fehler aus `app.store` holen (`from app import store`,
`store.SERVER_TIMESTAMP`, `@store.transactional`, `from app.store import Conflict`) und den Client mit `store.db()` oder
wie bisher über `get_firestore_db()`.
"""
import ast
import os

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Hier darf Firestore direkt vorkommen: die Speicher-Schicht selbst und der Aufbau des Clients
ERLAUBT = {
    os.path.join("app", "store", "__init__.py"),
    os.path.join("app", "apis", "firebase_utils", "__init__.py"),
}
# Anmeldung und Push laufen noch über Firebase (Stufe 4 und 5), gehören aber nicht zum Speicher
FIREBASE_OHNE_SPEICHER = {"auth", "messaging"}


def _dateien():
    yield os.path.join(BACKEND, "main.py")
    for wurzel in ("app", "databutton_app"):
        for ordner, _, namen in os.walk(os.path.join(BACKEND, wurzel)):
            for name in namen:
                if name.endswith(".py"):
                    yield os.path.join(ordner, name)


def verstoesse(quelle: str) -> list[str]:
    """Direkte Zugriffe auf Firestore in einem Stück Python-Code, als Liste lesbarer Meldungen."""
    gefunden = []
    for knoten in ast.walk(ast.parse(quelle)):
        if isinstance(knoten, ast.Import):
            for alias in knoten.names:
                if alias.name.startswith(("google.cloud", "google.api_core")) or alias.name == "firebase_admin.firestore":
                    gefunden.append(f"Zeile {knoten.lineno}: import {alias.name}")
        elif isinstance(knoten, ast.ImportFrom) and knoten.module:
            modul = knoten.module
            namen = {a.name for a in knoten.names}
            if modul.startswith(("google.cloud", "google.api_core")):
                gefunden.append(f"Zeile {knoten.lineno}: from {modul} import {', '.join(sorted(namen))}")
            elif modul == "firebase_admin" and not namen <= FIREBASE_OHNE_SPEICHER:
                gefunden.append(f"Zeile {knoten.lineno}: from firebase_admin import {', '.join(sorted(namen))}")
            elif modul.startswith("firebase_admin.") and modul != "firebase_admin.auth":
                gefunden.append(f"Zeile {knoten.lineno}: from {modul} import …")
    return gefunden


def test_kein_direkter_zugriff_auf_firestore():
    fehler = []
    for pfad in _dateien():
        relativ = os.path.relpath(pfad, BACKEND)
        if relativ in ERLAUBT:
            continue
        with open(pfad, encoding="utf-8") as f:
            for meldung in verstoesse(f.read()):
                fehler.append(f"{relativ}, {meldung}")
    assert not fehler, "An app/store vorbei auf Firestore zugegriffen:\n  " + "\n  ".join(fehler)


def test_waechter_erkennt_die_ueblichen_formen():
    assert verstoesse("from google.cloud import firestore")
    assert verstoesse("from google.cloud import firestore as gcf")
    assert verstoesse("def f():\n    from google.cloud import firestore\n")
    assert verstoesse("from firebase_admin import firestore")
    assert verstoesse("from firebase_admin import credentials, firestore")
    assert verstoesse("from google.api_core.exceptions import Conflict")
    assert verstoesse("import google.cloud.firestore")
    assert not verstoesse("from firebase_admin import auth")
    assert not verstoesse("from firebase_admin import messaging")
    assert not verstoesse("from app import store\nfrom app.store import Conflict")


def test_get_firestore_db_folgt_dem_schalter():
    """Fast alle Module holen ihren Client über get_firestore_db(). Mit QME_SPEICHER=postgres muss das PostgreSQL sein,
    sonst schriebe nach dem Umzug ein Teil des Backends weiter nach Firestore."""
    from app import store
    from app.apis import firebase_utils as fu
    from app.store import postgres

    class Attrappe:
        pass

    vorher = os.environ.get("QME_SPEICHER"), postgres.Client, store._pg_client, fu.google_firestore_db
    google = object()
    postgres.Client, store._pg_client, fu.google_firestore_db = Attrappe, None, lambda: google
    try:
        os.environ["QME_SPEICHER"] = "postgres"
        assert isinstance(fu.get_firestore_db(), Attrappe)
        assert fu.get_firestore_db() is store.db()
        os.environ.pop("QME_SPEICHER")
        assert fu.get_firestore_db() is google
    finally:
        if vorher[0] is None:
            os.environ.pop("QME_SPEICHER", None)
        else:
            os.environ["QME_SPEICHER"] = vorher[0]
        postgres.Client, store._pg_client, fu.google_firestore_db = vorher[1:]


def test_firestore_selbst_nur_im_speicher():
    """google_firestore_db() (Firestore ohne Rücksicht auf den Schalter) nutzen nur app/store und der Umzug"""
    fehler = []
    for pfad in _dateien():
        relativ = os.path.relpath(pfad, BACKEND)
        if relativ in ERLAUBT:
            continue
        with open(pfad, encoding="utf-8") as f:
            baum = ast.parse(f.read())
        for knoten in ast.walk(baum):
            name = getattr(knoten, "id", None) or getattr(knoten, "attr", None) or getattr(knoten, "name", None)
            if name == "google_firestore_db":
                fehler.append(f"{relativ}, Zeile {knoten.lineno}")
    assert not fehler, "Firestore am Schalter vorbei:\n  " + "\n  ".join(fehler)


def test_speicher_bietet_was_der_code_braucht():
    from app import store

    for name in ("SERVER_TIMESTAMP", "DELETE_FIELD", "Increment", "FieldFilter", "transactional",
                 "ASCENDING", "DESCENDING", "Conflict", "Aborted", "NotFound", "db"):
        assert hasattr(store, name), name


if __name__ == "__main__":
    import sys

    sys.path.insert(0, BACKEND)
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
