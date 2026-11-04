"""Der Teil von firebase_admin.auth, den das Backend nutzt, auf den eigenen Konten (app/libs/anmeldung.py, Stufe 4).

Betreiber-Bereich, Datenschutz, Kunden-Link und Start-Mails riefen Firebase auf (get_user, update_user,
revoke_refresh_tokens, delete_user …). Mit denselben Namen und Feldern bleibt dort fast alles, wie es war:
`from app.libs import konto_auth as auth`. Das Argument `app=` wird angenommen und übergangen.
"""

from dataclasses import dataclass, field
from types import SimpleNamespace

from app.libs import anmeldung


class UserNotFoundError(Exception):
    pass


class EmailAlreadyExistsError(Exception):
    pass


@dataclass
class UserRecord:
    uid: str
    email: str
    email_verified: bool
    disabled: bool
    display_name: str | None
    user_metadata: SimpleNamespace
    provider_data: list = field(default_factory=list)


def _ms(wert) -> int | None:
    return int(wert.timestamp() * 1000) if wert else None


def _record(k: anmeldung.Konto) -> UserRecord:
    meta = SimpleNamespace(
        creation_timestamp=_ms(k.angelegt), last_sign_in_timestamp=_ms(k.zuletzt_angemeldet), last_refresh_timestamp=None,
    )
    return UserRecord(
        uid=k.uid, email=k.email, email_verified=k.email_bestaetigt, disabled=k.gesperrt, display_name=k.name,
        user_metadata=meta, provider_data=[SimpleNamespace(provider_id="password")] if k.passwort or k.herkunft == "firebase" else [],
    )


def get_user(uid: str, app=None) -> UserRecord:
    k = anmeldung.konto(uid)
    if k is None:
        raise UserNotFoundError(uid)
    return _record(k)


def get_user_by_email(email: str, app=None) -> UserRecord:
    k = anmeldung.konto_per_email(email)
    if k is None:
        raise UserNotFoundError(email)
    return _record(k)


class UidIdentifier:
    def __init__(self, uid: str):
        self.uid = uid


class EmailIdentifier:
    def __init__(self, email: str):
        if "@" not in (email or ""):
            raise ValueError(email)
        self.email = email


def get_users(identifiers, app=None) -> SimpleNamespace:
    identifiers = list(identifiers)
    gefunden = anmeldung.konten(i.uid for i in identifiers if isinstance(i, UidIdentifier))
    for i in identifiers:
        if isinstance(i, EmailIdentifier):
            k = anmeldung.konto_per_email(i.email)
            if k is not None:
                gefunden.append(k)
    return SimpleNamespace(users=[_record(k) for k in gefunden])


def list_users(app=None) -> SimpleNamespace:
    alle = [_record(k) for k in anmeldung.alle_konten()]
    return SimpleNamespace(iterate_all=lambda: iter(alle), users=alle)


def update_user(uid: str, app=None, **aenderung) -> UserRecord:
    namen = {"email": "email", "email_verified": "email_bestaetigt", "disabled": "gesperrt", "display_name": "name", "password": "passwort"}
    unbekannt = set(aenderung) - set(namen)
    if unbekannt:
        raise ValueError(f"Nicht unterstützt: {sorted(unbekannt)}")
    try:
        k = anmeldung.aendern(uid, **{namen[n]: w for n, w in aenderung.items()})
    except anmeldung.AnmeldeFehler:
        raise EmailAlreadyExistsError(aenderung.get("email"))
    if k is None:
        raise UserNotFoundError(uid)
    if aenderung.get("disabled"):
        anmeldung.sitzungen_beenden(uid)
    return _record(k)


def revoke_refresh_tokens(uid: str, app=None) -> None:
    """Alle Geräte abmelden"""
    anmeldung.sitzungen_beenden(uid)


def delete_user(uid: str, app=None) -> None:
    if not anmeldung.loeschen(uid):
        raise UserNotFoundError(uid)
