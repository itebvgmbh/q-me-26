"""Was zu einem Laden gehört, aber nur das Backend liest: shops/{shopId}/privat/{stripe|sperre}.

Der Laden-Eintrag selbst ist öffentlich lesbar (Ladenliste, Buchen ohne Anmeldung), für privat gibt es in
firestore.rules keine Regel – Browser kommen nicht heran.
    stripe       {customerId, subscriptionId}   Stripe-Kunde und -Abo; am Laden bleibt billing mit Stand, Tarif, Laufzeit
    stripe_test  {aktiv, seit, customerId, subscriptionId}
                                            Testmodus (Betreiber-Bereich): der Laden bucht in der Stripe-Sandbox;
                                            Kunde und Abo von dort. Die echten IDs in stripe bleiben unberührt.
    sperre       {accounts}                 Konten, die beim Sperren des Ladens mit gesperrt wurden (Betreiber-Bereich)

Ältere Läden haben die Felder noch am Laden: migrate zieht sie um (beim Start und einmal am Tag), bis dahin lesen
stripe_ids und locked_accounts beides – wie app/libs/staff_contacts.py.
"""

from datetime import datetime, timezone

PRIVAT = "privat"
STRIPE_FIELDS = ("customerId", "subscriptionId")
LIVE, TEST = "live", "test"  # Stripe-Modus eines Ladens: echte Zahlungen oder Sandbox (gleich wie app/libs/stripe_billing.py)
TEST_DOC = "stripe_test"


def privat_ref(db, shop_id: str, name: str):
    return db.collection("shops").document(shop_id).collection(PRIVAT).document(name)


def _stored(db, shop_id: str, name: str) -> dict:
    snap = privat_ref(db, shop_id, name).get()
    return (snap.to_dict() or {}) if snap.exists else {}


def _ids(values: dict) -> dict:
    return {k: v for k, v in values.items() if k in STRIPE_FIELDS and v}


def stripe_link(db, shop_id: str, shop: dict | None = None) -> tuple[str, dict]:
    """(Modus, {customerId, subscriptionId}) eines Ladens – im Testmodus die IDs aus der Sandbox"""
    test = _stored(db, shop_id, TEST_DOC)
    if test.get("aktiv"):
        return TEST, _ids(test)
    return LIVE, stripe_ids(db, shop_id, shop, LIVE)


def stripe_mode(db, shop_id: str) -> str:
    return TEST if _stored(db, shop_id, TEST_DOC).get("aktiv") else LIVE


def stripe_ids(db, shop_id: str, shop: dict | None = None, mode: str | None = None) -> dict:
    """{customerId, subscriptionId} eines Ladens (nur gesetzte) im angegebenen Modus, ohne Angabe im aktuellen.
    Was noch am Laden steht (ältere Stände), zählt im Live-Modus mit."""
    if mode is None:
        return stripe_link(db, shop_id, shop)[1]
    if mode == TEST:
        return _ids(_stored(db, shop_id, TEST_DOC))
    legacy = _ids((shop or {}).get("billing") or {})
    return {**legacy, **_ids(_stored(db, shop_id, "stripe"))}


def save_stripe_ids(db, shop_id: str, customer_id: str | None = None, subscription_id: str | None = None, mode: str = LIVE) -> None:
    """Stripe-IDs speichern (nur die übergebenen) und vom öffentlichen Laden-Eintrag entfernen"""
    from google.cloud import firestore

    values = {k: v for k, v in (("customerId", customer_id), ("subscriptionId", subscription_id)) if v}
    if mode == TEST:
        if values:
            privat_ref(db, shop_id, TEST_DOC).set({**values, "updatedAt": datetime.now(timezone.utc)}, merge=True)
        return
    if values:
        privat_ref(db, shop_id, "stripe").set({**values, "updatedAt": datetime.now(timezone.utc)}, merge=True)
    shop = db.collection("shops").document(shop_id)
    snap = shop.get()
    billing = ((snap.to_dict() or {}).get("billing") or {}) if snap.exists else {}
    legacy = [k for k in STRIPE_FIELDS if k in billing]
    if legacy:
        shop.update({f"billing.{k}": firestore.DELETE_FIELD for k in legacy})


def clear_stripe_ids(db, shop_id: str, mode: str = LIVE) -> None:
    """Verknüpfung mit Stripe vergessen (Betreiber: „Verknüpfung lösen“, Kunde gibt es im Stripe-Modus nicht).
    Im Testmodus bleibt der Laden im Testmodus, nur Kunde und Abo aus der Sandbox sind weg."""
    if mode == TEST:
        rest = {k: v for k, v in _stored(db, shop_id, TEST_DOC).items() if k not in STRIPE_FIELDS}
        if rest:
            privat_ref(db, shop_id, TEST_DOC).set(rest)
        return
    privat_ref(db, shop_id, "stripe").delete()


def start_test_mode(db, shop_id: str) -> None:
    """Laden in den Testmodus: neu anfangen, ohne Kunde und Abo aus einem früheren Test"""
    privat_ref(db, shop_id, TEST_DOC).set({"aktiv": True, "seit": datetime.now(timezone.utc)})


def end_test_mode(db, shop_id: str) -> None:
    privat_ref(db, shop_id, TEST_DOC).delete()


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
