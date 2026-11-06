"""Benachrichtigungen an die Dranzeit-App (iPhone/iPad).

In der App gibt es keinen Web-Push (WKWebView). Bis Stufe 5 (requirements/eigene-datenbank.md) holte sich die App
(mobile/) ein Token von Firebase Cloud Messaging und meldete es an wie eine Web-Push-Anmeldung (app/apis/push,
/push/subscribe-app, Sammlung push_subscriptions mit Feld token statt endpoint). Firebase ist ausgebaut; die App bekommt
ihre Nachrichten künftig direkt von Apple (APNs). Dafür braucht es den APNs-Schlüssel aus dem Apple-Entwicklerkonto
(mobile/README.md). Bis dahin ist der Kanal aus: fcm_configured() ist False, die Seiten bieten Push in der App nicht an,
und Erinnerungen gehen per E-Mail und Web-Push. Der Name der Datei bleibt, damit Aufrufer und Tests gleich bleiben.
"""


class TokenGone(Exception):
    """Die App ist gelöscht oder das Token gilt nicht mehr."""


def fcm_configured() -> bool:
    """Gibt es einen Kanal zur App? Bis zum Anschluss an APNs nein."""
    return False


def send_app_push(token: str, title: str, body: str, url: str, tag: str) -> None:
    raise RuntimeError("Push an die App ist noch nicht an APNs angeschlossen (app/libs/fcm.py)")
