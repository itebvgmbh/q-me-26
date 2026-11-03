"""Links mit Token (Team-Einladung, Kunden-Link, Nummer ohne Konto): Token erzeugen, nur den Hash speichern, prüfen,
Adresse für den Link.

Firestore ist für Buchung und Nummer ziehen ohne Anmeldung lesbar. Ein Token im Klartext dort könnte jeder lesen
und benutzen – deshalb steht am Eintrag nur sein SHA-256-Hash, und das Backend prüft.
"""

import hashlib
import hmac
import os
import secrets

from fastapi import Request

# Adressen der App, auf die Links zeigen dürfen; zum Entwickeln weitere über QME_DEV_ORIGINS (z. B. http://localhost:5173)
ALLOWED_ORIGINS = ("https://dranzeit.de", "https://www.dranzeit.de", "https://q-me.spielmacherei.de")


def allowed_origins() -> tuple:
    extra = tuple(o.strip().rstrip("/") for o in os.environ.get("QME_DEV_ORIGINS", "").split(",") if o.strip())
    return ALLOWED_ORIGINS + extra


def new_token() -> str:
    """32 Zeichen, 192 Bit Zufall"""
    return secrets.token_urlsafe(24)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def token_matches(stored_hash: str | None, token: str | None) -> bool:
    """Passt das Token zum gespeicherten Hash? Zeitkonstant verglichen."""
    if not stored_hash or not token or not isinstance(stored_hash, str):
        return False
    return hmac.compare_digest(stored_hash, token_hash(token))


def public_origin(request: Request) -> str:
    """Link auf die Adresse, von der der Laden kam – nur bekannte Adressen."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin in allowed_origins():
        return origin
    return (os.environ.get("PUBLIC_URL", "").strip() or "https://dranzeit.de").rstrip("/")
