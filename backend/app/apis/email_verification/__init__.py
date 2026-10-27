"""E-Mail-Adresse bestätigen: Nach dem Registrieren mit E-Mail und Passwort (und auf Wunsch unter "Mein Profil")
schickt Dranzeit eine Mail mit dem Link /email-bestaetigen?code=…  Die Seite bestätigt die Adresse im Browser bei
Firebase (applyActionCode), danach ist email_verified am Konto gesetzt.

Den Code erzeugt Firebase (Admin SDK, generate_email_verification_link). Verschickt wird aber nicht Firebases eigene
Mail, sondern unsere über Resend (app/libs/mail.py), und der Link zeigt auf Dranzeit statt auf die englische
Firebase-Seite. In der Firebase-Konsole ist dafür nichts einzustellen.

Wozu: Eine bestätigte Adresse gehört nachweislich dem Konto. Erst dann verbindet /routes/customer-link einen
Kunden-Eintrag, den ein Laden mit derselben Adresse angelegt hat (customer_activation). Pflicht ist sie nirgends.

Schutz vor Missbrauch (Mails an eine fremde Adresse, die jemand beim Registrieren eingetippt hat): je Konto höchstens
eine Mail pro Minute und fünf am Tag. Keine Mails an Testadressen (example.com …).
"""

import os
import threading
import time
from collections import defaultdict, deque
from urllib.parse import parse_qs, quote, urlparse

from fastapi import APIRouter, HTTPException, Request

from app.auth import AuthorizedUser
from app.i18n import aus_anfrage, merke, t
from app.libs.mail import branded_html, esc, mail_configured, send_mail
from app.libs.onboarding_mail import is_test_address

router = APIRouter()

ALLOWED_ORIGINS = ("https://dranzeit.de", "https://www.dranzeit.de", "https://q-me.spielmacherei.de", "http://localhost:5173")
MIN_GAP_SECONDS = 60
PER_DAY = 5

_sent: dict = defaultdict(deque)
_lock = threading.Lock()


def _origin(request: Request) -> str:
    """Link auf die Adresse, von der die Person kam – nur bekannte Adressen."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin in ALLOWED_ORIGINS:
        return origin
    return (os.environ.get("PUBLIC_URL", "").strip() or "https://dranzeit.de").rstrip("/")


def _account(uid: str):
    """Konto so, wie Firebase es kennt – E-Mail und Bestätigung nicht aus dem Browser übernehmen"""
    from firebase_admin import auth

    from app.apis.firebase_utils import get_firebase_app

    return auth.get_user(uid, app=get_firebase_app())


def _firebase_link(email: str) -> str:
    from firebase_admin import auth

    from app.apis.firebase_utils import get_firebase_app

    return auth.generate_email_verification_link(email, app=get_firebase_app())


def verification_link(firebase_link: str, origin: str) -> str:
    """Code aus Firebases Link (…/__/auth/action?mode=verifyEmail&oobCode=…) in einen Link auf Dranzeit setzen"""
    code = (parse_qs(urlparse(firebase_link).query).get("oobCode") or [""])[0]
    if not code:
        raise ValueError("Firebase-Link ohne oobCode")
    return f"{origin}/email-bestaetigen?code={quote(code, safe='')}"


def verification_mail(email: str, link: str, sprache: str = "de") -> tuple[str, str, str]:
    """Betreff, HTML und Text der Bestätigungs-Mail, in der Sprache der Person (app/i18n)"""
    subject = t("Bitte bestätige deine E-Mail-Adresse", sprache)
    note = t("Du hast kein Konto bei Dranzeit angelegt? Dann hat sich jemand vertippt. Du kannst diese E-Mail einfach löschen.", sprache)
    html = branded_html(
        esc(t("Ist das deine E-Mail-Adresse?", sprache)),
        [
            t("Hallo, du hast bei Dranzeit ein Konto mit der Adresse <strong>{email}</strong> angelegt.", sprache, email=esc(email)),
            esc(t("Tipp auf den Knopf, dann ist sie bestätigt. So wissen wir, dass die Adresse wirklich dir gehört.", sprache)),
        ],
        button_text=t("E-Mail-Adresse bestätigen", sprache),
        button_url=link,
        note=esc(note),
        sprache=sprache,
    )
    text = (
        t("Hallo, du hast bei Dranzeit ein Konto mit der Adresse {email} angelegt.", sprache, email=email) + "\n\n"
        + t("Öffne diesen Link, dann ist sie bestätigt:", sprache) + "\n"
        f"{link}\n\n"
        f"{note}\n"
    )
    return subject, html, text


def _reserve(uid: str, now: float) -> None:
    """Platz für eine Mail an dieses Konto belegen oder mit 429 ablehnen"""
    with _lock:
        sent = _sent[uid]
        while sent and now - sent[0] > 86400:
            sent.popleft()
        if sent and now - sent[-1] < MIN_GAP_SECONDS:
            raise HTTPException(status_code=429, detail="Wir haben dir gerade erst eine E-Mail geschickt. Warte eine Minute, dann geht es noch mal.")
        if len(sent) >= PER_DAY:
            raise HTTPException(status_code=429, detail=merke("Heute haben wir dir schon {n} E-Mails geschickt. Versuch es morgen noch mal.", n=PER_DAY))
        sent.append(now)


def _release(uid: str, stamp: float) -> None:
    """Mail ging nicht raus: zählt nicht"""
    with _lock:
        try:
            _sent[uid].remove(stamp)
        except ValueError:
            pass


@router.post("/email-verification")
def send_verification(request: Request, user: AuthorizedUser) -> dict:
    """Bestätigungs-Mail an die Adresse des eigenen Kontos.

    status: verschickt | bestaetigt (schon bestätigt, nichts verschickt) | testadresse | nicht_eingerichtet (kein Resend-Schlüssel)
    """
    record = _account(user.sub)
    email = (record.email or "").strip()
    if record.email_verified:
        return {"status": "bestaetigt", "email": email}
    if not email:
        raise HTTPException(status_code=400, detail="Zu deinem Konto gibt es keine E-Mail-Adresse.")
    if is_test_address(email):
        return {"status": "testadresse", "email": email}
    if not mail_configured():
        print(f"Bestätigungs-Mail an {email} nicht verschickt: RESEND_API_KEY fehlt")
        return {"status": "nicht_eingerichtet", "email": email}

    stamp = time.time()
    _reserve(user.sub, stamp)
    try:
        link = verification_link(_firebase_link(email), _origin(request))
        subject, html, text = verification_mail(email, link, aus_anfrage(request))
        send_mail(email, subject, html, text)
    except Exception as e:  # MailError von Resend, Fehler von Firebase (z. B. TOO_MANY_ATTEMPTS_TRY_LATER)
        _release(user.sub, stamp)
        print(f"Bestätigungs-Mail an {email} nicht verschickt: {e}")
        raise HTTPException(status_code=502, detail="Die E-Mail konnte gerade nicht verschickt werden. Versuch es später noch mal.")
    return {"status": "verschickt", "email": email}
