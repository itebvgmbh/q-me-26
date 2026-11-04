"""
Tests für den Umzug Firestore → PostgreSQL (deploy/datenumzug.py, requirements/eigene-datenbank.md Stufe 3).

Firestore ist nachgebaut (Sammlungen, Unter-Sammlungen, ein Dokument, das es nur wegen seiner Unter-Sammlung gibt).
Ohne Datenbank laufen nur die Teile ohne Schreiben; mit einer Wegwerf-Datenbank der ganze Umzug (auf GitHub:
.github/workflows/datenbank.yml):

    cd backend && QME_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/q_me_test .venv/bin/python tests/test_datenumzug.py

Achtung: Der Test leert die Tabelle dokumente in der Datenbank hinter QME_TEST_DATABASE_URL – nie die echte nehmen.
"""
import importlib.util
import os
import sys
from datetime import datetime, timezone

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

TEST_URL = os.environ.get("QME_TEST_DATABASE_URL", "").strip()
UTC = timezone.utc

_spec = importlib.util.spec_from_file_location("datenumzug", os.path.join(os.path.dirname(BACKEND), "deploy", "datenumzug.py"))
umzug = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(umzug)


# --- Firestore nachgebaut ------------------------------------------------------------------------------------------


class Snap:
    def __init__(self, doc_id, daten):
        self.id, self._daten = doc_id, daten

    def to_dict(self):
        return dict(self._daten)


class Doc:
    def __init__(self, parent, doc_id, daten=None, unter=None):
        self.parent, self.id, self.daten, self.unter = parent, doc_id, daten, unter or {}

    @property
    def path(self):
        return f"{umzug._pfad_der_sammlung(self.parent)}/{self.id}"

    def collections(self):
        return [Col(self, name, docs) for name, docs in self.unter.items()]


class Col:
    def __init__(self, parent, name, docs):
        self.parent, self.id, self._docs = parent, name, docs

    def _alle(self):
        return [Doc(self, i, d.get("daten"), d.get("unter")) for i, d in self._docs.items()]

    def stream(self):
        return [Snap(d.id, d.daten) for d in self._alle() if d.daten is not None]

    def list_documents(self):
        return self._alle()


class Firestore:
    def __init__(self, baum):
        self.baum = baum

    def collections(self):
        return [Col(None, name, docs) for name, docs in self.baum.items()]


WANN = datetime(2026, 11, 4, 9, 30, 15, 123456, tzinfo=UTC)


def baum(**extra):
    return {
        "shops": {
            "laden1": {"daten": {"name": "Salon", "owner": "chefin", "trialEndsAt": WANN, "billing": {"plan": "laden"}},
                       "unter": {"members": {"kim": {"daten": {"staffId": "s1"}}}}},
            # gibt es nur noch wegen der Unter-Sammlung (Laden gelöscht, Vermerk geblieben)
            "weg": {"daten": None, "unter": {"staff_contacts": {"s9": {"daten": {"email": "x@example.com"}}}}},
        },
        "appointments": {f"t{i}": {"daten": {"shopId": "laden1", "startTime": WANN, "nr": i, "liste": [1, "a", {"b": None}]}} for i in range(7)},
        "meta": {"founders": {"daten": {"count": 3}}},
        **extra,
    }


def test_alle_dokumente_samt_unter_sammlungen():
    docs = umzug.alle_dokumente(Firestore(baum()))
    pfade = sorted(f"{s}/{i}" for s, i, _ in docs)
    assert "shops/laden1/members/kim" in pfade and "shops/weg/staff_contacts/s9" in pfade
    assert "shops/weg" not in pfade  # gibt es selbst nicht
    assert len(docs) == 1 + 1 + 1 + 7 + 1


def test_werte_die_nicht_gehen_werden_gemeldet():
    docs = umzug.alle_dokumente(Firestore(baum(kaputt={"k1": {"daten": {"bild": b"\x00\x01"}}})))
    zeilen, fehler = umzug.kodieren_alle(docs)
    assert len(fehler) == 1 and fehler[0].startswith("kaputt/k1"), fehler
    assert len(zeilen) == len(docs) - 1


# --- ab hier nur mit Wegwerf-Datenbank ---------------------------------------------------------------------------


def _schema():
    from alembic import command
    from alembic.config import Config

    from app.libs import datenbank

    os.environ["QME_DATABASE_URL"] = TEST_URL
    datenbank._engine = None
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND, "migrations"))
    command.upgrade(cfg, "head")


def db_test_umzug_wiederholbar_und_lesbar_wie_firestore():
    _schema()
    from app.libs import datenbank
    from app.store.postgres import Client

    assert umzug.umziehen(Firestore(baum()), TEST_URL) == 0
    assert umzug.umziehen(Firestore(baum()), TEST_URL) == 0  # noch einmal: gleiches Ergebnis, nichts doppelt
    db = Client(datenbank.engine())
    laden = db.collection("shops").document("laden1").get().to_dict()
    assert laden["trialEndsAt"] == WANN and laden["billing"] == {"plan": "laden"}
    assert db.collection("shops").document("laden1").collection("members").document("kim").get().exists
    assert [s.id for s in db.collection("appointments").where("nr", ">=", 5).stream()] == ["t5", "t6"]
    assert db.collection("meta").document("founders").get().to_dict() == {"count": 3}


def db_test_kaputte_werte_schreiben_nichts():
    _schema()
    from sqlalchemy import text

    from app.libs import datenbank

    assert umzug.umziehen(Firestore(baum()), TEST_URL) == 0
    with datenbank.engine().connect() as conn:
        vorher = conn.execute(text("select count(*) from dokumente")).scalar()
    assert umzug.umziehen(Firestore(baum(kaputt={"k1": {"daten": {"bild": b"\x00"}}})), TEST_URL) == 1
    with datenbank.engine().connect() as conn:
        assert conn.execute(text("select count(*) from dokumente")).scalar() == vorher


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
        print(f"{len(tests) + len(db_tests)} Tests bestanden")
    else:
        print(f"{len(tests)} Tests bestanden, {len(db_tests)} übersprungen (ohne QME_TEST_DATABASE_URL)")
