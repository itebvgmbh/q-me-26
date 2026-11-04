"""
Tests für die Anbindung an PostgreSQL (app/libs/datenbank.py) und die Schema-Fassungen (migrations/).

Ohne Datenbank laufen nur die Tests der Adresse. Mit einer Wegwerf-Datenbank auch Schema und Doppelbuchungs-Sperre
(auf GitHub: .github/workflows/datenbank.yml):

    cd backend && QME_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/q_me_test .venv/bin/python tests/test_datenbank.py

Achtung: Die Tests setzen die Datenbank hinter QME_TEST_DATABASE_URL auf die Ausgangsfassung zurück – nie die echte nehmen.
"""
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.libs import datenbank  # noqa: E402

TEST_URL = os.environ.get("QME_TEST_DATABASE_URL", "").strip()


def test_adresse_mit_treiber_psycopg():
    assert datenbank.sqlalchemy_url("postgresql:///q_me?host=/var/run/postgresql") == (
        "postgresql+psycopg:///q_me?host=/var/run/postgresql"
    )
    assert datenbank.sqlalchemy_url("postgres://u:p@h:5432/d") == "postgresql+psycopg://u:p@h:5432/d"
    assert datenbank.sqlalchemy_url("postgresql+psycopg:///x") == "postgresql+psycopg:///x"
    assert datenbank.psycopg_url("postgres://u:p@h:5432/d") == "postgresql://u:p@h:5432/d"
    assert datenbank.psycopg_url("postgresql:///q_me?host=/var/run/postgresql") == "postgresql:///q_me?host=/var/run/postgresql"


def test_falsche_oder_fehlende_adresse():
    for falsch in ("", "   ", "sqlite:///x.db", "mysql://h/d"):
        try:
            datenbank.sqlalchemy_url(falsch)
        except (RuntimeError, ValueError):
            continue
        raise AssertionError(f"angenommen: {falsch!r}")


def test_zustand_ohne_datenbank():
    alt = os.environ.pop("QME_DATABASE_URL", None)
    try:
        assert datenbank.zustand() == "nicht eingerichtet (QME_DATABASE_URL fehlt)"
    finally:
        if alt is not None:
            os.environ["QME_DATABASE_URL"] = alt


def test_zustand_wirft_nie():
    alt = os.environ.get("QME_DATABASE_URL")
    os.environ["QME_DATABASE_URL"] = "postgresql://niemand@127.0.0.1:1/gibtsnicht"
    datenbank._engine = None
    try:
        assert datenbank.zustand().startswith("nicht erreichbar (")
    finally:
        datenbank._engine = None
        if alt is None:
            os.environ.pop("QME_DATABASE_URL", None)
        else:
            os.environ["QME_DATABASE_URL"] = alt


# --- ab hier nur mit Wegwerf-Datenbank ---------------------------------------------------------------------------


def _alembic():
    from alembic.config import Config

    os.environ["QME_DATABASE_URL"] = TEST_URL
    datenbank._engine = None
    cfg = Config(os.path.join(BACKEND, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND, "migrations"))
    return cfg


def _head(cfg) -> str:
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(cfg).get_current_head()


def db_test_schema_bis_zur_neuesten_fassung_und_zurueck():
    from alembic import command
    from sqlalchemy import text

    cfg = _alembic()
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    assert datenbank.zustand() == f"erreichbar, Schema-Fassung {_head(cfg)}"
    with datenbank.engine().connect() as conn:
        assert conn.execute(text("select 1 from pg_extension where extname = 'btree_gist'")).scalar() == 1
        assert conn.execute(text("select to_regclass('dokumente') is not null")).scalar() is True
    # Zurück und wieder vor: Jede Fassung muss sich zurücknehmen lassen
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    # Zweimal hintereinander ändert nichts (update.sh ruft das bei jedem Ausrollen)
    command.upgrade(cfg, "head")
    assert datenbank.zustand() == f"erreichbar, Schema-Fassung {_head(cfg)}"


def db_test_ueberlappende_termine_derselben_person_lehnt_die_datenbank_ab():
    """Der Plan für Stufe 3: belegte Zeit als tstzrange, Ausschluss je Person, abgesagte Termine zählen nicht."""
    from alembic import command
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    command.upgrade(_alembic(), "head")
    with datenbank.engine().connect() as conn:
        conn.execute(text("""
            create temporary table probe_termine (
                id text primary key,
                staff_id text not null,
                status text not null,
                belegt tstzrange not null,
                exclude using gist (staff_id with =, belegt with &&) where (status <> 'cancelled')
            )
        """))

        def termin(id_, person, von, bis, status="scheduled"):
            with conn.begin_nested():
                conn.execute(
                    text(
                        "insert into probe_termine values"
                        " (:id, :p, :s, tstzrange(cast(:von as timestamptz), cast(:bis as timestamptz)))"
                    ),
                    {"id": id_, "p": person, "s": status, "von": von, "bis": bis},
                )

        termin("a", "kim", "2026-11-04 10:00+01", "2026-11-04 10:30+01")
        # direkt anschließend geht (halboffene Zeiträume), andere Person zur selben Zeit auch
        termin("b", "kim", "2026-11-04 10:30+01", "2026-11-04 11:00+01")
        termin("c", "ali", "2026-11-04 10:00+01", "2026-11-04 10:30+01")
        try:
            termin("d", "kim", "2026-11-04 10:15+01", "2026-11-04 10:45+01")
        except IntegrityError as e:
            assert "exclusion" in str(e.orig).lower() or "probe_termine" in str(e.orig)
        else:
            raise AssertionError("überlappender Termin wurde angenommen")
        # abgesagt belegt nichts
        termin("e", "kim", "2026-11-04 10:15+01", "2026-11-04 10:45+01", status="cancelled")
        assert conn.execute(text("select count(*) from probe_termine")).scalar() == 4
        conn.rollback()


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
