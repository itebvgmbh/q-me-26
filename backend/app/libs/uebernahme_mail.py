"""Verzeichnis: Übernahme ohne Brief – der Salon zeigt per E-Mail, dass es seiner ist. Derselbe Nachweis wie beim Entfernen.

Öffentlich, ohne Konto (app/apis/verzeichnis). Das Formular auf /uebernehmen allein ändert nichts am Eintrag:
  1. Anfrage mit einer E-Mail-Adresse. Sie passt wie beim Entfernen (app/libs/entfernen.py, adresse_passt). Dann geht ein Link an
     sie, darin ein Code wie im Brief (app/libs/uebernahme.py).
  2. Der Link führt zu /uebernehmen#code=…, ab da läuft alles wie mit dem Brief. Ihn aufzurufen ändert nichts (Mail-Programme tun
     das von selbst). Verbunden wird erst, wenn damit ein Laden eingerichtet ist.
Passt die Adresse nicht, ändert sich nichts und der Betreiber prüft von Hand. Er bekommt zu jeder Anfrage und jeder Übernahme eine
Mail. Geprüft wird im Hintergrund, die Antwort aufs Formular kommt sofort und nennt das Ergebnis nicht.
"""

from typing import Optional

from app.libs import entfernen as ent
from app.libs import uebernahme as ue
from app.libs import verzeichnis as vz

# Warum die Anfrage so ausging: Überschrift und Absatz der Mail an den Betreiber
ERGEBNISSE = {
    "link": ("Link verschickt", "Die Adresse gehört zum Salon, der Link ist unterwegs. Verbunden wird erst, wenn damit ein Laden eingerichtet ist. Du musst nichts tun."),
    "passt_nicht": ("Adresse passt nicht", "Die Adresse gehört nicht erkennbar zum Salon, es ging kein Link raus. An der Seite ändert sich nichts. Stimmt die Anfrage nach deiner Prüfung, erzeugst du im Betreiber-Bereich einen Code und schickst ihn."),
    "keine_webseite": ("Von Hand prüfen", "Der Eintrag hat keine eigene Webseite, darum lässt sich die Adresse nicht prüfen. An der Seite ändert sich nichts. Stimmt die Anfrage nach deiner Prüfung, erzeugst du im Betreiber-Bereich einen Code und schickst ihn."),
    "gebremst": ("Schon ein Link unterwegs", "Die Adresse passt, aber für diesen Eintrag ging vor Kurzem schon ein Link raus (oder die Obergrenze des Tages ist erreicht). Es ging kein neuer raus."),
    "nicht_verschickt": ("Link nicht verschickt", "Die Adresse passt, aber die Mail mit dem Link ging nicht raus. An der Seite ändert sich nichts. Stimmt die Anfrage, erzeugst du im Betreiber-Bereich einen Code und schickst ihn."),
}


def link_schicken(entry: dict, email: str, st=None, now=None) -> bool:
    """Link mit Code an die Adresse. Der Text ist fest und wirbt nicht: Jeder kann ihn an eine öffentliche Salon-Adresse auslösen.
    False = keine Mail rausgegangen."""
    from app.libs.mail import MailError, branded_html, esc, public_url, send_mail

    url = ue.link(public_url(), ue.mail_code_erzeugen(entry, st, now))
    salon = " · ".join(x for x in (entry.get("name"), ent._anschrift(entry)) if x)
    absaetze = [
        f"Jemand möchte auf dranzeit.de die Seite von <strong>{esc(salon)}</strong> aus unserem Salon-Verzeichnis übernehmen.",
        f"Warst du das? Dann geht es mit dem Knopf weiter. Der Link gilt {ue.MAIL_GUELTIG_TAGE} Tage und ist nur für dich, gib ihn bitte nicht weiter.",
    ]
    hinweis = "Warst du das nicht? Dann ignoriere diese E-Mail. An der Seite ändert sich nichts."
    text = (f"Jemand möchte auf dranzeit.de die Seite von {salon} aus unserem Salon-Verzeichnis übernehmen.\n\n"
            f"Warst du das? Dann geht es hier weiter (der Link gilt {ue.MAIL_GUELTIG_TAGE} Tage und ist nur für dich, gib ihn bitte nicht weiter):\n{url}\n\n{hinweis}\n")
    betreff = " ".join(f"Seite übernehmen: {entry.get('name') or ''}".split())
    try:
        return send_mail(email, betreff, branded_html("Seite übernehmen?", absaetze, "Seite übernehmen", url, hinweis), text)
    except MailError as e:
        print(f"Mail „Seite übernehmen“ für {entry['id']} nicht verschickt: {e}")
        return False


def anfrage_melden(entry: dict, email: str, ergebnis: str) -> None:
    """Mail an die Betreiber zu jeder Anfrage. Antworten gehen an die angegebene Adresse."""
    from app.libs.mail import an_betreiber, esc, public_url

    titel, satz = ERGEBNISSE[ergebnis]
    salon_html, salon_text = ent._salon_zeilen(entry)
    absaetze = [esc(satz), f"<strong>Angegebene Adresse:</strong> {esc(email)}", *salon_html]
    if entry.get("website"):
        absaetze.append(f"<strong>Webseite:</strong> {esc(entry['website'])}")
    antworten = "Antworten auf diese Mail gehen an die angegebene Adresse."
    absaetze.append(antworten)
    ziel = f"{public_url()}/betreiber?reiter=verzeichnis"
    text = (f"{satz}\n\nAngegebene Adresse: {email}\n{salon_text}" + (f"Webseite: {entry['website']}\n" if entry.get("website") else "")
            + f"\n{antworten}\nBetreiber-Bereich: {ziel}\n")
    betreff = " ".join(f"Seite übernehmen: {entry.get('name') or ''} – {titel}".split())
    an_betreiber(betreff, titel, absaetze, text, "Im Betreiber-Bereich ansehen", ziel, email)


def uebernommen_melden(entry: dict, shop: dict, email: Optional[str], weg: str) -> None:
    """Mail an die Betreiber: Eine Seite gehört jetzt einem Laden, ohne dass jemand von Hand bestätigt hat"""
    from app.libs.mail import an_betreiber, esc, public_url

    salon_html, salon_text = ent._salon_zeilen(entry)
    laden = " · ".join(x for x in (shop.get("name"), email) if x)
    satz = f"Nachweis: {weg}. Die Seite gehört jetzt diesem Laden. War das nicht der Salon? Dann sperrst du den Laden im Betreiber-Bereich, die Seite ist damit aus."
    ziel = f"{public_url()}/betreiber?reiter=verzeichnis"
    an_betreiber(" ".join(f"Seite übernommen: {entry.get('name') or ''}".split()), "Seite übernommen",
                 [esc(satz), f"<strong>Laden:</strong> {esc(laden)}", *salon_html],
                 f"{satz}\n\nLaden: {laden}\n{salon_text}\nBetreiber-Bereich: {ziel}\n", "Im Betreiber-Bereich ansehen", ziel)
