"""Löschen auf Wunsch: Ein Laden löscht einen Kunden aus seiner Kundenliste, ein Kunde löscht sein Konto.

Was dabei mit Terminen passiert, steht in app/libs/privacy.py. Konten von Läden und Teams löschen wir nicht per Knopf,
weil Abo, Rechnungen und die Daten des Ladens daran hängen – dafür schreiben sie uns (DATENSCHUTZ_KONTAKT).
"""

import re

from fastapi import APIRouter, HTTPException

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import owned_shop_ids, require_shop_member
from app.i18n import merke
from app.libs.privacy import DATENSCHUTZ_KONTAKT, delete_account_data, forget_customer

router = APIRouter()

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")


@router.delete("/datenschutz/kunde/{customer_id}")
def delete_customer(customer_id: str, user: AuthorizedUser) -> dict:
    """Kunden-Eintrag löschen ("Kundenliste" in Mein Tag)"""
    if not ID_RE.fullmatch(customer_id or ""):
        raise HTTPException(status_code=404, detail="Diesen Kunden gibt es nicht mehr.")
    snap = get_firestore_db().collection("customers").document(customer_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Diesen Kunden gibt es nicht mehr.")
    customer = snap.to_dict() or {}
    require_shop_member(user, customer.get("shopId", ""))  # Inhaber und Team
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
            detail=merke("Konten von Läden und Teams löschen wir auf Anfrage. Schreib uns an {kontakt}.", kontakt=DATENSCHUTZ_KONTAKT),
        )
    result = delete_account_data(db, user.sub)
    try:
        auth.delete_user(user.sub, app=get_firebase_app())
    except auth.UserNotFoundError:
        pass  # schon weg, etwa beim zweiten Versuch
    return result
