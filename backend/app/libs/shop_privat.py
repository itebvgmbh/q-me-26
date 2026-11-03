"""Was zu einem Laden gehört, aber nur das Backend liest: shops/{shopId}/privat/{stripe|sperre}.

Der Laden-Eintrag selbst ist öffentlich lesbar (Ladenliste, Buchen ohne Anmeldung), für privat gibt es in
firestore.rules keine Regel – Browser kommen nicht heran.
    stripe   {customerId, subscriptionId}   Stripe-Kunde und -Abo; am Laden bleibt billing mit Stand, Tarif, Laufzeit
    sperre   {accounts}                     Konten, die beim Sperren des Ladens mit gesperrt wurden (Betreiber-Bereich)

Ältere Läden haben die Felder noch am Laden: migrate zieht sie um (beim Start und einmal am Tag), bis dahin lesen
stripe_ids und locked_accounts beides – wie app/libs/staff_contacts.py.
"""

from datetime import datetime, timezone

PRIVAT = "privat"
STRIPE_FIELDS = ("customerId", "subscriptionId")


def privat_ref(db, shop_id: str, name: str):
    return db.collection("shops").document(shop_id).collection(PRIVAT).document(name)


def _stored(db, shop_id: str, name: str) -> dict:
    snap = privat_ref(db, shop_id, name).get()
    return (snap.to_dict() or {}) if snap.exists else {}


def stripe_ids(db, shop_id: str, shop: dict | None = None) -> dict:
    """{customerId, subscriptionId} eines Ladens (nur gesetzte); was noch am Laden steht, zählt mit"""
    legacy = {k: v for k, v in ((shop or {}).get("billing") or {}).items() if k in STRIPE_FIELDS and v}
    stored = {k: v for k, v in _stored(db, shop_id, "stripe").items() if k in STRIPE_FIELDS and v}
    return {**legacy, **stored}


def save_stripe_ids(db, shop_id: str, customer_id: str | None = None, subscription_id: str | None = None) -> None:
    """Stripe-IDs speichern (nur die übergebenen) und vom öffentlichen Laden-Eintrag entfernen"""
    from google.cloud import firestore

    values = {k: v for k, v in (("customerId", customer_id), ("subscriptionId", subscription_id)) if v}
    if values:
        privat_ref(db, shop_id, "stripe").set({**values, "updatedAt": datetime.now(timezone.utc)}, merge=True)
    shop = db.collection("shops").document(shop_id)
    snap = shop.get()
    billing = ((snap.to_dict() or {}).get("billing") or {}) if snap.exists else {}
    legacy = [k for k in STRIPE_FIELDS if k in billing]
    if legacy:
        shop.update({f"billing.{k}": firestore.DELETE_FIELD for k in legacy})


def clear_stripe_ids(db, shop_id: str) -> None:
    """Verknüpfung mit Stripe vergessen (Betreiber: „Verknüpfung lösen“, Kunde gibt es im Stripe-Modus nicht)"""
    privat_ref(db, shop_id, "stripe").delete()


def locked_accounts(db, shop_id: str, shop: dict | None = None) -> list:
    """Konten, die beim Sperren des Ladens mit gesperrt wurden"""
    suspended = (shop or {}).get("suspended")
    legacy = (suspended.get("accounts") or []) if isinstance(suspended, dict) else []
    stored = _stored(db, shop_id, "sperre").get("accounts") or []
    return list(dict.fromkeys([*legacy, *stored]))


def save_locked_accounts(db, shop_id: str, accounts: list) -> None:
    privat_ref(db, shop_id, "sperre").set({"accounts": list(accounts), "updatedAt": datetime.now(timezone.utc)})


def clear_locked_accounts(db, shop_id: str) -> None:
    privat_ref(db, shop_id, "sperre").delete()


def migrate(db) -> int:
    """Stripe-IDs und gesperrte Konten vom Laden-Eintrag nach privat umziehen. Gibt die Zahl der Läden zurück."""
    from google.cloud import firestore

    moved = 0
    for doc in db.collection("shops").stream():
        shop = doc.to_dict() or {}
        billing = shop.get("billing") or {}
        suspended = shop.get("suspended")
        ids = {k: billing[k] for k in STRIPE_FIELDS if k in billing}
        accounts = suspended.get("accounts") if isinstance(suspended, dict) and "accounts" in suspended else None
        if not ids and accounts is None:
            continue
        now = datetime.now(timezone.utc)
        if any(ids.values()):
            privat_ref(db, doc.id, "stripe").set({**{k: v for k, v in ids.items() if v}, "updatedAt": now}, merge=True)
        if accounts:
            privat_ref(db, doc.id, "sperre").set({"accounts": list(accounts), "updatedAt": now}, merge=True)
        update = {f"billing.{k}": firestore.DELETE_FIELD for k in ids}
        if accounts is not None:
            update["suspended.accounts"] = firestore.DELETE_FIELD
        doc.reference.update(update)
        moved += 1
    return moved
