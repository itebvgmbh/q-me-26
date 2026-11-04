"""Speicher-Schicht (requirements/eigene-datenbank.md, Stufe 1 und 3).

Jeder Datenbankzugriff des Backends läuft hierüber. Das betrifft den Client (`db()`) und alles, was sonst direkt aus
google.cloud.firestore käme: Sonderwerte, Transaktionen, Filter, Sortierung und Fehler.

Zwei Umsetzungen mit derselben Schnittstelle; der Schalter `QME_SPEICHER` wählt:
- `firestore` (Standard): Firestore über das Admin SDK.
- `postgres`: PostgreSQL, Tabelle `dokumente` (app/store/postgres.py). Adresse aus QME_DATABASE_URL.
Der übrige Code ändert sich dabei nicht, weil er nur diesen kleinen Teil von Firestore benutzt:

- **Client:** `collection()`/`document()` mit Unter-Sammlungen und `document()` ohne ID (neue ID).
- **Abfragen:** `where()` mit `==`, `<`, `>=`, `>`, `in` (auch als `FieldFilter`), `order_by()`, `limit()`,
  `stream()`/`get()`.
- **Dokumente:** `get()`, `set()` (auch `merge=True`), `update()` (auch mit Punkt-Pfaden wie `billing.status`),
  `create()` (Fehler `Conflict`, wenn es das Dokument schon gibt), `delete()`. Am Ergebnis werden `exists`, `id`,
  `reference` und `to_dict()` gelesen.
- **Sonderwerte:** `SERVER_TIMESTAMP`, `DELETE_FIELD`, `Increment` (dieselben Objekte für beide Umsetzungen).
- **Transaktionen:** `db.transaction()` mit `@transactional`, Lesen über `ref.get(transaction=tx)`. Bei zu vielen
  Konflikten kommt `Aborted`.
- **Sammel-Schreiben:** `db.batch()` mit `set`/`update`/`delete`/`commit`.
- **Live-Abfragen:** `query.on_snapshot()`, nur in app/libs/appointment_window.py, notify_worker.py,
  public_appointments.py und live.py.

`tests/test_speicher_vertrag.py` hält fest, wie sich dieser Teil verhalten muss; die Verträge laufen gegen den
Firestore-Emulator und gegen PostgreSQL. `tests/test_speicher_gebuendelt.py` sorgt dafür, dass kein Code an dieser
Schicht vorbei direkt auf Firestore zugreift. Anmeldung (firebase_admin.auth) und Push (firebase_admin.messaging)
gehören nicht dazu, die ersetzen Stufe 4 und 5.
"""

import functools
import os
import threading

from google.api_core.exceptions import Aborted, Conflict, NotFound  # noqa: F401
from google.cloud.firestore import (  # noqa: F401
    DELETE_FIELD,
    SERVER_TIMESTAMP,
    FieldFilter,
    Increment,
    Query,
)
from google.cloud.firestore import transactional as _firestore_transactional

ASCENDING = Query.ASCENDING
DESCENDING = Query.DESCENDING

_pg_client = None
_pg_lock = threading.Lock()


def speicher() -> str:
    """Welche Umsetzung gilt: "postgres" oder "firestore" (Standard)"""
    return "postgres" if os.environ.get("QME_SPEICHER", "").strip().lower() == "postgres" else "firestore"


def db():
    """Der Datenbank-Client (einmal je Prozess angelegt)."""
    if speicher() == "postgres":
        global _pg_client
        with _pg_lock:
            if _pg_client is None:
                from app.store.postgres import Client

                _pg_client = Client()
            return _pg_client
    from app.apis.firebase_utils import get_firestore_db

    return get_firestore_db()


def transactional(fn):
    """Wie google.cloud.firestore.transactional, für beide Umsetzungen: die Transaktion entscheidet"""
    firestore_fn = _firestore_transactional(fn)

    @functools.wraps(fn)
    def ausfuehren(transaction, *args, **kwargs):
        from app.store import postgres

        if isinstance(transaction, postgres.Transaction):
            return transaction.ausfuehren(fn, *args, **kwargs)
        return firestore_fn(transaction, *args, **kwargs)

    return ausfuehren
