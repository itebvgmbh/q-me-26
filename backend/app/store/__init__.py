"""Speicher-Schicht (requirements/eigene-datenbank.md, Stufe 1, 3 und 5).

Jeder Datenbankzugriff des Backends läuft hierüber: der Client (`db()`, auch über `get_firestore_db()` aus
app/apis/firebase_utils), Sonderwerte, Transaktionen, Filter, Sortierung und Fehler. Seit Stufe 5 gibt es nur noch
PostgreSQL (app/store/postgres.py, Tabelle `dokumente`, Adresse aus QME_DATABASE_URL); Firestore und die Google-Pakete
sind ausgebaut. Die Schnittstelle ist der kleine Teil von Firestore, den das Backend nutzte, damit der übrige Code
gleich bleiben konnte:

- **Client:** `collection()`/`document()` mit Unter-Sammlungen und `document()` ohne ID (neue ID).
- **Abfragen:** `where()` mit `==`, `<`, `<=`, `>=`, `>`, `in` (auch als `FieldFilter`), `order_by()`, `limit()`,
  `stream()`/`get()`.
- **Dokumente:** `get()`, `set()` (auch `merge=True`), `update()` (auch mit Punkt-Pfaden wie `billing.status`),
  `create()` (Fehler `Conflict`, wenn es das Dokument schon gibt), `delete()`. Am Ergebnis werden `exists`, `id`,
  `reference` und `to_dict()` gelesen.
- **Sonderwerte:** `SERVER_TIMESTAMP`, `DELETE_FIELD`, `Increment`.
- **Transaktionen:** `db.transaction()` mit `@transactional`, Lesen über `ref.get(transaction=tx)`. Bei zu vielen
  Konflikten kommt `Aborted`.
- **Sammel-Schreiben:** `db.batch()` mit `set`/`update`/`delete`/`commit`.
- **Live-Abfragen:** `query.on_snapshot()`, nur in app/libs/appointment_window.py, notify_worker.py,
  public_appointments.py und live.py.

`tests/test_speicher_vertrag.py` hält fest, wie sich dieser Teil verhalten muss (gegen PostgreSQL).
`tests/test_speicher_gebuendelt.py` sorgt dafür, dass nichts mehr Google- oder Firebase-Pakete lädt.
"""

import functools
import threading


class _Sonderwert:
    """SERVER_TIMESTAMP und DELETE_FIELD: verglichen wird mit `is`"""

    def __init__(self, name: str):
        self._name = name

    def __repr__(self) -> str:
        return self._name


SERVER_TIMESTAMP = _Sonderwert("SERVER_TIMESTAMP")
DELETE_FIELD = _Sonderwert("DELETE_FIELD")


class Increment:
    """Zahl im Dokument um value erhöhen (fehlt sie: von 0)"""

    def __init__(self, value):
        self.value = value


class FieldFilter:
    def __init__(self, field_path: str, op_string: str, value=None):
        self.field_path, self.op_string, self.value = field_path, op_string, value


class SpeicherFehler(Exception):
    pass


class Aborted(SpeicherFehler):
    """Transaktion nach zu vielen Konflikten abgebrochen"""


class Conflict(SpeicherFehler):
    """create(): Das Dokument gibt es schon"""


class NotFound(SpeicherFehler):
    """update(): Das Dokument gibt es nicht"""


ASCENDING = "ASCENDING"
DESCENDING = "DESCENDING"

_pg_client = None
_pg_lock = threading.Lock()


def speicher() -> str:
    """Welche Umsetzung gilt: seit Stufe 5 immer "postgres" (Firestore ist ausgebaut)"""
    return "postgres"


def db():
    """Der Datenbank-Client (einmal je Prozess angelegt)."""
    global _pg_client
    with _pg_lock:
        if _pg_client is None:
            from app.store.postgres import Client

            _pg_client = Client()
        return _pg_client


def transactional(fn):
    """Wie früher google.cloud.firestore.transactional: fn(transaction, …) läuft in der Transaktion und wird bei
    Konflikten wiederholt (app/store/postgres.Transaction)."""

    @functools.wraps(fn)
    def ausfuehren(transaction, *args, **kwargs):
        return transaction.ausfuehren(fn, *args, **kwargs)

    return ausfuehren
