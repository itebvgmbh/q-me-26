"""Datensparsamkeit: Namen und Kontaktdaten aus Wartenummern ohne Konto nach 90 Tagen entfernen.

So steht es in der Datenschutzerklärung (frontend/src/pages/Datenschutz.tsx). Termine bleiben für
Statistik erhalten (Zeit, Leistung, Person), nur die Angaben zur Person verschwinden.
Kunden mit Konto sind ausgenommen: Ihre Daten hängen am Konto und gehen mit dessen Löschung.

Der Lauf merkt sich, bis zu welchem Termin er schon war (databutton-Speicher, .local_data),
damit er nicht jeden Tag alle alten Termine neu liest.
"""

from datetime import datetime, timedelta, timezone

import databutton as db

RETENTION_DAYS = 90
ANONYMIZED_NAME = "Gelöscht"
PERSONAL_FIELDS = ("customerPhone", "customerEmail", "notifyEmail")
_CURSOR_KEY = "privacy_cleanup_cursor"


def fields_to_clear(appt: dict) -> dict:
    """Welche Felder eines alten Termins geleert werden. Leeres dict = nichts zu tun."""
    customer_id = appt.get("customerId")
    without_account = bool(appt.get("isAnonymous")) or not customer_id or customer_id == "walk-in"
    if not without_account or appt.get("anonymizedAt"):
        return {}
    update = {}
    if appt.get("customerName") and appt.get("customerName") != ANONYMIZED_NAME:
        update["customerName"] = ANONYMIZED_NAME
    for field in PERSONAL_FIELDS:
        if appt.get(field):
            update[field] = None
    return update


def anonymize_old_appointments(firestore_db, now: datetime | None = None, batch_size: int = 300) -> int:
    """Bearbeitet alte Termine ab dem gemerkten Stand. Gibt die Zahl der geänderten Termine zurück."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=RETENTION_DAYS)
    cursor_iso = db.storage.json.get(_CURSOR_KEY, None)
    start = datetime.fromisoformat(cursor_iso) if cursor_iso else datetime(2020, 1, 1, tzinfo=timezone.utc)

    changed = 0
    while start < cutoff:
        query = (
            firestore_db.collection("appointments")
            .where("startTime", ">=", start)
            .where("startTime", "<", cutoff)
            .order_by("startTime")
            .limit(batch_size)
        )
        docs = list(query.stream())
        if not docs:
            start = cutoff
            break
        for doc in docs:
            update = fields_to_clear(doc.to_dict() or {})
            if update:
                update["anonymizedAt"] = now
                doc.reference.update(update)
                changed += 1
        last = (docs[-1].to_dict() or {}).get("startTime")
        if len(docs) < batch_size or last is None:
            start = cutoff
            break
        # Weiter ab dem letzten gelesenen Termin (gleiche Startzeit wird erneut gelesen, schadet nicht)
        next_start = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
        if next_start <= start:
            start = cutoff
            break
        start = next_start

    db.storage.json.put(_CURSOR_KEY, start.isoformat())
    return changed
