"""E-Mails zum Start eines Ladens: Willkommen, eine Erinnerung zum Ausprobieren, Testphase endet bald.

Vorbild sind die Start-Mails von Calendly und Shopify: wenige, kurze Mails mit genau einem nächsten Schritt.
Jede Mail geht pro Laden nur einmal raus; was verschickt ist, steht am Laden (onboardingMails.<art>).

- "willkommen": in den ersten 2 Tagen nach dem Anlegen des Ladens
- "erinnerung": 2 bis 7 Tage nach dem Anlegen, wenn noch nie eine Nummer oder ein Termin eingetragen wurde
- "testende":   in den letzten 5 Tagen der Testphase, wenn kein Abo läuft

Der Benachrichtigungsdienst (notify_worker.py) ruft run_once höchstens alle SWEEP_MINUTES auf. Die Regeln
(due_mails) und Texte (compose) kommen ohne Datenbank aus und sind in tests/test_onboarding_mail.py getestet.
Ohne RESEND_API_KEY wird nichts verschickt und nichts als verschickt markiert.
"""

import html
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.libs.mail import MailError, branded_html, esc, mail_configured, send_mail
from app.libs.plans import ACTIVE_BILLING, PAID_PLANS, PLANS, trial_end

BERLIN = ZoneInfo("Europe/Berlin")
SWEEP_MINUTES = 15
KONTAKT = "hilfe@dranzeit.de"
WELCOME_DAYS = 2
REMINDER_FROM_DAYS = 2
REMINDER_UNTIL_DAYS = 7
TRIAL_WARN_DAYS = 5
# Reservierte Test-Domains (RFC 2606) – Testläden aus dev/fixtures.py und den Oberflächentests
TEST_DOMAINS = ("example.com", "example.org", "example.net")
TEST_SUFFIXES = (".test", ".example", ".invalid", ".localhost")


def _aware(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def is_test_address(email: str) -> bool:
    domain = (email or "").rsplit("@", 1)[-1].strip().lower()
    return not domain or domain in TEST_DOMAINS or domain.endswith(TEST_SUFFIXES)


def has_paid_plan(shop: dict) -> bool:
    billing = shop.get("billing") or {}
    return billing.get("plan") in PAID_PLANS and billing.get("status") in ACTIVE_BILLING


def due_mails(shop: dict, now: datetime, has_entries: bool) -> list[str]:
    """Welche Start-Mails sind für diesen Laden jetzt fällig? has_entries: je eine Nummer oder ein Termin."""
    sent = shop.get("onboardingMails") or {}
    due: list[str] = []
    created = _aware(shop.get("createdAt"))
    if created:
        age = now - created
        if "willkommen" not in sent and timedelta(0) <= age <= timedelta(days=WELCOME_DAYS):
            due.append("willkommen")
        if (
            "erinnerung" not in sent
            and not has_entries
            and timedelta(days=REMINDER_FROM_DAYS) <= age <= timedelta(days=REMINDER_UNTIL_DAYS)
        ):
            due.append("erinnerung")
    if "testende" not in sent and not has_paid_plan(shop):
        left = trial_end(shop) - now
        if timedelta(0) < left <= timedelta(days=TRIAL_WARN_DAYS):
            due.append("testende")
    return due


def _date(value: datetime) -> str:
    return value.astimezone(BERLIN).strftime("%d.%m.%Y")


def compose(kind: str, shop: dict, now: datetime, base_url: str) -> tuple[str, str, str]:
    """Betreff, HTML und Text einer Start-Mail, du-Form wie in der App."""
    name = shop.get("name") or "Dein Laden"
    end = trial_end(shop)
    founder = bool(shop.get("founder"))
    note = (
        f'Fragen? Antworte einfach auf diese E-Mail oder schreib an <a href="mailto:{KONTAKT}">{KONTAKT}</a>. '
        f'Anleitungen findest du unter <a href="{esc(base_url)}/hilfe">{esc(base_url)}/hilfe</a>.'
    )
    if kind == "willkommen":
        days = max(1, round((end - now) / timedelta(days=1)))
        trial = (
            f"Als Gründer kannst du bis zum {_date(end)} alles kostenlos nutzen."
            if founder
            else f"Die nächsten {days} Tage kannst du alles kostenlos nutzen, ohne Zahlungsdaten."
        )
        subject = f"Willkommen bei Dranzeit – {name} ist startklar"
        paragraphs = [
            f"{esc(name)} ist eingerichtet. Ab jetzt ziehen deine Kunden per QR-Code eine Nummer und warten, wo sie wollen.",
            "Drei Dinge, dann läuft es:",
            "<strong>1. Einmal selbst ausprobieren:</strong> Mit dem Handy den QR-Code am Tresen scannen, eine Nummer ziehen "
            "und am Tresen aufrufen. Auf dem Handy erscheint „Du bist dran“.",
            "<strong>2. QR-Plakat aufhängen:</strong> Am Tresen unter „…“ → „QR-Plakat drucken“, dann an Tür oder Tresen.",
            "<strong>3. Team einladen:</strong> Arbeitest du nicht allein, schick jeder Person ihren Einladungslink (unter „Team“).",
            esc(trial),
        ]
        button = ("Zum Tresen", f"{base_url}/shop-dashboard")
        heading = "Schön, dass du da bist."
    elif kind == "erinnerung":
        subject = "In zwei Minuten ausprobiert: deine erste Nummer"
        heading = "Schon ausprobiert?"
        paragraphs = [
            f"Bei {esc(name)} wurde noch keine Nummer gezogen. Am schnellsten siehst du, wie Dranzeit funktioniert, wenn du es einmal selbst machst:",
            "Scann mit deinem Handy den QR-Code am Tresen, zieh eine Nummer und tipp am Tresen auf „Nächste Nummer aufrufen“. "
            "Auf dem Handy steht dann „Du bist dran“. Das dauert zwei Minuten.",
            "Hängt es irgendwo, zum Beispiel bei Öffnungszeiten oder Leistungen? Antworte auf diese E-Mail, wir helfen dir.",
        ]
        button = ("Zum Tresen", f"{base_url}/shop-dashboard")
        note = "Diese Erinnerung bekommst du nur einmal. " + note
    elif kind == "testende":
        left = max(1, round((end - now) / timedelta(days=1)))
        gratis = PLANS["gratis"]
        subject = f"Deine Testphase endet am {_date(end)}"
        heading = f"Noch {left} {'Tag' if left == 1 else 'Tage'} alles testen"
        if founder:
            after = (
                "Als Gründer bekommst du danach den Laden-Tarif dauerhaft für 19 € im Monat (netto). "
                "Wähl dafür unter „Mein Tarif“ das Abo. Ohne Abo läuft dein Laden im Gratis-Tarif weiter."
            )
        else:
            after = (
                f"Danach läuft dein Laden automatisch im Gratis-Tarif weiter: {gratis['max_staff']} Person, bis "
                f"{gratis['max_customers_per_month']} Kunden im Monat, Nummer ziehen per QR-Code. Online-Termine, Benachrichtigungen, "
                "Team, Wartezimmer-Bildschirm und Auswertung gibt es dann mit einem Abo."
            )
        paragraphs = [
            f"Am {_date(end)} endet die Testphase von {esc(name)}.",
            esc(after),
            "Reicht dir Gratis, musst du nichts tun. Ohne Abo entstehen keine Kosten.",
        ]
        button = ("Tarife ansehen", f"{base_url}/tarif")
    else:
        raise ValueError(kind)
    html_body = branded_html(esc(heading), paragraphs, button[0], button[1], note)
    text = "\n\n".join([heading, *[_plain(p) for p in paragraphs], f"{button[0]}: {button[1]}", f"Fragen? {KONTAKT}"])
    return subject, html_body, text


def _plain(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment))


# ---------- mit Datenbank ----------

def _owner_email(shop: dict) -> str:
    try:
        from firebase_admin import auth

        return auth.get_user(shop["owner"]).email or ""
    except Exception:
        return shop.get("email") or ""


def _has_entries(db, shop_id: str) -> bool:
    return any(True for _ in db.collection("appointments").where("shopId", "==", shop_id).limit(1).stream())


def run_once(db, base_url: str, now: datetime | None = None) -> int:
    """Fällige Start-Mails verschicken. Gibt die Zahl der verschickten Mails zurück."""
    if not mail_configured():
        return 0
    now = now or datetime.now(timezone.utc)
    docs = [(d, d.to_dict() or {}) for d in db.collection("shops").stream()]
    # Wer schon einen Laden hat, bekommt für den zweiten kein "Willkommen" und keine Erinnerung
    first_shop: dict[str, datetime] = {}
    for _, shop in docs:
        created = _aware(shop.get("createdAt"))
        owner = shop.get("owner")
        if owner and created and (owner not in first_shop or created < first_shop[owner]):
            first_shop[owner] = created
    sent = 0
    for doc, shop in docs:
        if not shop.get("owner"):
            continue
        created = _aware(shop.get("createdAt"))
        recent = created is not None and now - created <= timedelta(days=REMINDER_UNTIL_DAYS)
        kinds = due_mails(shop, now, has_entries=_has_entries(db, doc.id) if recent else True)
        if created and first_shop.get(shop["owner"], created) < created:
            kinds = [k for k in kinds if k == "testende"]
        if not kinds:
            continue
        to = _owner_email(shop)
        if is_test_address(to):
            continue
        for kind in kinds:
            subject, html_body, text = compose(kind, shop, now, base_url)
            try:
                if send_mail(to, subject, html_body, text, reply_to=KONTAKT):
                    doc.reference.update({f"onboardingMails.{kind}": now})
                    sent += 1
            except MailError as e:
                print(f"Start-Mail {kind} an Laden {doc.id} nicht verschickt: {e}")
    return sent
