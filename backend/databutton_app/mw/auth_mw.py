"""Wer fragt an? Seit Stufe 4 (requirements/eigene-datenbank.md) über die eigene Sitzung im Cookie `qme_sitzung`
(app/libs/anmeldung.py) statt über ein Firebase-Token. `User.sub` bleibt die Konto-ID wie bisher.

Schreibende Anfragen (alles außer GET/HEAD/OPTIONS) mit Sitzung gehen nur von den eigenen Seiten durch (Origin, siehe
app/apis/anmeldung.ursprung_pruefen).
"""

from http import HTTPStatus
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, WebSocket, WebSocketException, status
from fastapi.requests import HTTPConnection
from pydantic import BaseModel

SICHER = {"GET", "HEAD", "OPTIONS"}


class User(BaseModel):
    # Die Konto-ID (früher die Firebase-ID; übernommene Konten behalten sie)
    sub: str

    user_id: str | None = None
    name: str | None = None
    picture: str | None = None
    email: str | None = None
    # Hat die Person ihre E-Mail-Adresse bestätigt?
    email_verified: bool | None = None


def get_audit_log(request: HTTPConnection) -> Callable[[str], None] | None:
    return getattr(request.app.state.databutton_app_state, "audit_log", None)


AuditLogDep = Annotated[Callable[[str], None] | None, Depends(get_audit_log)]


def user_from_session(request: HTTPConnection) -> User | None:
    """Konto der Sitzung im Cookie oder None. Wirft nicht (Datenbank nicht erreichbar: None)."""
    from app.libs.anmeldung import COOKIE, sitzung_pruefen

    token = request.cookies.get(COOKIE)
    if not token:
        return None
    try:
        treffer = sitzung_pruefen(token)
    except Exception as e:
        print(f"Sitzung nicht geprüft: {e.__class__.__name__}: {e}")
        return None
    if treffer is None:
        return None
    konto = treffer[0]
    return User(sub=konto.uid, user_id=konto.uid, name=konto.name, email=konto.email, email_verified=konto.email_bestaetigt)


def _fremder_ursprung(request: HTTPConnection) -> bool:
    from app.libs.links import allowed_origins

    method = getattr(request, "method", "GET")
    if method in SICHER:
        return False
    origin = (request.headers.get("origin") or "").rstrip("/")
    return bool(origin) and origin not in allowed_origins()


def get_authorized_user(request: HTTPConnection) -> User:
    user = user_from_session(request)
    if user is not None and not _fremder_ursprung(request):
        return user
    if isinstance(request, WebSocket):
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Not authenticated")
    raise HTTPException(status_code=HTTPStatus.UNAUTHORIZED, detail="Not authenticated")


def authorize_request(request: HTTPConnection, _config=None) -> User | None:
    """Für öffentliche Endpunkte, die ein Konto nur nutzen, wenn eines angemeldet ist (app/libs/ticket.py)"""
    user = user_from_session(request)
    return None if user is None or _fremder_ursprung(request) else user
