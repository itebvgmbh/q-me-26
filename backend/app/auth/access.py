"""Wer darf was: Betreiber der App (du) und Inhaber ihrer eigenen Läden.

Betreiber stehen in /etc/q-me.env, nicht in der Datenbank – sonst könnte sich jeder selbst dazu machen:
    QME_ADMIN_EMAILS=a@example.com,b@example.com   (E-Mail des Firebase-Kontos)
    QME_ADMIN_UIDS=abc123                          (alternativ die Firebase-UID)
Ohne Eintrag gibt es keinen Betreiber: Dann kann niemand den Hintergrunddienst steuern (er startet trotzdem
von selbst) und niemand den Verlauf aller Läden sehen.
"""
import os
from typing import List

from fastapi import HTTPException

from app.auth import AuthorizedUser


def _env_set(name: str) -> set:
    return {x.strip().lower() for x in os.environ.get(name, "").split(",") if x.strip()}


def admin_lists() -> tuple:
    """(E-Mails, UIDs) der Betreiber, klein geschrieben"""
    return _env_set("QME_ADMIN_EMAILS"), _env_set("QME_ADMIN_UIDS")


def is_admin_account(uid: str, email: str = "") -> bool:
    """Ist dieses Konto Betreiber? Für Konten, die nicht angemeldet sind (Sperren, Löschen)"""
    emails, uids = admin_lists()
    email = (email or "").strip().lower()
    return (bool(email) and email in emails) or (uid or "").lower() in uids


def is_admin(user) -> bool:
    if user is None:
        return False
    return is_admin_account(user.sub or "", getattr(user, "email", None) or "")


def require_admin(user: AuthorizedUser) -> None:
    """Abhängigkeit für Endpunkte, die alle Läden betreffen"""
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Nur für den Betreiber der App.")


def owned_shop_ids(uid: str) -> List[str]:
    """IDs der Läden, die diesem Konto gehören"""
    from app.apis.firebase_utils import get_firestore_db

    return [doc.id for doc in get_firestore_db().collection("shops").where("owner", "==", uid).stream()]


def require_shop_of_owner(user, shop_id: str) -> None:
    """403, wenn der Laden nicht diesem Konto gehört (Betreiber dürfen alles)"""
    if is_admin(user):
        return
    from app.apis.firebase_utils import get_firestore_db

    shop = get_firestore_db().collection("shops").document(shop_id).get()
    if not shop.exists or (shop.to_dict() or {}).get("owner") != user.sub:
        raise HTTPException(status_code=403, detail="Das ist nicht dein Laden.")


def require_shop_member(user, shop_id: str) -> None:
    """403, wenn das Konto weder Inhaber noch im Team des Ladens ist (Betreiber dürfen alles).
    Für die Kundenliste: anlegen, Link erzeugen, löschen dürfen Inhaber und Team."""
    if is_admin(user):
        return
    from app.apis.firebase_utils import get_firestore_db

    db = get_firestore_db()
    shop = db.collection("shops").document(shop_id).get() if shop_id else None
    if shop is None or not shop.exists:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht mehr.")
    if (shop.to_dict() or {}).get("owner") == user.sub:
        return
    # Nur aktive Personen im Team: Deaktivierte haben keine Rechte mehr im Laden
    entries = [s.to_dict() or {} for s in db.collection("staff").where("userId", "==", user.sub).stream()]
    if any(e.get("shopId") == shop_id and e.get("isActive") is not False for e in entries):
        return
    raise HTTPException(status_code=403, detail="Das ist nicht dein Laden.")
