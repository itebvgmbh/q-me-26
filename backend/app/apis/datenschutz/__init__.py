"""Löschen auf Wunsch: Ein Laden löscht einen Kunden aus seiner Kundenliste, ein Kunde löscht sein Konto.

Was dabei mit Terminen passiert, steht in app/libs/privacy.py. Konten von Läden und Teams löschen wir nicht per Knopf,
weil Abo, Rechnungen und die Daten des Ladens daran hängen – dafür schreiben sie uns (DATENSCHUTZ_KONTAKT).
"""

import re

from fastapi import APIRouter, HTTPException

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import is_admin, owned_shop_ids
from app.libs.privacy import DATENSCHUTZ_KONTAKT, delete_account_data, forget_customer

router = APIRouter()

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")


def _require_shop_member(user, shop_id: str) -> None:
    """Inhaber und Team des Ladens dürfen seine Kundenliste pflegen (anlegen dürfen sie ebenfalls beide)"""
    if is_admin(user):
        return
    db = get_firestore_db()
    shop = db.collection("shops").document(shop_id).get() if shop_id else None
    if shop is None or not shop.exists:
        raise HTTPException(status_code=404, detail="Diesen Kunden gibt es nicht mehr.")
    if (shop.to_dict() or {}).get("owner") == user.sub:
        return
    # Nur aktive Personen im Team: Deaktivierte haben keine Rechte mehr im Laden
    entries = [s.to_dict() or {} for s in db.collection("staff").where("userId", "==", user.sub).stream()]
    if any(e.get("shopId") == shop_id and e.get("isActive") is not False for e in entries):
        return
    raise HTTPException(status_code=403, detail="Das ist nicht dein Laden.")


@router.delete("/datenschutz/kunde/{customer_id}")
def delete_customer(customer_id: str, user: AuthorizedUser) -> dict:
    """Kunden-Eintrag löschen ("Kundenliste" in Mein Tag)"""
    if not ID_RE.fullmatch(customer_id or ""):
        raise HTTPException(status_code=404, detail="Diesen Kunden gibt es nicht mehr.")
    snap = get_firestore_db().collection("customers").document(customer_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Diesen Kunden gibt es nicht mehr.")
    customer = snap.to_dict() or {}
    _require_shop_member(user, customer.get("shopId", ""))
    return forget_customer(get_firestore_db(), snap.reference, customer)


@router.delete("/datenschutz/konto")
def delete_account(user: AuthorizedUser) -> dict:
    """Eigenes Kunden-Konto löschen (Mein Profil). Die Anmeldung gilt danach nicht mehr."""
    from firebase_admin import auth

    from app.apis.firebase_utils import get_firebase_app

    db = get_firestore_db()
    if owned_shop_ids(user.sub) or list(db.collection("staff").where("userId", "==", user.sub).limit(1).stream()):
        raise HTTPException(
            status_code=409,
            detail=f"Konten von Läden und Teams löschen wir auf Anfrage. Schreib uns an {DATENSCHUTZ_KONTAKT}.",
        )
    result = delete_account_data(db, user.sub)
    try:
        auth.delete_user(user.sub, app=get_firebase_app())
    except auth.UserNotFoundError:
        pass  # schon weg, etwa beim zweiten Versuch
    return result
