"""Anbindung an PostgreSQL (requirements/eigene-datenbank.md).

Die Adresse steht in QME_DATABASE_URL, auf dem Server `postgresql:///q_me?host=/var/run/postgresql`: lokaler Socket,
Anmeldung als Systembenutzer q-me ohne Passwort (peer). deploy/datenbank.sh einrichten legt Datenbank und Eintrag an.
Fehlt die Variable, gibt es keine Datenbank – bis Stufe 3 liegen alle Daten weiter in Firestore.

Das Schema ändert sich nur über Alembic (backend/migrations); `deploy/update.sh` spielt neue Fassungen beim Ausrollen ein.
"""

import os

_engine = None


def database_url() -> str:
    return os.environ.get("QME_DATABASE_URL", "").strip()


def sqlalchemy_url(url: str | None = None) -> str:
    """Adresse für SQLAlchemy mit dem Treiber psycopg 3 (ohne Angabe nähme SQLAlchemy psycopg2)."""
    url = database_url() if url is None else url.strip()
    if not url:
        raise RuntimeError("QME_DATABASE_URL fehlt")
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    raise ValueError("QME_DATABASE_URL muss mit postgresql:// beginnen")


def engine():
    """Gemeinsamer Verbindungs-Pool. Klein halten: PostgreSQL auf dem Server teilen sich mehrere Projekte."""
    global _engine
    if _engine is None:
        from sqlalchemy import create_engine

        _engine = create_engine(
            sqlalchemy_url(),
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            connect_args={"connect_timeout": 5},
        )
    return _engine


def zustand() -> str:
    """Kurzbefund fürs Log beim Start: Fassung des Schemas oder warum es keine Verbindung gibt. Wirft nie."""
    if not database_url():
        return "nicht eingerichtet (QME_DATABASE_URL fehlt)"
    try:
        from sqlalchemy import text

        with engine().connect() as conn:
            fassung = conn.execute(text("select version_num from alembic_version")).scalar()
        return f"erreichbar, Schema-Fassung {fassung}"
    except Exception as e:  # Start des Dienstes nie daran scheitern lassen
        return f"nicht erreichbar ({e.__class__.__name__}: {str(e).strip().splitlines()[0] if str(e).strip() else ''})"
