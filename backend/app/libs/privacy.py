"""Datensparsamkeit: wann Dranzeit Kundendaten entfernt.

So steht es in der Datenschutzerklärung (frontend/src/pages/Datenschutz.tsx), in den AGB (Abschnitt 7) und in der
Hilfe (backend/app/hilfe/artikel/datenschutz.md). Wer hier etwas ändert, ändert die Texte mit.

- Termine und Nummern ohne Konto (Nummer ohne Konto, Laufkunden vom Tresen, Kunden, die der Laden angelegt hat):
  90 Tage nach dem Termin verschwinden Name und Kontaktdaten. Uhrzeit, Leistung und Person bleiben für die Auswertung.
- Termine mit Konto: Der Name bleibt (er steht unter "Meine Termine"), Handynummer und E-Mail für die Benachrichtigung
  gehen ebenfalls nach 90 Tagen.
- Kunden, die ein Laden unter "Kunde anlegen" eingetragen hat (Sammlung customers): Ohne verbundenes Konto wird der
  Eintrag gelöscht, wenn 12 Monate kein Termin mehr war (bei Kunden ohne Termin 12 Monate nach dem Anlegen).
  Der Laden kann ihn auch selbst löschen (forget_customer, app/apis/datenschutz).
- Kunden-Konto löschen (delete_account_data, app/apis/datenschutz): sofort, kommende Termine werden abgesagt.

"Mit Konto" heißt: Die customerId des Termins ist ein bestehendes Firebase-Konto. Kunden-Einträge des Ladens haben eigene
IDs aus customers, Laufkunden "walk-in", Nummern ohne Konto isAnonymous.

Der Lauf über die Termine merkt sich, bis zu welchem Termin er schon war (databutton-Speicher, .local_data),
damit er nicht jeden Tag alle alten Termine neu liest.
"""

from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, Optional

import databutton as db

RETENTION_DAYS = 90
CUSTOMER_RETENTION_DAYS = 365
ANONYMIZED_NAME = "Gelöscht"
CONTACT_FIELDS = ("customerPhone", "customerEmail", "notifyEmail")
# Adresse für Datenschutz-Anfragen, wie COMPANY.email in frontend/src/constants/legal.ts (test_privacy.py prüft das)
DATENSCHUTZ_KONTAKT = "st@mes-beratung.de"
# v2 (20.10.2026): Seitdem zählen Kunden-Einträge des Ladens als "ohne Konto" – einmal alle alten Termine neu prüfen
_CURSOR_KEY = "privacy_cleanup_cursor_v2"

Accounts = Callable[[Iterable[str]], set]


def existing_accounts(uids: Iterable[str]) -> set:
    """Welche dieser IDs sind bestehende Firebase-Konten? Fehler gehen nach oben – lieber nichts tun als falsch löschen."""
    from firebase_admin import auth

    from app.apis.firebase_utils import get_firebase_app

    ids = sorted({u for u in uids if isinstance(u, str) and 0 < len(u) <= 128})
    found = set()
    for start in range(0, len(ids), 100):  # Firebase nimmt höchstens 100 je Anfrage
        result = auth.get_users([auth.UidIdentifier(u) for u in ids[start : start + 100]], app=get_firebase_app())
        found.update(user.uid for user in result.users)
    return found


def account_candidate(appt: dict) -> Optional[str]:
    """customerId des Termins, wenn sie ein Konto sein kann – sonst None"""
    customer_id = appt.get("customerId")
    if not customer_id or customer_id == "walk-in" or appt.get("isAnonymous"):
        return None
    return customer_id


def fields_to_clear(appt: dict, has_account: bool) -> dict:
    """Welche Felder eines alten Termins geleert werden. Leeres dict = nichts zu tun."""
    if appt.get("anonymizedAt"):
        return {}
    update = {}
    if not has_account and appt.get("customerName") and appt.get("customerName") != ANONYMIZED_NAME:
        update["customerName"] = ANONYMIZED_NAME
    for field in CONTACT_FIELDS:
        if appt.get(field):
            update[field] = None
    return update


def _utc(value) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def last_activity(customer: dict, last_appointment: Optional[datetime]) -> Optional[datetime]:
    """Letzter Termin, Anlegen oder Ändern (neuer Link) eines Kunden-Eintrags – das Späteste zählt"""
    dates = [d for d in (_utc(customer.get("createdAt")), _utc(customer.get("updatedAt")), _utc(last_appointment)) if d]
    return max(dates) if dates else None


def customer_expired(customer: dict, last_appointment: Optional[datetime], now: datetime) -> bool:
    """Kunden-Eintrag ohne Konto, bei dem 12 Monate nichts mehr war?"""
    last = last_activity(customer, last_appointment)
    return last is None or last < now - timedelta(days=CUSTOMER_RETENTION_DAYS)


def _forget_appointments(appointments, now: datetime) -> dict:
    """Name und Kontaktdaten sofort entfernen, kommende Termine absagen (Kunde oder Konto gelöscht)"""
    anonymized = cancelled = 0
    for doc in appointments:
        appt = doc.to_dict() or {}
        update = {"customerName": ANONYMIZED_NAME, "anonymizedAt": now, **{f: None for f in CONTACT_FIELDS}}
        start = _utc(appt.get("startTime"))
        if appt.get("status") == "scheduled" and start and start > now:
            update.update({"status": "cancelled", "updatedAt": now})
            cancelled += 1
        doc.reference.update(update)
        anonymized += 1
    return {"anonymized": anonymized, "cancelled": cancelled}


def forget_customer(firestore_db, customer_ref, customer: dict, now: Optional[datetime] = None) -> dict:
    """Kunden-Eintrag des Ladens löschen. Ohne verbundenes Konto verlieren seine Termine Namen und Kontaktdaten,
    kommende werden abgesagt. Mit Konto gehören die Termine dem Konto und bleiben, wie sie sind."""
    now = now or datetime.now(timezone.utc)
    result = {"anonymized": 0, "cancelled": 0}
    if not customer.get("userId"):
        result = _forget_appointments(firestore_db.collection("appointments").where("customerId", "==", customer_ref.id).stream(), now)
    customer_ref.delete()
    return result


def delete_account_data(firestore_db, uid: str, now: Optional[datetime] = None) -> dict:
    """Alles zu einem Kunden-Konto löschen, außer dem Firebase-Konto selbst (das löscht der Aufrufer zuletzt).
    Termine bleiben für die Auswertung des Ladens, ohne Namen und Kontaktdaten; kommende werden abgesagt."""
    now = now or datetime.now(timezone.utc)
    appointments = list(firestore_db.collection("appointments").where("customerId", "==", uid).stream())
    result = _forget_appointments(appointments, now)
    for appt in appointments:
        for sub in firestore_db.collection("push_subscriptions").where("appointmentId", "==", appt.id).stream():
            sub.reference.delete()
    for offer in firestore_db.collection("earlier_slot_notifications").where("userId", "==", uid).stream():
        offer.reference.delete()
    for entry in firestore_db.collection("queue").where("customerId", "==", uid).stream():  # alte Warteschlange, wird nicht mehr beschrieben
        entry.reference.delete()
    linked = list(firestore_db.collection("customers").where("userId", "==", uid).stream())
    for entry in linked:
        entry.reference.delete()
    firestore_db.collection("users").document(uid).delete()
    return {**result, "customerEntries": len(linked)}


def anonymize_old_appointments(firestore_db, now: datetime | None = None, batch_size: int = 300, accounts: Accounts = existing_accounts) -> int:
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
        rows = [(doc, doc.to_dict() or {}) for doc in docs]
        candidates = {c for c in (account_candidate(appt) for _, appt in rows) if c}
        known = accounts(candidates) if candidates else set()
        for doc, appt in rows:
            update = fields_to_clear(appt, account_candidate(appt) in known)
            if update:
                update["anonymizedAt"] = now
                doc.reference.update(update)
                changed += 1
        last = rows[-1][1].get("startTime")
        if len(docs) < batch_size or last is None:
            start = cutoff
            break
        # Weiter ab dem letzten gelesenen Termin (gleiche Startzeit wird erneut gelesen, schadet nicht)
        next_start = _utc(last)
        if next_start is None or next_start <= start:
            start = cutoff
            break
        start = next_start

    db.storage.json.put(_CURSOR_KEY, start.isoformat())
    return changed


def delete_stale_customers(firestore_db, now: datetime | None = None, accounts: Accounts = existing_accounts) -> int:
    """Kunden-Einträge ohne Konto löschen, bei denen 12 Monate nichts mehr war. Gibt die Zahl zurück.

    Liest alle Einträge (die legt der Laden von Hand an, es sind wenige); Termine nur bei Einträgen, die älter als
    die Frist sind."""
    now = now or datetime.now(timezone.utc)
    rows = [(doc, doc.to_dict() or {}) for doc in firestore_db.collection("customers").stream()]
    linked = {c.get("userId") for _, c in rows if c.get("userId")}
    known = accounts(linked) if linked else set()
    deleted = 0
    for doc, customer in rows:
        if customer.get("userId") in known or not customer_expired(customer, None, now):
            continue
        starts = [_utc((a.to_dict() or {}).get("startTime")) for a in firestore_db.collection("appointments").where("customerId", "==", doc.id).stream()]
        latest = max((s for s in starts if s), default=None)
        if customer_expired(customer, latest, now):
            forget_customer(firestore_db, doc.reference, {**customer, "userId": None}, now)
            deleted += 1
    return deleted
