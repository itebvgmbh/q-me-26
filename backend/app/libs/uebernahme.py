"""Übernahme per Code: Ein Salon aus dem Verzeichnis macht seine Seite zum Dranzeit-Laden, ohne dass der Betreiber bestätigt.

Der Code steht in einem Brief an die Ladenadresse (oder kommt aus dem Betreiber-Bereich). Wer ihn hat, war am Laden – das
reicht als Nachweis, wie bei Googles Postkarte. Ablauf:
  1. code_erzeugen: am Eintrag steht nur der Hash (uebernahme.codeHash), der Code selbst nirgends
  2. /uebernehmen#code=… prüft den Code (pruefen) und füllt den Einrichtungsassistenten mit der Seite vor (vorschau)
  3. Nach dem Anlegen des Ladens: einloesen – der Eintrag wird die Seite des Ladens (vz.verknuepfen), der Code ist verbraucht

Ohne Code (Knopf „Ist das dein Salon?“ auf der Seite) füllt der Assistent genauso vor; verknüpft wird dann wie bisher über
den Abgleich, den der Betreiber bestätigt.

Code: 10 Zeichen ohne Verwechsler (kein 0/O, 1/I/L), angezeigt als ABCDE-FGHJK, rund 50 Bit. Gespeichert als PBKDF2-Hash
mit festem Salz: nachschlagbar, aber wer die Hashes liest, muss trotzdem lange raten. Das Backend begrenzt Versuche je IP.

Feld am Eintrag: uebernahme {codeHash, erstelltAm, gueltigBis, eingeloestAm, shopId}
"""

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from app.i18n import merke
from app.libs import verzeichnis as vz

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
LAENGE = 10
GUELTIG_TAGE = 180
SALZ = b"dranzeit-uebernahme"
RUNDEN = 100_000


class Fehler(Exception):
    """Code passt nicht; status für die HTTP-Antwort, text gemerkt (übersetzt beim Antworten, app/i18n)"""

    def __init__(self, status: int, text: str):
        super().__init__(text)
        self.status = status
        self.text = text


def neuer_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(LAENGE))


def normalisieren(code: str) -> str:
    """'abcde-fghjk ' → 'ABCDEFGHJK'; Bindestriche, Leerzeichen und Kleinschreibung egal"""
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())[:40]


def anzeigen(code: str) -> str:
    c = normalisieren(code)
    return f"{c[:5]}-{c[5:]}" if len(c) == LAENGE else c


def code_hash(code: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", normalisieren(code).encode(), SALZ, RUNDEN).hex()


def code_erzeugen(entry: dict, st=None, now: Optional[datetime] = None) -> dict:
    """Neuer Code für einen Salon ohne Dranzeit; ein früherer gilt dann nicht mehr. Gibt {code, gueltigBis} zurück."""
    st = st or vz.store()
    if entry.get("shopId"):
        raise Fehler(409, merke("Diese Seite gehört schon zu einem Dranzeit-Laden."))
    now = now or vz.now()
    code = neuer_code()
    gueltig = now + timedelta(days=GUELTIG_TAGE)
    st.aendere(entry["id"], {"uebernahme": {"codeHash": code_hash(code), "erstelltAm": now, "gueltigBis": gueltig}})
    return {"code": anzeigen(code), "gueltigBis": gueltig}


def _aware(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo else value.replace(tzinfo=vz.now().tzinfo)


def pruefen(code: str, st=None, now: Optional[datetime] = None) -> dict:
    """Eintrag zum Code – oder Fehler (unbekannt, schon eingelöst, abgelaufen)"""
    st = st or vz.store()
    if len(normalisieren(code)) != LAENGE:
        raise Fehler(404, merke("Diesen Code kennen wir nicht. Prüf ihn bitte noch einmal."))
    entry = st.per_code(code_hash(code))
    if not entry:
        raise Fehler(404, merke("Diesen Code kennen wir nicht. Prüf ihn bitte noch einmal."))
    info = entry.get("uebernahme") or {}
    if info.get("eingeloestAm") or entry.get("shopId"):
        raise Fehler(409, merke("Dieser Code ist schon eingelöst. Melde dich mit dem Konto an, mit dem du deinen Laden eingerichtet hast."))
    gueltig = _aware(info.get("gueltigBis"))
    if gueltig and gueltig < (now or vz.now()):
        raise Fehler(410, merke("Dieser Code ist abgelaufen. Schreib uns an hilfe@dranzeit.de, dann bekommst du einen neuen."))
    return entry


def vorschau(entry: dict) -> dict:
    """Was der Einrichtungsassistent übernimmt – nur, was auf der öffentlichen Seite steht"""
    return {
        "id": entry["id"],
        "pfad": vz.pfad(entry) if entry.get("slug") and entry.get("stadtSlug") else "",
        **{k: entry.get(k) or "" for k in ("name", "kategorie", "street", "postalCode", "city", "phone", "website",
                                             "beschreibung", "googlePlaceId")},
        "coordinates": entry.get("coordinates") or None,
        "businessHoursByDay": entry.get("businessHoursByDay") or [],
        "services": entry.get("services") or [],
    }


def einloesen(code: str, shop_id: str, st=None, now: Optional[datetime] = None) -> dict:
    """Code einlösen: Der Eintrag wird die Seite des Ladens. Gibt den Eintrag (vor der Änderung) zurück."""
    st = st or vz.store()
    entry = pruefen(code, st, now)
    now = now or vz.now()
    vz.verknuepfen(entry, shop_id, st.alle(), st)
    st.aendere(entry["id"], {"uebernahme": {**(entry.get("uebernahme") or {}), "eingeloestAm": now, "shopId": shop_id}})
    return entry
