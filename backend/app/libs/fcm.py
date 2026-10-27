"""Benachrichtigungen an die Dranzeit-App (iPhone/iPad) über Firebase Cloud Messaging.

In der App gibt es keinen Web-Push (WKWebView). Die App (mobile/) holt sich deshalb ein FCM-Token und meldet es an
wie eine Web-Push-Anmeldung: app/apis/push (/push/subscribe-app), Sammlung push_subscriptions mit Feld token statt
endpoint. Firebase stellt über APNs zu – dafür braucht das Firebase-Projekt den APNs-Schlüssel von Apple
(mobile/README.md). Zugang: dasselbe Dienstkonto wie Firestore (app/apis/firebase_utils), kein eigener Schlüssel.
"""

import os
import time

from firebase_admin import messaging

# So lange darf eine Nachricht unterwegs sein; danach ist "Gleich bist du dran" überholt (wie ttl beim Web-Push)
TTL_SECONDS = 900


class TokenGone(Exception):
    """Die App ist gelöscht oder das Token gilt nicht mehr."""


def fcm_configured() -> bool:
    """Wie Firestore: Ohne Dienstkonto (z. B. in den Tests) gibt es keinen Kanal zur App."""
    return bool(os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY", "").strip() or os.environ.get("FIREBASE_SERVICE_ACCOUNT_KEY_FILE", "").strip())


def build_message(token: str, title: str, body: str, url: str, tag: str) -> messaging.Message:
    """url und tag wie beim Web-Push (frontend/public/sw.js): url öffnet die App beim Antippen
    (frontend/src/utils/native-app.ts), tag ersetzt eine ältere Nachricht zur selben Nummer."""
    return messaging.Message(
        token=token,
        notification=messaging.Notification(title=title, body=body),
        data={"url": url, "tag": tag},
        apns=messaging.APNSConfig(
            headers={
                "apns-priority": "10",
                "apns-expiration": str(int(time.time()) + TTL_SECONDS),
                "apns-collapse-id": tag[:64],
            },
            payload=messaging.APNSPayload(aps=messaging.Aps(sound="default", thread_id=tag)),
        ),
        android=messaging.AndroidConfig(priority="high", ttl=TTL_SECONDS, collapse_key=tag),
    )


def send_app_push(token: str, title: str, body: str, url: str, tag: str) -> None:
    from app.apis.firebase_utils import get_firebase_app

    try:
        messaging.send(build_message(token, title, body, url, tag), app=get_firebase_app())
    except (messaging.UnregisteredError, messaging.SenderIdMismatchError) as e:
        raise TokenGone() from e
