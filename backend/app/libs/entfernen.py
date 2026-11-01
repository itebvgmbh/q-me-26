"""Verzeichnis: Der Salon nimmt seinen Eintrag offline – nur mit Nachweis, dass die Anfrage vom Salon kommt.

Öffentlich, ohne Konto (app/apis/verzeichnis). Das Formular auf der Seite allein ändert nichts am Eintrag:
  1. Anfrage mit einer E-Mail-Adresse. Sie passt, wenn sie an der Domain der Salon-Webseite liegt oder auf dieser Webseite
     steht (Startseite, Impressum, Kontakt – viele kleine Salons nutzen Gmail oder web.de). Dann geht ein Link an sie.
  2. Der Link zeigt nur eine Seite mit Knopf, weil Mail-Programme Links zum Prüfen von selbst aufrufen. Erst der Knopf
     nimmt den Eintrag offline.
Passt die Adresse nicht, bleibt der Eintrag online und der Betreiber prüft von Hand. Er bekommt zu jeder Anfrage und jeder
Entfernung eine Mail. Geprüft wird im Hintergrund, die Antwort aufs Formular kommt sofort und nennt das Ergebnis nicht. Zurückholen kann er den Eintrag im Betreiber-Bereich; gelöscht wird dabei nichts.

Feld am Eintrag: entfernen {tokenHash, am, gueltigBis}. Das Token selbst steht nirgends; Adresse und Grund stehen nur im
Protokoll auf dem Server (app/libs/protokoll.py), nicht in Firestore.
"""

import hashlib
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlparse

from app.libs import uebernahme as ue
from app.libs import verzeichnis as vz
from app.libs import verzeichnis_import as imp

GUELTIG_STUNDEN = 24
ADRESSE = re.compile(r"[^@\s<>,;:\"'()\[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}")

# Warum die Anfrage so ausging: Überschrift und Absatz der Mail an den Betreiber
ERGEBNISSE = {
    "link": ("Link verschickt", "Die Adresse gehört zum Salon, der Link ist unterwegs. Der Eintrag geht erst offline, wenn er bestätigt wird. Du musst nichts tun."),
    "passt_nicht": ("Adresse passt nicht", "Die Adresse gehört nicht erkennbar zum Salon, es ging kein Link raus. Der Eintrag bleibt online. Stimmt die Anfrage trotzdem, nimmst du ihn im Betreiber-Bereich offline."),
    "keine_webseite": ("Von Hand prüfen", "Der Eintrag hat keine eigene Webseite, darum lässt sich die Adresse nicht prüfen. Der Eintrag bleibt online. Stimmt die Anfrage, nimmst du ihn im Betreiber-Bereich offline."),
    "gebremst": ("Schon ein Link unterwegs", "Die Adresse passt, aber für diesen Eintrag ging vor Kurzem schon ein Link raus (oder die Obergrenze des Tages ist erreicht). Es ging kein neuer raus."),
    "nicht_verschickt": ("Link nicht verschickt", "Die Adresse passt, aber die Mail mit dem Link ging nicht raus. Der Eintrag bleibt online. Stimmt die Anfrage, nimmst du ihn im Betreiber-Bereich offline."),
    "korrektur": ("Korrektur gemeldet", "Jemand meldet falsche Angaben. An der Seite ändert sich dadurch nichts."),
}


def adresse_gueltig(email: str) -> bool:
    return len(email) <= 200 and bool(ADRESSE.fullmatch(email))


def eigene_domain(entry: dict) -> str:
    """Domain der Salon-Webseite ohne www; leer ohne Webseite und bei Plattformen (dort kann jeder ein Profil haben)"""
    url = (entry.get("website") or "").strip()
    if not url or imp.fremde_seite(url):
        return ""
    host = urlparse(url if "://" in url else f"https://{url}").hostname or ""
    return host.lower().removeprefix("www.")


def adresse_passt(entry: dict, email: str) -> bool:
    """Genau die Domain der Webseite, keine übergeordnete: sonst käme bei salon.gmx.de jede Adresse @gmx.de durch"""
    domain = eigene_domain(entry)
    if not domain:
        return False
    return email.rsplit("@", 1)[-1] == domain or email in imp.adressen_der_webseite(entry["website"])


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _anschrift(entry: dict) -> str:
    ort = " ".join(x for x in (entry.get("postalCode"), entry.get("city")) if x)
    return ", ".join(x for x in (entry.get("street"), ort) if x)


def link_schicken(entry: dict, email: str, st=None, now: Optional[datetime] = None) -> bool:
    """Bestätigungslink an die Adresse; ein neuer macht den vorigen ungültig. Der Text ist fest: Was im Formular steht, geht
    nie an den Salon, sonst könnte jeder über uns beliebige Mails verschicken. False = keine Mail rausgegangen."""
    from app.libs.mail import MailError, branded_html, esc, public_url, send_mail

    now = now or vz.now()
    token = secrets.token_urlsafe(32)
    (st or vz.store()).aendere(entry["id"], {"entfernen": {"tokenHash": _hash(token), "am": now, "gueltigBis": now + timedelta(hours=GUELTIG_STUNDEN)}})
    url = f"{public_url()}/routes/verzeichnis/{entry['id']}/entfernen/bestaetigen?t={token}"
    salon = " · ".join(x for x in (entry.get("name"), _anschrift(entry)) if x)
    absaetze = [
        f"Jemand hat auf dranzeit.de angefordert, die Seite von <strong>{esc(salon)}</strong> aus unserem Salon-Verzeichnis zu entfernen.",
        f"Warst du das? Dann bestätige es mit dem Knopf. Der Link gilt {GUELTIG_STUNDEN} Stunden.",
    ]
    hinweis = "Warst du das nicht? Dann ignoriere diese E-Mail. Der Eintrag bleibt, wie er ist."
    text = (f"Jemand hat auf dranzeit.de angefordert, die Seite von {salon} aus unserem Salon-Verzeichnis zu entfernen.\n\n"
            f"Warst du das? Dann bestätige es hier (der Link gilt {GUELTIG_STUNDEN} Stunden):\n{url}\n\n{hinweis}\n")
    betreff = " ".join(f"Eintrag entfernen: {entry.get('name') or ''}".split())
    try:
        return send_mail(email, betreff, branded_html("Eintrag entfernen?", absaetze, "Eintrag entfernen", url, hinweis), text)
    except MailError as e:
        print(f"Mail „Eintrag entfernen“ für {entry['id']} nicht verschickt: {e}")
        return False


def link_gilt(entry: Optional[dict], token: str, now: Optional[datetime] = None) -> bool:
    """Passt das Token zu einem Eintrag, der noch online ist und niemandem gehört, und ist es noch nicht abgelaufen?"""
    if not entry or not token or entry.get("status") != "online" or entry.get("shopId"):
        return False
    info = entry.get("entfernen") or {}
    gueltig = ue._aware(info.get("gueltigBis"))
    if not info.get("tokenHash") or not gueltig or gueltig < (now or vz.now()):
        return False
    return secrets.compare_digest(info["tokenHash"], _hash(token))


def offline_nehmen(entry: dict, st=None, now: Optional[datetime] = None) -> None:
    now = now or vz.now()
    (st or vz.store()).aendere(entry["id"], {"status": "entfernt", "entferntAm": now, "geaendertAm": now, "entfernen": None})


def _salon_zeilen(entry: dict) -> tuple:
    """(HTML-Absätze, Text) mit allem, was der Betreiber für einen Rückruf braucht"""
    from app.libs.mail import esc, public_url

    seite = f"{public_url()}{vz.pfad(entry)}"
    salon = " · ".join(x for x in (entry.get("name"), _anschrift(entry), entry.get("phone")) if x)
    return [f"<strong>Salon:</strong> <a href=\"{esc(seite)}\">{esc(salon)}</a>"], f"Salon: {salon}\n{seite}\n"


def anfrage_melden(entry: dict, email: str, grund: str, ergebnis: str) -> None:
    """Mail an die Betreiber zu jeder Anfrage. Antworten gehen an die angegebene Adresse."""
    from app.libs.mail import an_betreiber, esc, public_url

    titel, satz = ERGEBNISSE[ergebnis]
    salon_html, salon_text = _salon_zeilen(entry)
    absaetze = [esc(satz), f"<strong>Angegebene Adresse:</strong> {esc(email)}", *salon_html]
    if entry.get("website"):
        absaetze.append(f"<strong>Webseite:</strong> {esc(entry['website'])}")
    if grund:
        absaetze.append(f"<strong>Begründung:</strong> {esc(grund)}")
    antworten = "Antworten auf diese Mail gehen an die angegebene Adresse."
    absaetze.append(antworten)
    ziel = f"{public_url()}/betreiber?reiter=verzeichnis"
    text = (f"{satz}\n\nAngegebene Adresse: {email}\n{salon_text}" + (f"Webseite: {entry['website']}\n" if entry.get("website") else "")
            + (f"Begründung: {grund}\n" if grund else "") + f"\n{antworten}\nBetreiber-Bereich: {ziel}\n")
    name = entry.get("name") or ""
    betreff = " ".join((f"Korrektur gemeldet: {name}" if ergebnis == "korrektur" else f"Eintrag entfernen: {name} – {titel}").split())
    an_betreiber(betreff, titel, absaetze, text, "Im Betreiber-Bereich ansehen", ziel, email)


def entfernt_melden(entry: dict) -> None:
    """Mail an die Betreiber: Der Salon hat den Link bestätigt"""
    from app.libs.mail import an_betreiber, esc, public_url

    salon_html, salon_text = _salon_zeilen(entry)
    satz = "Der Link an die Salon-Adresse wurde bestätigt, die Seite ist offline. War das ein Versehen, holst du sie im Betreiber-Bereich zurück."
    ziel = f"{public_url()}/betreiber?reiter=verzeichnis"
    an_betreiber(" ".join(f"Eintrag entfernt: {entry.get('name') or ''}".split()), "Eintrag entfernt", [esc(satz), *salon_html],
                 f"{satz}\n\n{salon_text}\nBetreiber-Bereich: {ziel}\n", "Im Betreiber-Bereich ansehen", ziel)


def obergrenze_melden() -> None:
    """Einmal am Tag, wenn so viele Anfragen kommen, dass keine weiteren Mails mehr rausgehen"""
    from app.libs.mail import an_betreiber

    satz = "Heute kamen ungewöhnlich viele Anfragen, Einträge zu entfernen oder zu übernehmen. Bis morgen gehen dazu keine Mails mehr raus; die Anfragen stehen im Protokoll. Ohne bestätigten Link ändert sich an den Einträgen nichts."
    an_betreiber("Verzeichnis: ungewöhnlich viele Anfragen", "Ungewöhnlich viele Anfragen", [satz], satz + "\n")
