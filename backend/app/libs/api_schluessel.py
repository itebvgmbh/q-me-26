"""
Schlüssel für die Termin-API der Läden (requirements/termin-api.md, app/schnittstelle).

Der Inhaber erzeugt unter „Laden“ → „Schnittstelle (API)“ einen Schlüssel für ein eigenes Programm (Webseite, Kasse).
Ein Schlüssel gilt für genau einen Laden. Form: dz_<ID>_<Geheimnis> – die ID findet den Eintrag, gespeichert wird nur
der SHA-256-Hash des ganzen Schlüssels (Sammlung api_schluessel). Den Schlüssel selbst sieht der Inhaber einmal, beim
Anlegen. Widerrufen setzt revokedAt; der Eintrag bleibt für den Verlauf, die Liste zeigt ihn nicht mehr.
Laden löschen nimmt die Einträge mit (app/libs/konten.SHOP_COLLECTIONS).
"""
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from app.libs.links import token_hash, token_matches

SAMMLUNG = "api_schluessel"
PRAEFIX = "dz_"
MAX_AKTIV = 10
NAME_MAX = 60
# lastUsedAt nur so oft schreiben, nicht bei jeder Anfrage
NUTZUNG_MERKEN = timedelta(minutes=10)
FORM = re.compile(r"^dz_([0-9a-f]{16})_[A-Za-z0-9_-]{30,64}$")


class SchluesselFehler(Exception):
    def __init__(self, status: int, meldung: str):
        super().__init__(meldung)
        self.status, self.meldung = status, meldung


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


def fuer_den_inhaber(schluessel_id: str, e: dict) -> dict:
    """Was die Liste zeigt: nie Hash oder Schlüssel"""
    return {"id": schluessel_id, "name": e.get("name", ""), "anfang": e.get("anfang", ""),
            "angelegt": e.get("createdAt"), "zuletzt_benutzt": e.get("lastUsedAt")}


def _aktive(db, shop_id: str) -> list:
    return [(d.id, d.to_dict() or {}) for d in db.collection(SAMMLUNG).where("shopId", "==", shop_id).stream()
            if not (d.to_dict() or {}).get("revokedAt")]


def liste(db, shop_id: str) -> list:
    """Aktive Schlüssel des Ladens, neueste zuerst"""
    aktive = sorted(_aktive(db, shop_id), key=lambda e: e[1].get("createdAt") or _jetzt(), reverse=True)
    return [fuer_den_inhaber(i, e) for i, e in aktive]


def anlegen(db, shop_id: str, name: str, uid: str) -> Tuple[dict, str]:
    """Neuer Schlüssel: (Eintrag für die Liste, Schlüssel im Klartext – nur dieses eine Mal)"""
    name = " ".join(str(name or "").split())[:NAME_MAX] or "API-Schlüssel"
    if len(_aktive(db, shop_id)) >= MAX_AKTIV:
        raise SchluesselFehler(400, f"Höchstens {MAX_AKTIV} Schlüssel je Laden. Widerrufe erst einen alten.")
    schluessel_id = secrets.token_hex(8)
    schluessel = f"{PRAEFIX}{schluessel_id}_{secrets.token_urlsafe(32)}"
    eintrag = {"shopId": shop_id, "name": name, "hash": token_hash(schluessel), "anfang": f"{PRAEFIX}{schluessel_id}",
               "createdAt": _jetzt(), "createdBy": uid, "lastUsedAt": None}
    db.collection(SAMMLUNG).document(schluessel_id).set(eintrag)
    return fuer_den_inhaber(schluessel_id, eintrag), schluessel


def widerrufen(db, shop_id: str, schluessel_id: str) -> None:
    ref = db.collection(SAMMLUNG).document(schluessel_id)
    snap = ref.get()
    e = (snap.to_dict() or {}) if snap.exists else {}
    if e.get("shopId") != shop_id or e.get("revokedAt"):
        raise SchluesselFehler(404, "Diesen Schlüssel gibt es nicht.")
    ref.update({"revokedAt": _jetzt()})
    # Webhooks dieses Schlüssels gehen mit: wer die Anbindung stoppt, will auch keine Daten mehr hinschicken
    from app.libs import webhooks

    webhooks.fuer_schluessel_loeschen(db, schluessel_id)


def pruefen(db, schluessel: Optional[str]) -> Optional[Tuple[str, dict]]:
    """(ID, Eintrag) zu einem gültigen Schlüssel, sonst None. Merkt sich, wann er zuletzt benutzt wurde."""
    treffer = FORM.fullmatch(schluessel or "")
    if not treffer:
        return None
    ref = db.collection(SAMMLUNG).document(treffer.group(1))
    snap = ref.get()
    e = (snap.to_dict() or {}) if snap.exists else None
    if not e or e.get("revokedAt") or not token_matches(e.get("hash"), schluessel):
        return None
    jetzt = _jetzt()
    zuletzt = e.get("lastUsedAt")
    if not isinstance(zuletzt, datetime) or jetzt - (zuletzt if zuletzt.tzinfo else zuletzt.replace(tzinfo=timezone.utc)) > NUTZUNG_MERKEN:
        try:
            ref.update({"lastUsedAt": jetzt})
            e["lastUsedAt"] = jetzt
        except Exception as fehler:  # nur Statistik – die Anfrage scheitert nicht daran
            print(f"API-Schlüssel {treffer.group(1)}: letzte Nutzung nicht gespeichert: {fehler}")
    return treffer.group(1), e
