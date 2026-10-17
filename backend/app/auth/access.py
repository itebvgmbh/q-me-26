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


def is_admin(user) -> bool:
    if user is None:
        return False
    email = (getattr(user, "email", None) or "").strip().lower()
    return (bool(email) and email in _env_set("QME_ADMIN_EMAILS")) or (user.sub or "").lower() in _env_set("QME_ADMIN_UIDS")


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
