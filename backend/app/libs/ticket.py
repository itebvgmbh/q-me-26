"""Wer darf an einer Nummer etwas tun – zurückgeben, ins Konto übernehmen, Benachrichtigung einschalten?

Den Termin selbst lesen und ändern im Browser nur Laden und eigenes Konto (firestore.rules). Eine Nummer ohne Konto
hat dafür einen Schlüssel: Der Browser erzeugt ihn beim Ziehen, am Termin steht nur sein SHA-256 (ticketKeyHash),
der Schlüssel selbst steht im Link der Nummernseite (/nummer/<id>#k=…) und im Browser
(frontend/src/utils/ticket-key.ts). Nummern ohne Schlüssel (von vor dieser Umstellung) gehen nur noch am Tresen.
"""

from fastapi import Request

from app.libs.links import token_matches


def key_matches(appt: dict, key: str | None) -> bool:
    return token_matches(appt.get("ticketKeyHash"), key)


def request_uid(request: Request) -> str | None:
    """Angemeldetes Konto, falls die Anfrage eine gültige Anmeldung mitbringt (öffentliche Endpunkte)"""
    header = request.headers.get("authorization") or ""
    if not header.startswith("Bearer ") or len(header) < 20:
        return None
    try:
        from databutton_app.mw.auth_mw import authorize_request

        config = getattr(request.app.state, "auth_config", None)
        user = authorize_request(request, config) if config else None
        return user.sub if user else None
    except Exception as e:
        print(f"Anmeldung an der Nummer nicht geprüft: {e}")
        return None


def may_manage(appt: dict, key: str | None, uid: str | None) -> bool:
    """Schlüssel der Nummer oder das eigene Konto"""
    if key_matches(appt, key):
        return True
    customer = appt.get("customerId")
    return bool(uid and customer and customer == uid)
