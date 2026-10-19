"""Benachrichtigungen im Browser (Web-Push mit VAPID).

Die Schlüssel erzeugt deploy/update.sh einmalig auf dem Server und schreibt sie nach /etc/q-me.env:
    VAPID_PUBLIC_KEY=...   (öffentlich, geht an den Browser)
    VAPID_PRIVATE_KEY=...  (geheim, verlässt den Server nie)
    VAPID_SUBJECT=...      optional, Kontakt für die Push-Dienste (Standard https://dranzeit.de)
Ohne Schlüssel bietet die App keine Benachrichtigung an.
"""

import json
import os

from pywebpush import WebPushException, webpush


class SubscriptionGone(Exception):
    """Der Browser hat die Benachrichtigung abbestellt oder die Adresse gilt nicht mehr."""


def public_key() -> str:
    return os.environ.get("VAPID_PUBLIC_KEY", "").strip()


def push_configured() -> bool:
    return bool(public_key() and os.environ.get("VAPID_PRIVATE_KEY", "").strip())


def send_push(subscription: dict, title: str, body: str, url: str, tag: str) -> None:
    """subscription: {"endpoint": ..., "keys": {"p256dh": ..., "auth": ...}}"""
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    try:
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=os.environ["VAPID_PRIVATE_KEY"].strip(),
            vapid_claims={"sub": os.environ.get("VAPID_SUBJECT", "").strip() or "https://dranzeit.de"},
            ttl=900,
            headers={"Urgency": "high"},
            timeout=10,
        )
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            raise SubscriptionGone() from e
        raise
