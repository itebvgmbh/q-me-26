"""E-Mail-Versand über Resend (https://resend.com/docs/api-reference/emails/send-email).

Einstellungen in /etc/q-me.env:
    RESEND_API_KEY=...                        Schlüssel aus dem Resend-Konto (setzt Stefan selbst, deploy/README.md)
    MAIL_FROM=Dranzeit <hallo@dranzeit.de>    Absender; die Domain muss bei Resend bestätigt sein
    MAIL_REPLY_TO=...                         optional, Adresse für Antworten

Ohne Schlüssel wird nichts verschickt, sondern nur ins Log geschrieben – so laufen
Entwicklung und Tests ohne Konto.
"""

import html
import os

import requests

RESEND_URL = "https://api.resend.com/emails"
DEFAULT_FROM = "Dranzeit <hallo@dranzeit.de>"


class MailError(RuntimeError):
    pass


def mail_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY", "").strip())


def send_mail(to: str, subject: str, html_body: str, text_body: str = "", reply_to: str = "") -> bool:
    """Schickt eine E-Mail. True = verschickt, False = kein Schlüssel gesetzt (nur geloggt).
    reply_to: Antwortadresse für diese Mail, sonst MAIL_REPLY_TO."""
    key = os.environ.get("RESEND_API_KEY", "").strip()
    if not key:
        print(f"E-Mail nicht verschickt, RESEND_API_KEY fehlt: an {to}, Betreff „{subject}“")
        return False
    payload = {
        "from": os.environ.get("MAIL_FROM", "").strip() or DEFAULT_FROM,
        "to": [to],
        "subject": subject,
        "html": html_body,
    }
    if text_body:
        payload["text"] = text_body
    reply_to = reply_to or os.environ.get("MAIL_REPLY_TO", "").strip()
    if reply_to:
        payload["reply_to"] = reply_to
    try:
        resp = requests.post(RESEND_URL, json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=15)
    except requests.RequestException as e:
        raise MailError(f"Resend nicht erreichbar: {e}") from e
    if resp.status_code >= 300:
        # Häufigster Grund: Absender-Domain bei Resend noch nicht bestätigt
        raise MailError(f"Resend lehnt ab ({resp.status_code}): {resp.text[:300]}")
    return True


def esc(value: object) -> str:
    """Nutzereingaben (Ladenname, Kundenname) vor dem Einsetzen ins HTML entschärfen."""
    return html.escape(str(value or ""), quote=True)


def public_url() -> str:
    return (os.environ.get("PUBLIC_URL", "").strip() or "https://dranzeit.de").rstrip("/")


# Logo im Kopf: Wartemarke + Schriftzug, weiß auf durchsichtig, dreifach aufgelöst (erzeugt mit dev/mail-logo.cjs)
LOGO_PATH = "/img/mail/logo.png"
LOGO_SIZE = (140, 30)

INK = "#141414"
SIGNAL = "#ffc83d"
MUTED = "#5a5a52"
PAPER = "#eeede7"
FONT = "Arial,Helvetica,sans-serif"


def branded_html(heading: str, paragraphs: list[str], button_text: str = "", button_url: str = "", note: str = "") -> str:
    """E-Mail im Dranzeit-Design. `heading` und `paragraphs` müssen schon entschärft sein (esc).

    Aus Tabellen gebaut, weil Outlook (Word als Darstellung) weder max-width noch Abstände an Links kennt. Ist das Logo
    blockiert (Outlook lädt Bilder erst auf Klick), steht an seiner Stelle „Dranzeit“ in Weiß."""
    base = public_url()
    text = f"font-family:{FONT};color:{INK}"
    body = "".join(f'<p style="margin:0 0 14px;font-size:16px;line-height:1.55;{text}">{p}</p>' for p in paragraphs)
    button = ""
    if button_text and button_url:
        url = esc(button_url)
        button = (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 18px"><tr>'
            f'<td bgcolor="{SIGNAL}" style="border-radius:12px;mso-padding-alt:13px 22px">'
            f'<a href="{url}" style="display:inline-block;padding:13px 22px;border-radius:12px;font-family:{FONT};'
            f'font-size:16px;font-weight:bold;color:{INK};text-decoration:none">{esc(button_text)}</a></td></tr></table>'
            f'<p style="margin:0 0 14px;font-family:{FONT};font-size:13px;line-height:1.5;color:{MUTED};word-break:break-all">'
            f'Klappt der Knopf nicht? Dann öffne diesen Link: <a href="{url}" style="color:{MUTED}">{url}</a></p>'
        )
    foot = (
        f'<p style="margin:18px 0 0;padding-top:16px;border-top:1px solid {PAPER};font-family:{FONT};font-size:13px;'
        f'line-height:1.5;color:{MUTED}">{note}</p>'
        if note
        else ""
    )
    width, height = LOGO_SIZE
    return (
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'
        f"<title>{heading}</title></head>"
        f'<body style="margin:0;padding:0;background:{PAPER}">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{PAPER}" style="background:{PAPER}">'
        '<tr><td align="center" style="padding:24px 12px">'
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" '
        'style="width:100%;max-width:560px;background:#ffffff;border-radius:16px">'
        f'<tr><td bgcolor="{INK}" style="background:{INK};padding:20px 24px;border-radius:16px 16px 0 0">'
        f'<a href="{base}" style="text-decoration:none"><img src="{base}{LOGO_PATH}" width="{width}" height="{height}" '
        f'alt="Dranzeit" style="display:block;border:0;outline:none;font-family:{FONT};font-size:22px;font-weight:bold;'
        'color:#ffffff"></a></td></tr>'
        '<tr><td style="padding:28px 24px 24px">'
        f'<h1 style="margin:0 0 16px;font-size:23px;line-height:1.25;font-weight:bold;{text}">{heading}</h1>'
        f"{body}{button}{foot}</td></tr></table>"
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">'
        f'<tr><td align="center" style="padding:14px 24px 0;font-family:{FONT};font-size:12px;line-height:1.6;color:{MUTED}">'
        f'<a href="{base}" style="color:{MUTED};text-decoration:none;font-weight:bold">Dranzeit</a> · ITEBV GmbH · '
        f'<a href="{base}/impressum" style="color:{MUTED}">Impressum</a><br>Diese E-Mail wurde automatisch verschickt.'
        "</td></tr></table></td></tr></table></body></html>"
    )
