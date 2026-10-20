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


def branded_html(heading: str, paragraphs: list[str], button_text: str = "", button_url: str = "", note: str = "") -> str:
    """E-Mail im Dranzeit-Design. `heading` und `paragraphs` müssen schon entschärft sein (esc)."""
    body = "".join(f'<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#141414">{p}</p>' for p in paragraphs)
    button = ""
    if button_text and button_url:
        button = (
            f'<p style="margin:24px 0"><a href="{esc(button_url)}" '
            'style="display:inline-block;background:#ffc83d;color:#141414;font-weight:700;font-size:16px;'
            f'text-decoration:none;padding:13px 22px;border-radius:12px">{esc(button_text)}</a></p>'
            f'<p style="margin:0 0 14px;font-size:13px;color:#5a5a52;word-break:break-all">Oder diesen Link öffnen: {esc(button_url)}</p>'
        )
    foot = f'<p style="margin:16px 0 0;font-size:12px;color:#5a5a52">{note}</p>' if note else ""
    return (
        '<div style="background:#eeede7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">'
        '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">'
        '<div style="background:#141414;padding:18px 24px">'
        '<span style="display:inline-block;background:#ffc83d;color:#141414;font-weight:800;font-size:13px;'
        'padding:4px 7px;border-radius:6px;margin-right:8px">▭</span>'
        '<span style="color:#ffffff;font-weight:800;font-size:20px;letter-spacing:-0.5px">Dranzeit</span></div>'
        f'<div style="padding:24px"><h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#141414">{heading}</h1>'
        f"{body}{button}{foot}</div></div>"
        '<p style="max-width:560px;margin:12px auto 0;font-size:12px;color:#5a5a52;text-align:center">'
        "Dranzeit · ITEBV GmbH · Diese E-Mail wurde automatisch verschickt.</p></div>"
    )
