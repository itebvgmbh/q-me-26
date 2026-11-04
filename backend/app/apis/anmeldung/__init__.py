"""Anmelden, Registrieren, Abmelden, Passwort und Adresse (Stufe 4, app/libs/anmeldung.py).

Ohne vorgeschaltete Anmeldung (routers.json); wo ein Konto nötig ist, liest der Endpunkt die Sitzung selbst.
Fehler kommen mit dem Code im Kopf `X-Anmeldung-Fehler` (auth/… wie bei Firebase), der Browser übersetzt ihn
(frontend/src/utils/auth-errors.ts). Die Mails für „Passwort vergessen“ und „Adresse bestätigen“ verschicken weiter
app/apis/password_reset und app/apis/email_verification.
"""

import hashlib

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.i18n import merke
from app.libs import anmeldung
from app.libs.anmeldung import COOKIE, AnmeldeFehler

router = APIRouter()

TEXTE = {
    "auth/invalid-credential": merke("E-Mail oder Passwort stimmen nicht."),
    "auth/user-disabled": merke("Dieses Konto ist gesperrt."),
    "auth/too-many-requests": merke("Zu viele Versuche. Warte kurz und versuch es dann noch einmal."),
    "auth/email-already-in-use": merke("Für diese E-Mail gibt es schon ein Konto. Melde dich an oder setz dein Passwort zurück."),
    "auth/invalid-email": merke("Diese E-Mail-Adresse sieht nicht richtig aus."),
    "auth/weak-password": merke("Das Passwort ist zu kurz. Nimm mindestens 6 Zeichen."),
    "auth/missing-password": merke("Bitte gib ein Passwort ein."),
    "auth/password-too-long": merke("Das Passwort ist zu lang."),
    "auth/invalid-action-code": merke("Dieser Link gilt nicht mehr. Fordere einfach einen neuen an."),
    "auth/expired-action-code": merke("Dieser Link ist abgelaufen. Fordere einfach einen neuen an."),
    "auth/requires-recent-login": merke("Gib zuerst dein bisheriges Passwort ein."),
    "auth/unauthenticated": merke("Du bist nicht angemeldet."),
    "auth/wrong-origin": merke("Diese Anfrage kam nicht von Dranzeit."),
}


def fehler(code: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail=TEXTE.get(code, code), headers={"X-Anmeldung-Fehler": code})


def ip_von(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def ursprung_pruefen(request: Request) -> None:
    """Schreibende Anfragen nur von den eigenen Seiten (fremde Seiten könnten sonst mit dem Cookie Dinge auslösen).
    Ohne Origin-Kopf (alte Browser, Werkzeuge ohne Cookie) geht es durch; SameSite=Lax schützt dann zusätzlich."""
    from app.libs.links import allowed_origins

    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin and origin not in allowed_origins():
        raise fehler("auth/wrong-origin", 403)


def cookie_setzen(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE, token, max_age=int(anmeldung.SITZUNG_DAUER.total_seconds()), httponly=True, secure=True, samesite="lax", path="/",
    )


def cookie_loeschen(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/", secure=True, httponly=True, samesite="lax")


def eigene_sitzung(request: Request):
    """(Konto, bestaetigt, Token) der Anfrage oder 401"""
    token = request.cookies.get(COOKIE)
    treffer = anmeldung.sitzung_pruefen(token)
    if treffer is None:
        raise fehler("auth/unauthenticated", 401)
    return treffer[0], treffer[1], token


def _ausfuehren(fn, *args):
    try:
        return fn(*args)
    except AnmeldeFehler as e:
        raise fehler(e.code, e.status)


class Zugang(BaseModel):
    email: str = ""
    passwort: str = ""


class Passwort(BaseModel):
    passwort: str = ""


class Code(BaseModel):
    code: str = ""
    passwort: str = ""


@router.post("/anmeldung/anmelden")
def anmelden(body: Zugang, request: Request, response: Response) -> dict:
    ursprung_pruefen(request)
    k, token = _ausfuehren(anmeldung.anmelden, body.email, body.passwort, ip_von(request))
    cookie_setzen(response, token)
    return k.oeffentlich()


@router.post("/anmeldung/registrieren")
def registrieren(body: Zugang, request: Request, response: Response) -> dict:
    ursprung_pruefen(request)
    k, token = _ausfuehren(anmeldung.registrieren, body.email, body.passwort, ip_von(request))
    cookie_setzen(response, token)
    return k.oeffentlich()


@router.post("/anmeldung/abmelden")
def abmelden(request: Request, response: Response) -> dict:
    ursprung_pruefen(request)
    anmeldung.sitzung_beenden(request.cookies.get(COOKIE))
    cookie_loeschen(response)
    return {"ok": True}


@router.get("/anmeldung/ich")
def ich(request: Request, response: Response) -> dict:
    """Eigenes Konto. Ohne gültige Sitzung 401 (und das Cookie wird gelöscht)."""
    token = request.cookies.get(COOKIE)
    treffer = anmeldung.sitzung_pruefen(token)
    if treffer is None:
        if token:
            raise HTTPException(status_code=401, detail=TEXTE["auth/unauthenticated"],
                                headers={"X-Anmeldung-Fehler": "auth/unauthenticated", "Set-Cookie": f"{COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=lax"})
        raise fehler("auth/unauthenticated", 401)
    response.headers["Cache-Control"] = "no-store"
    return treffer[0].oeffentlich()


@router.post("/anmeldung/passwort-pruefen")
def passwort_pruefen(body: Passwort, request: Request) -> dict:
    """Bisheriges Passwort bestätigen (vor „Passwort ändern“, wie reauthenticateWithCredential)"""
    ursprung_pruefen(request)
    k, _, token = eigene_sitzung(request)
    ip = ip_von(request)
    if anmeldung._zu_viele(f"mail:{k.email.lower()}", anmeldung.FEHLVERSUCHE_EMAIL):
        raise fehler("auth/too-many-requests", 429)
    if not anmeldung.passwort_stimmt(k.passwort, body.passwort):
        anmeldung._fehlversuch(k.email, ip)
        raise fehler("auth/invalid-credential")
    anmeldung.sitzung_bestaetigen(token)
    return {"ok": True}


@router.post("/anmeldung/passwort-aendern")
def passwort_aendern(body: Passwort, request: Request) -> dict:
    """Neues Passwort, nur kurz nach passwort-pruefen. Andere Geräte werden abgemeldet."""
    ursprung_pruefen(request)
    k, bestaetigt, token = eigene_sitzung(request)
    if not anmeldung.frisch_bestaetigt(bestaetigt):
        raise fehler("auth/requires-recent-login", 403)
    _ausfuehren(anmeldung.passwort_aendern, k, body.passwort, token)
    return {"ok": True}


@router.get("/anmeldung/passwort-neu")
def passwort_neu_pruefen(code: str = "") -> dict:
    """Gilt der Link aus der Passwort-Mail noch? Antwort: die Adresse (wie verifyPasswordResetCode)"""
    k = _ausfuehren(anmeldung.link_pruefen, code, "passwort")
    return {"email": k.email}


@router.post("/anmeldung/passwort-neu")
def passwort_neu(body: Code, request: Request) -> dict:
    """Neues Passwort über den Link aus der Mail. Meldet alle Geräte ab; danach meldet sich der Browser neu an."""
    ursprung_pruefen(request)
    _ausfuehren(anmeldung.passwort_pruefen, body.passwort)
    k = _ausfuehren(anmeldung.link_einloesen, body.code, "passwort", body.passwort)
    return {"email": k.email}


@router.post("/anmeldung/email-bestaetigen")
def email_bestaetigen(body: Code, request: Request) -> dict:
    """Adresse über den Link aus der Bestätigungs-Mail bestätigen (wie applyActionCode)"""
    ursprung_pruefen(request)
    k = _ausfuehren(anmeldung.link_einloesen, body.code, "bestaetigen")
    return {"email": k.email, "emailVerified": True}
