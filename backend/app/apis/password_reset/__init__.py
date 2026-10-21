"""Passwort vergessen: Dranzeit schickt die Mail selbst über Resend (app/libs/mail.py), von hallo@dranzeit.de und auf
Deutsch. Firebases eigene Mail kommt von noreply@…firebaseapp.com, ist englisch und landet bei Microsoft 365 und
anderen oft im Spam oder in der Quarantäne. Der Link führt auf /passwort-neu?code=…, dort setzt der Browser das neue
Passwort bei Firebase (confirmPasswordReset, frontend/src/pages/PasswortNeu.tsx).

Den Code erzeugt Firebase (Admin SDK, generate_password_reset_link), er gilt eine Stunde. In der Firebase-Konsole ist
dafür nichts einzustellen.

Wie bei Firebase verrät die Antwort nicht, ob es zur Adresse ein Konto gibt: Auch ohne Konto (oder bei gesperrtem
Konto) heißt es „verschickt“, nur geht keine Mail raus. Schutz vor Missbrauch (Mails an fremde Adressen): je Adresse
höchstens eine Anfrage pro Minute und fünf am Tag, je IP 20 am Tag. Keine Mails an Testadressen (example.com …).
Ohne Resend-Schlüssel kommt „nicht_eingerichtet“ zurück, dann verschickt der Browser Firebases eigene Mail.
"""

import hashlib
import re
import threading
import time
from collections import defaultdict, deque
from urllib.parse import parse_qs, quote, urlparse

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.apis.email_verification import _origin
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
    from firebase_admin import auth

    from app.apis.firebase_utils import get_firebase_app

    try:
        return auth.get_user_by_email(email, app=get_firebase_app())
    except auth.UserNotFoundError:
        return None


def _firebase_link(email: str) -> str:
    from firebase_admin import auth

    from app.apis.firebase_utils import get_firebase_app

    return auth.generate_password_reset_link(email, app=get_firebase_app())


def reset_link(firebase_link: str, origin: str) -> str:
    """Code aus Firebases Link (…/__/auth/action?mode=resetPassword&oobCode=…) in einen Link auf Dranzeit setzen"""
    code = (parse_qs(urlparse(firebase_link).query).get("oobCode") or [""])[0]
    if not code:
        raise ValueError("Firebase-Link ohne oobCode")
    return f"{origin}/passwort-neu?code={quote(code, safe='')}"


def reset_mail(email: str, link: str) -> tuple[str, str, str]:
    """Betreff, HTML und Text der Passwort-Mail"""
    subject = "Neues Passwort für Dranzeit"
    note = "Du hast kein neues Passwort angefordert? Dann kannst du diese E-Mail einfach löschen. Dein Passwort bleibt, wie es ist."
    html = branded_html(
        "Neues Passwort setzen",
        [
            f"Hallo, für dein Dranzeit-Konto <strong>{esc(email)}</strong> wurde ein neues Passwort angefordert.",
            "Tipp auf den Knopf und wähl ein neues Passwort. Der Link gilt eine Stunde.",
        ],
        button_text="Neues Passwort setzen",
        button_url=link,
        note=esc(note),
    )
    text = (
        f"Hallo, für dein Dranzeit-Konto {email} wurde ein neues Passwort angefordert.\n\n"
        "Öffne diesen Link und wähl ein neues Passwort (gilt eine Stunde):\n"
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


def mail_reset(address: str, origin: str) -> None:
    """Passwort-Mail an diese Konto-Adresse, ohne weitere Prüfung (auch für den Betreiber-Bereich).
    Wirft bei Fehlern von Firebase oder Resend."""
    subject, html, text = reset_mail(address, reset_link(_firebase_link(address), origin))
    send_mail(address, subject, html, text)


def send_reset(email: str, origin: str) -> bool:
    """Passwort-Mail an das Konto zur Adresse. False = kein Konto, gesperrt oder Testadresse (nichts verschickt)."""
    if is_test_address(email):
        return False
    record = _user(email)
    if record is None or record.disabled or not record.email:
        return False
    mail_reset(record.email, origin)
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
        send_reset(email, _origin(request))
    except Exception as e:  # MailError von Resend, Fehler von Firebase (z. B. TOO_MANY_ATTEMPTS_TRY_LATER)
        _release(keys, stamp)
        print(f"Passwort-Mail an {email} nicht verschickt: {e}")
        raise HTTPException(status_code=502, detail="Die E-Mail konnte gerade nicht verschickt werden. Versuch es später noch mal.")
    return {"status": "verschickt"}
