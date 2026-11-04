"""Speicher-Schicht (requirements/eigene-datenbank.md, Stufe 1).

Jeder Datenbankzugriff des Backends läuft hierüber. Das betrifft den Client (`db()`) und alles, was sonst direkt aus
google.cloud.firestore käme: Sonderwerte, Transaktionen, Filter, Sortierung und Fehler. Heute steckt Firestore
dahinter.

In Stufe 3 kommt eine zweite Umsetzung auf PostgreSQL mit derselben Schnittstelle dazu. Der Schalter `QME_SPEICHER`
wählt dann zwischen beiden. Der übrige Code ändert sich dabei nicht, weil er nur diesen kleinen Teil von Firestore
benutzt:

- **Client:** `collection()`/`document()` mit Unter-Sammlungen und `document()` ohne ID (neue ID).
- **Abfragen:** `where()` mit `==`, `<`, `>=`, `>`, `in` (auch als `FieldFilter`), `order_by()`, `limit()`,
  `stream()`/`get()`.
- **Dokumente:** `get()`, `set()` (auch `merge=True`), `update()` (auch mit Punkt-Pfaden wie `billing.status`),
  `create()` (Fehler `Conflict`, wenn es das Dokument schon gibt), `delete()`. Am Ergebnis werden `exists`, `id`,
  `reference` und `to_dict()` gelesen.
- **Sonderwerte:** `SERVER_TIMESTAMP`, `DELETE_FIELD`, `Increment`.
- **Transaktionen:** `db.transaction()` mit `@transactional`, Lesen über `ref.get(transaction=tx)`. Bei zu vielen
  Konflikten kommt `Aborted`.
- **Sammel-Schreiben:** `db.batch()` mit `set`/`update`/`delete`/`commit`.
- **Live-Abfragen:** `query.on_snapshot()`, nur in app/libs/appointment_window.py, notify_worker.py und
  public_appointments.py.

`tests/test_speicher_vertrag.py` hält fest, wie sich dieser Teil verhalten muss. Die Tests laufen auf GitHub gegen den
Firestore-Emulator und in Stufe 3 gegen PostgreSQL. `tests/test_speicher_gebuendelt.py` sorgt dafür, dass kein Code an
dieser Schicht vorbei direkt auf Firestore zugreift. Anmeldung (firebase_admin.auth) und Push (firebase_admin.messaging)
gehören nicht dazu, die ersetzen Stufe 4 und 5.
"""

from google.api_core.exceptions import Aborted, Conflict, NotFound  # noqa: F401
from google.cloud.firestore import (  # noqa: F401
    DELETE_FIELD,
    SERVER_TIMESTAMP,
    FieldFilter,
    Increment,
    Query,
    transactional,
)

ASCENDING = Query.ASCENDING
DESCENDING = Query.DESCENDING


def db():
    """Der Datenbank-Client (heute Firestore, einmal je Prozess angelegt)."""
    from app.apis.firebase_utils import get_firestore_db

    return get_firestore_db()
