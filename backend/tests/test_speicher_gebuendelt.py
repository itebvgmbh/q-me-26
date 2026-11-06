"""
Wächter für die Speicher-Schicht (app/store, requirements/eigene-datenbank.md): Seit Stufe 5 lädt das Backend weder
Google- noch Firebase-Pakete. Alle Daten laufen über app/store (PostgreSQL). Ohne Datenbank lauffähig:

    cd backend && .venv/bin/python tests/test_speicher_gebuendelt.py

Schlägt der Test an: Sonderwerte, Transaktionen, Filter und Fehler aus `app.store` holen (`from app import store`,
`store.SERVER_TIMESTAMP`, `@store.transactional`, `from app.store import Conflict`) und den Client mit `store.db()` oder
wie bisher über `get_firestore_db()`.
"""
import ast
import os

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Seit Stufe 5 nirgends mehr (die Anmeldung prüft alte Passwörter über die REST-Schnittstelle, ohne Paket)
ERLAUBT: set = set()


def _dateien():
    yield os.path.join(BACKEND, "main.py")
    for wurzel in ("app", "databutton_app"):
        for ordner, _, namen in os.walk(os.path.join(BACKEND, wurzel)):
            for name in namen:
                if name.endswith(".py"):
                    yield os.path.join(ordner, name)


def verstoesse(quelle: str) -> list[str]:
    """Google- und Firebase-Pakete in einem Stück Python-Code, als Liste lesbarer Meldungen."""
    gefunden = []
    for knoten in ast.walk(ast.parse(quelle)):
        if isinstance(knoten, ast.Import):
            for alias in knoten.names:
                if alias.name.startswith(("google.", "firebase_admin")) or alias.name in ("google", "firebase_admin"):
                    gefunden.append(f"Zeile {knoten.lineno}: import {alias.name}")
        elif isinstance(knoten, ast.ImportFrom) and knoten.module:
            if knoten.module.split(".")[0] in ("google", "firebase_admin"):
                gefunden.append(f"Zeile {knoten.lineno}: from {knoten.module} import …")
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
    assert verstoesse("from firebase_admin import auth")
    assert verstoesse("from firebase_admin import messaging")
    assert verstoesse("import firebase_admin")
    assert not verstoesse("from app import store\nfrom app.store import Conflict")


def test_get_firestore_db_ist_der_speicher():
    """Fast alle Module holen ihren Client über get_firestore_db(); das muss der Client von app/store sein"""
    from app import store
    from app.apis import firebase_utils as fu
    from app.store import postgres

    class Attrappe:
        pass

    vorher = postgres.Client, store._pg_client
    postgres.Client, store._pg_client = Attrappe, None
    try:
        assert isinstance(fu.get_firestore_db(), Attrappe)
        assert fu.get_firestore_db() is store.db()
    finally:
        postgres.Client, store._pg_client = vorher


def test_pakete_nicht_mehr_vorgesehen():
    with open(os.path.join(BACKEND, "requirements.txt"), encoding="utf-8") as f:
        pakete = f.read().lower()
    assert "firebase" not in pakete and "google-cloud" not in pakete


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
