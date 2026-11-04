"""
Pausen über das Backend (requirements/eigene-datenbank.md, Stufe 2, Bereich 5). Gegenstück zu
frontend/src/utils/firestore/breaks.ts und recurring-breaks.ts.

- **Einzelne Pausen** (`breaks`): ein Tag (`date`) mit Beginn und Ende als Zeitpunkt, dazu optional eine Art (`type`).
- **Feste Pausen** (`recurring-breaks`): ein Wochentag (`dayOfWeek`, 0 = Sonntag), Beginn und Ende als "HH:MM",
  eine Art (`type`) und der Schalter `active`.

Lesen ist öffentlich, denn Buchen und Nummer ziehen brauchen die Pausen für freie Plätze. Pflegen darf nur der Inhaber,
und nur für Personen seines Ladens (wie firestore.rules: ownsShop und staffInShop). Nach jeder Änderung rechnet das
Backend die freien Zeiten neu: nach einer einzelnen Pause für ihren Tag, nach einer festen für alle Tage.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from app import store
from app.i18n import merke
from app.libs.schedule import day_key

EINZELN = "breaks"
FEST = "recurring-breaks"
ARTEN_FEST = {"lunch", "coffee", "personal", "other"}
UHRZEIT = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
SERVER = frozenset({"id", "createdAt", "updatedAt"})


class PausenFehler(Exception):
    def __init__(self, status: int, text):
        super().__init__(text)
        self.status = status
        self.text = text


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


def _minuten(text: str) -> int:
    h, m = text.split(":")
    return int(h) * 60 + int(m)


def pausen_der_person(db, staff_id: str) -> dict:
    """Alle einzelnen und festen Pausen einer Person (wie loadStaffRange in booking-rules.ts)"""
    def liste(sammlung):
        abfrage = db.collection(sammlung).where(filter=store.FieldFilter("staffId", "==", staff_id))
        return sorted(({"id": d.id, **(d.to_dict() or {})} for d in abfrage.stream()), key=lambda p: p["id"])

    return {"einzeln": liste(EINZELN), "fest": liste(FEST)}


def person_im_laden(db, shop_id, staff_id) -> bool:
    if not isinstance(staff_id, str) or not staff_id:
        return False
    snap = db.collection("staff").document(staff_id).get()
    return bool(snap.exists and (snap.to_dict() or {}).get("shopId") == shop_id)


def _pruefen_einzeln(daten: dict, neu: bool) -> None:
    for feld in ("date", "startTime", "endTime"):
        if (neu or feld in daten) and not isinstance(daten.get(feld), datetime):
            raise PausenFehler(400, merke("Ungültige Zeitangabe für die Pause."))
    if "startTime" in daten and "endTime" in daten and daten["endTime"] <= daten["startTime"]:
        raise PausenFehler(400, merke("Das Ende der Pause muss nach dem Beginn liegen."))


def _pruefen_fest(daten: dict, neu: bool) -> None:
    if neu or "dayOfWeek" in daten:
        tag = daten.get("dayOfWeek")
        if isinstance(tag, bool) or not isinstance(tag, int) or not 0 <= tag <= 6:
            raise PausenFehler(400, merke("Ungültige Zeitangabe für die Pause."))
    for feld in ("startTime", "endTime"):
        if (neu or feld in daten) and not (isinstance(daten.get(feld), str) and UHRZEIT.match(daten[feld].strip())):
            raise PausenFehler(400, merke("Ungültige Zeitangabe für die Pause."))
    if isinstance(daten.get("startTime"), str) and isinstance(daten.get("endTime"), str) \
            and _minuten(daten["endTime"]) <= _minuten(daten["startTime"]):
        raise PausenFehler(400, merke("Das Ende der Pause muss nach dem Beginn liegen."))
    if "type" in daten and daten["type"] is not None and daten["type"] not in ARTEN_FEST:
        raise PausenFehler(400, merke("Ungültige Zeitangabe für die Pause."))
    if "active" in daten and not isinstance(daten["active"], bool):
        raise PausenFehler(400, merke("Ungültige Zeitangabe für die Pause."))


def _zwischenspeicher(shop_id: str, tag: datetime | None) -> None:
    """Freie Zeiten neu rechnen: einzelne Pause für ihren Tag, feste für alle Tage. Wirft nie."""
    try:
        from app.apis.cache import invalidate_shop_cache, invalidate_shop_date_cache

        if tag is not None:
            invalidate_shop_date_cache(shop_id, day_key(tag), verbose=False)
        else:
            invalidate_shop_cache(shop_id, verbose=False)
    except Exception as e:
        print(f"Zwischenspeicher nach Pausenänderung nicht geleert: {e}")


def pause_lesen(db, sammlung: str, pause_id: str) -> dict:
    snap = db.collection(sammlung).document(pause_id).get()
    if not snap.exists:
        raise PausenFehler(404, merke("Diese Pause gibt es nicht mehr."))
    return {"id": pause_id, **(snap.to_dict() or {})}


def anlegen(db, sammlung: str, daten: dict) -> dict:
    """Neue Pause; Inhaber und Laden prüft der Endpunkt, hier: Person gehört zum Laden, Zeiten stimmen"""
    daten = {k: v for k, v in daten.items() if k not in SERVER}
    if not person_im_laden(db, daten.get("shopId"), daten.get("staffId")):
        raise PausenFehler(400, merke("Diese Person gehört nicht zu diesem Laden."))
    if sammlung == EINZELN:
        _pruefen_einzeln(daten, neu=True)
    else:
        _pruefen_fest(daten, neu=True)
        daten.setdefault("active", True)
    ref = db.collection(sammlung).document()
    jetzt = _jetzt()
    eintrag = {**({"id": ref.id} if sammlung == EINZELN else {}), **daten, "createdAt": jetzt, "updatedAt": jetzt}
    ref.set(eintrag)
    _zwischenspeicher(daten["shopId"], daten.get("date") if sammlung == EINZELN else None)
    return {"id": ref.id, **eintrag}


def aendern(db, sammlung: str, pause_id: str, aenderung: dict) -> dict:
    vorher = pause_lesen(db, sammlung, pause_id)
    aenderung = {k: v for k, v in aenderung.items() if k not in SERVER and k != "shopId"}
    if "staffId" in aenderung and not person_im_laden(db, vorher.get("shopId"), aenderung["staffId"]):
        raise PausenFehler(400, merke("Diese Person gehört nicht zu diesem Laden."))
    zusammen = {**vorher, **aenderung}
    # Geprüft wird, was mitkommt; dazu Beginn vor Ende im neuen Stand (alte Einträge mit Text-Zeiten bleiben unberührt)
    beginn, ende = zusammen.get("startTime"), zusammen.get("endTime")
    if sammlung == EINZELN:
        _pruefen_einzeln(aenderung, neu=False)
        falsch_herum = isinstance(beginn, datetime) and isinstance(ende, datetime) and ende <= beginn
    else:
        _pruefen_fest(aenderung, neu=False)
        falsch_herum = all(isinstance(z, str) and UHRZEIT.match(z.strip()) for z in (beginn, ende)) and _minuten(ende) <= _minuten(beginn)
    if falsch_herum:
        raise PausenFehler(400, merke("Das Ende der Pause muss nach dem Beginn liegen."))
    ref = db.collection(sammlung).document(pause_id)
    ref.set({**aenderung, "updatedAt": _jetzt()}, merge=True)
    if sammlung == EINZELN:
        for tag in {vorher.get("date"), zusammen.get("date")} - {None}:
            if isinstance(tag, datetime):
                _zwischenspeicher(vorher["shopId"], tag)
    else:
        _zwischenspeicher(vorher.get("shopId", ""), None)
    return pause_lesen(db, sammlung, pause_id)


def loeschen(db, sammlung: str, pause_id: str) -> None:
    vorher = pause_lesen(db, sammlung, pause_id)
    db.collection(sammlung).document(pause_id).delete()
    _zwischenspeicher(vorher.get("shopId", ""), vorher.get("date") if sammlung == EINZELN and isinstance(vorher.get("date"), datetime) else None)
