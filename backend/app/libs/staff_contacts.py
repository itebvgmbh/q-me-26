"""Kontaktdaten der Personen im Team: shops/{shopId}/staff_contacts/{staffId} = {email, phone, inviteEmailTo}.

Gegenstück zu frontend/src/utils/firestore/staff-contacts.ts. Die Einträge in staff sind öffentlich lesbar (Buchen und
Nummer ziehen ohne Anmeldung zeigen Name, Bild, Leistungen, Arbeitszeiten). E-Mail, Telefon und die Adresse, an die
die Einladung ging, stehen deshalb hier; im Browser liest und pflegt sie nur der Inhaber (firestore.rules).

Ältere Einträge haben die Felder noch am staff-Eintrag: migrate zieht sie um (beim Start und einmal am Tag), und bis
dahin lesen contact_of/email_of beides.
"""

from datetime import datetime, timezone

STAFF_CONTACTS = "staff_contacts"
CONTACT_FIELDS = ("email", "phone", "inviteEmailTo")


def contact_ref(db, shop_id: str, staff_id: str):
    return db.collection("shops").document(shop_id).collection(STAFF_CONTACTS).document(staff_id)


def contact_of(db, staff_id: str, staff: dict) -> dict:
    """Kontaktdaten einer Person; was noch am alten Eintrag steht, zählt mit (vor dem Umzug)."""
    legacy = {f: staff[f] for f in CONTACT_FIELDS if staff.get(f)}
    shop_id = staff.get("shopId")
    if not shop_id:
        return legacy
    snap = contact_ref(db, shop_id, staff_id).get()
    stored = {k: v for k, v in (snap.to_dict() or {}).items() if k in CONTACT_FIELDS and v} if snap.exists else {}
    return {**legacy, **stored}


def email_of(db, staff_id: str, staff: dict) -> str:
    return str(contact_of(db, staff_id, staff).get("email") or "").strip()


def contacts_of_shop(db, shop_id: str) -> dict[str, dict]:
    """{staffId: {email, phone, inviteEmailTo}} eines Ladens (Betreiber-Bereich)"""
    ref = db.collection("shops").document(shop_id).collection(STAFF_CONTACTS)
    return {d.id: d.to_dict() or {} for d in ref.stream()}


def split_legacy(staff: dict) -> dict:
    """Kontaktfelder, die noch am staff-Eintrag stehen (auch leere)"""
    return {f: staff[f] for f in CONTACT_FIELDS if f in staff}


def migrate(db, now: datetime | None = None, batch_size: int = 200) -> int:
    """Kontaktfelder vom staff-Eintrag zu den Kontaktdaten des Ladens umziehen. Gibt die Zahl der Personen zurück."""
    from google.cloud import firestore

    now = now or datetime.now(timezone.utc)
    moved = 0
    batch, pending = db.batch(), 0
    for doc in db.collection("staff").stream():
        staff = doc.to_dict() or {}
        legacy = split_legacy(staff)
        if not legacy:
            continue
        shop_id = staff.get("shopId")
        if shop_id:
            values = {k: v for k, v in legacy.items() if v not in (None, "")}
            if values:
                batch.set(contact_ref(db, shop_id, doc.id), {**values, "updatedAt": now}, merge=True)
        batch.update(doc.reference, {f: firestore.DELETE_FIELD for f in legacy})
        moved += 1
        pending += 2
        if pending >= batch_size:
            batch.commit()
            batch, pending = db.batch(), 0
    if pending:
        batch.commit()
    return moved
