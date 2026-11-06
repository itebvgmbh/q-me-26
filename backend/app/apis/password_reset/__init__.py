"""Passwort vergessen: Dranzeit schickt die Mail selbst über Resend (app/libs/mail.py), von hallo@dranzeit.de und auf
in der Sprache der Anfrage (Accept-Language, app/i18n). Der Link führt auf /passwort-neu?code=…, dort setzt der Browser
das neue Passwort (POST /routes/anmeldung/passwort-neu, frontend/src/pages/PasswortNeu.tsx).

Den Code erzeugt app/libs/anmeldung.py (Einmal-Link, nur als Hash gespeichert), er gilt eine Stunde.

Wie bei Firebase verrät die Antwort nicht, ob es zur Adresse ein Konto gibt: Auch ohne Konto (oder bei gesperrtem
Konto) heißt es „verschickt“, nur geht keine Mail raus. Schutz vor Missbrauch (Mails an fremde Adressen): je Adresse
höchstens eine Anfrage pro Minute und fünf am Tag, je IP 20 am Tag. Keine Mails an Testadressen (example.com …).
Ohne Resend-Schlüssel kommt „nicht_eingerichtet“ zurück, dann geht keine Mail raus.
"""

import hashlib
import re
import threading
import time
from collections import defaultdict, deque
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.apis.email_verification import _origin
from app.i18n import aus_anfrage, t
from app.libs.mail import branded_html, esc, mail_configured, send_mail
from app.libs.onboarding_mail import is_test_address

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_GAP_SECONDS = 60
PER_DAY = 5
PER_IP_DAY = 20

_requests: dict = defaultdict(deque)  # Schlüssel: "mail:<adresse>" bzw. "ip:<Hash>", Werte: Zeitpunkte
_lock = threading.Lock()


class ResetRequest(BaseModel):
    email: str


def _ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def _user(email: str):
    """Konto zur Adresse oder None (kein Konto)"""
    from app.libs import konto_auth as auth

    try:
        return auth.get_user_by_email(email)
    except auth.UserNotFoundError:
        return None


def _link_code(email: str) -> str:
    """Neuer Code für den Passwort-Link des Kontos zu dieser Adresse"""
    from app.libs import anmeldung

    konto = anmeldung.konto_per_email(email)
    if konto is None:
        raise ValueError("Kein Konto zu dieser Adresse")
    return anmeldung.link_anlegen(konto, "passwort")


def reset_link(code: str, origin: str) -> str:
    """Link auf Dranzeit mit dem Code"""
    if not code:
        raise ValueError("Link ohne Code")
    return f"{origin}/passwort-neu?code={quote(code, safe='')}"


def reset_mail(email: str, link: str, sprache: str = "de") -> tuple[str, str, str]:
    """Betreff, HTML und Text der Passwort-Mail, in der Sprache der Person (app/i18n)"""
    subject = t("Neues Passwort für Dranzeit", sprache)
    note = t("Du hast kein neues Passwort angefordert? Dann kannst du diese E-Mail einfach löschen. Dein Passwort bleibt, wie es ist.", sprache)
    html = branded_html(
        esc(t("Neues Passwort setzen", sprache)),
        [
            t("Hallo, für dein Dranzeit-Konto <strong>{email}</strong> wurde ein neues Passwort angefordert.", sprache, email=esc(email)),
            esc(t("Tipp auf den Knopf und wähl ein neues Passwort. Der Link gilt eine Stunde.", sprache)),
        ],
        button_text=t("Neues Passwort setzen", sprache),
        button_url=link,
        note=esc(note),
        sprache=sprache,
    )
    text = (
        t("Hallo, für dein Dranzeit-Konto {email} wurde ein neues Passwort angefordert.", sprache, email=email) + "\n\n"
        + t("Öffne diesen Link und wähl ein neues Passwort (gilt eine Stunde):", sprache) + "\n"
        f"{link}\n\n"
        f"{note}\n"
    )
    return subject, html, text


def _reserve(keys: list[tuple[str, int, int]], now: float) -> None:
    """Je Schlüssel (Name, Mindestabstand, Höchstzahl am Tag) einen Platz belegen oder mit 429 ablehnen"""
    with _lock:
        for key, gap, per_day in keys:
            stamps = _requests[key]
            while stamps and now - stamps[0] > 86400:
                stamps.popleft()
            if gap and stamps and now - stamps[-1] < gap:
                raise HTTPException(status_code=429, detail="Wir haben gerade erst eine E-Mail an diese Adresse geschickt. Warte eine Minute, dann geht es noch mal.")
            if len(stamps) >= per_day:
                raise HTTPException(status_code=429, detail="Heute ging schon zu oft eine E-Mail raus. Versuch es morgen noch mal.")
        for key, _, _ in keys:
            _requests[key].append(now)


def _release(keys: list[tuple[str, int, int]], stamp: float) -> None:
    """Mail ging nicht raus: zählt nicht"""
    with _lock:
        for key, _, _ in keys:
            try:
                _requests[key].remove(stamp)
            except ValueError:
                pass


def mail_reset(address: str, origin: str, sprache: str = "de") -> None:
    """Passwort-Mail an diese Konto-Adresse, ohne weitere Prüfung (auch für den Betreiber-Bereich).
    Wirft bei Fehlern der Datenbank oder von Resend."""
    subject, html, text = reset_mail(address, reset_link(_link_code(address), origin), sprache)
    send_mail(address, subject, html, text)


def send_reset(email: str, origin: str, sprache: str = "de") -> bool:
    """Passwort-Mail an das Konto zur Adresse. False = kein Konto, gesperrt oder Testadresse (nichts verschickt)."""
    if is_test_address(email):
        return False
    record = _user(email)
    if record is None or record.disabled or not record.email:
        return False
    mail_reset(record.email, origin, sprache)
    return True


@router.post("/password-reset")
def request_reset(body: ResetRequest, request: Request) -> dict:
    """Passwort-Mail anfordern (ohne Anmeldung, von „Passwort vergessen?“).

    status: verschickt (auch ohne Konto, siehe oben) | nicht_eingerichtet (kein Resend-Schlüssel)
    """
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(status_code=400, detail="Diese E-Mail-Adresse sieht nicht richtig aus.")
    if not mail_configured():
        print("Passwort-Mail nicht über Resend verschickt: RESEND_API_KEY fehlt")
        return {"status": "nicht_eingerichtet"}

    keys = [(f"mail:{email}", MIN_GAP_SECONDS, PER_DAY), (f"ip:{_ip(request)}", 0, PER_IP_DAY)]
    stamp = time.time()
    _reserve(keys, stamp)
    try:
        send_reset(email, _origin(request), aus_anfrage(request))
    except Exception as e:  # MailError von Resend, Datenbank nicht erreichbar
        _release(keys, stamp)
        print(f"Passwort-Mail an {email} nicht verschickt: {e}")
        raise HTTPException(status_code=502, detail="Die E-Mail konnte gerade nicht verschickt werden. Versuch es später noch mal.")
    return {"status": "verschickt"}
