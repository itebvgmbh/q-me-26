"""
Team und Leistungen eines Ladens über das Backend (requirements/eigene-datenbank.md, Stufe 2, Bereich 4).

Gegenstück zu frontend/src/utils/firestore/staff.ts und services.ts. Die Rechte sind dieselben wie bisher in
firestore.rules:

- **Personen anlegen, ändern, deaktivieren, zurückholen:** nur der Inhaber. Eine verbundene Person darf ihre eigenen
  Arbeitszeiten ändern.
- **Einladungsfelder:** setzt nur das Backend (app/apis/staff_invitation).
- **Konto-ID (`userId`):** darf der Inhaber nur auf sein eigenes Konto setzen (er arbeitet selbst mit).
- **Kontaktdaten** (E-Mail, Telefon, Einladungsadresse; `shops/{id}/staff_contacts`): liest und pflegt nur der
  Inhaber.
- **Leistungen:** pflegt nur der Inhaber. Löschen heißt ausblenden (`archived`).

Neu gegenüber Firestore: Öffentliche Seiten bekommen Personen ohne Konto-ID und ohne Einladungsfelder
(`person_oeffentlich`). Wer Inhaber oder Team ist, bekommt sie mit (`person_fuers_team`).
"""

from __future__ import annotations

from datetime import datetime, timezone

from app import store
from app.i18n import merke
from app.libs import leistungsgruppen
from app.libs.team import member_ref, set_member

STAFF = "staff"
SERVICES = "services"
CONTACTS = "staff_contacts"

# Was Buchen, Nummer ziehen, Bildschirm und Ladenseite von einer Person brauchen
PERSON_OEFFENTLICH = ("shopId", "name", "role", "serviceIds", "isActive", "workingHours", "status", "profileImageUrl",
                      "createdAt", "updatedAt")
EINLADUNG = ("inviteTokenHash", "inviteCreatedAt", "inviteExpires", "inviteEmailSentAt", "inviteEmailTo", "inviteAcceptedAt")
KONTAKT = ("email", "phone")
# Setzt nur das Backend; was der Browser dazu schickt, fällt weg
PERSON_SERVER = frozenset({"id", "createdAt", "updatedAt", *EINLADUNG})
LEISTUNG_SERVER = frozenset({"id", "createdAt", "updatedAt", "archivedAt"})


class TeamFehler(Exception):
    """status (400, 403, 404) und ein mit merke() markierter Text"""

    def __init__(self, status: int, text):
        super().__init__(text)
        self.status = status
        self.text = text


def _jetzt() -> datetime:
    return datetime.now(timezone.utc)


# --- Lesen -----------------------------------------------------------------------------------------------------------


def person_oeffentlich(person_id: str, daten: dict) -> dict:
    return {"id": person_id, **{k: daten[k] for k in PERSON_OEFFENTLICH if k in daten}}


def person_fuers_team(person_id: str, daten: dict, kontakt: dict | None, inhaber: bool) -> dict:
    """Alles außer dem Hash der Einladung. Kontaktdaten nur für den Inhaber, aus staff_contacts (sonst alte Felder)."""
    person = {"id": person_id, **{k: v for k, v in daten.items() if k not in ("inviteTokenHash", "email", "phone", "inviteEmailTo")}}
    if inhaber:
        quelle = kontakt or {}
        person["email"] = quelle.get("email", daten.get("email", "")) or ""
        person["phone"] = quelle.get("phone", daten.get("phone", "")) or ""
        einladung = quelle.get("inviteEmailTo", daten.get("inviteEmailTo"))
        if einladung:
            person["inviteEmailTo"] = einladung
    return person


def personen_des_ladens(db, shop_id: str) -> list[tuple[str, dict]]:
    abfrage = db.collection(STAFF).where(filter=store.FieldFilter("shopId", "==", shop_id))
    return sorted(((d.id, d.to_dict() or {}) for d in abfrage.stream()), key=lambda p: p[0])


def kontakte(db, shop_id: str) -> dict[str, dict]:
    return {d.id: d.to_dict() or {} for d in db.collection("shops").document(shop_id).collection(CONTACTS).stream()}


def personen_fuers_team(db, shop_id: str, inhaber: bool) -> list[dict]:
    alle = kontakte(db, shop_id) if inhaber else {}
    return [person_fuers_team(pid, d, alle.get(pid), inhaber) for pid, d in personen_des_ladens(db, shop_id)]


def eigene_eintraege(db, uid: str) -> list[dict]:
    """Aktive Einträge eines Kontos, in mehreren Läden kann es mehrere geben (Mein Tag). Ohne fremde Kontaktdaten."""
    abfrage = db.collection(STAFF).where(filter=store.FieldFilter("userId", "==", uid))
    eintraege = [(d.id, d.to_dict() or {}) for d in abfrage.stream()]
    return [person_fuers_team(pid, d, None, inhaber=False) for pid, d in sorted(eintraege) if d.get("isActive") is not False]


def leistungen_des_ladens(db, shop_id: str) -> list[dict]:
    abfrage = db.collection(SERVICES).where(filter=store.FieldFilter("shopId", "==", shop_id))
    return sorted(({"id": d.id, **(d.to_dict() or {})} for d in abfrage.stream()), key=lambda s: s["id"])


def leistung(db, service_id: str) -> dict | None:
    snap = db.collection(SERVICES).document(service_id).get()
    return {"id": snap.id, **(snap.to_dict() or {})} if snap.exists else None


def kommende_termine_mit_leistung(db, shop_id: str, service_id: str, jetzt: datetime | None = None) -> int:
    """Wie viele kommende, nicht abgesagte Termine diese Leistung haben (Rückfrage beim Löschen)"""
    jetzt = jetzt or _jetzt()
    abfrage = (db.collection("appointments")
               .where(filter=store.FieldFilter("shopId", "==", shop_id))
               .where(filter=store.FieldFilter("serviceId", "==", service_id)))
    anzahl = 0
    for d in abfrage.stream():
        t = d.to_dict() or {}
        ende = t.get("endTime") or t.get("startTime")
        if isinstance(ende, datetime) and (ende if ende.tzinfo else ende.replace(tzinfo=timezone.utc)) > jetzt \
                and t.get("status") not in ("cancelled", "completed"):
            anzahl += 1
    return anzahl


# --- Personen schreiben ------------------------------------------------------------------------------------------


def _kontakt_aus(daten: dict) -> tuple[dict, dict | None]:
    """Teilt in den öffentlichen Eintrag und die Kontaktdaten (wie splitContact im Browser)"""
    rest = {k: v for k, v in daten.items() if k not in KONTAKT}
    kontakt = {k: str(daten[k] or "").strip() for k in KONTAKT if k in daten}
    return rest, (kontakt or None)


def _person_pruefen(daten: dict) -> None:
    if "name" in daten and (not isinstance(daten["name"], str) or not daten["name"].strip()):
        raise TeamFehler(400, merke("Bitte gib einen Namen ein."))
    if "serviceIds" in daten and not (isinstance(daten["serviceIds"], list) and all(isinstance(s, str) for s in daten["serviceIds"])):
        raise TeamFehler(400, merke("Ungültige Angaben zur Person."))
    if "workingHours" in daten and not isinstance(daten["workingHours"], list):
        raise TeamFehler(400, merke("Ungültige Angaben zur Person."))


def person_anlegen(db, uid: str, daten: dict) -> dict:
    """Neue Person im Laden (Inhaber, geprüft vom Endpunkt). userId nur leer oder das eigene Konto."""
    daten = {k: v for k, v in daten.items() if k not in PERSON_SERVER}
    shop_id = daten.get("shopId")
    if not isinstance(daten.get("name"), str) or not daten["name"].strip():
        raise TeamFehler(400, merke("Bitte gib einen Namen ein."))
    _person_pruefen(daten)
    if daten.get("userId") not in (None, "", uid):
        raise TeamFehler(400, merke("Ungültige Angaben zur Person."))
    rest, kontakt = _kontakt_aus(daten)
    ref = db.collection(STAFF).document()
    jetzt = _jetzt()
    eintrag = {"id": ref.id, **rest, "createdAt": jetzt, "updatedAt": jetzt, "status": "available"}
    batch = db.batch()
    batch.set(ref, eintrag)
    if kontakt:
        batch.set(db.collection("shops").document(shop_id).collection(CONTACTS).document(ref.id), {**kontakt, "updatedAt": jetzt})
    batch.commit()
    return person_fuers_team(ref.id, eintrag, kontakt, inhaber=True)


def person_aendern(db, uid: str, person_id: str, aenderung: dict, inhaber: bool) -> dict:
    """Person ändern. Inhaber: alles außer Laden und Einladung, Konto-ID nur aufs eigene Konto. Die Person selbst:
    nur ihre Arbeitszeiten (wie firestore.rules)."""
    ref = db.collection(STAFF).document(person_id)
    snap = ref.get()
    if not snap.exists:
        raise TeamFehler(404, merke("Diese Person gibt es nicht mehr."))
    vorher = snap.to_dict() or {}
    aenderung = {k: v for k, v in aenderung.items() if k not in PERSON_SERVER and k != "shopId"}
    if not inhaber:
        if vorher.get("userId") != uid or not set(aenderung) <= {"workingHours"}:
            raise TeamFehler(403, merke("Das darf nur der Inhaber des Ladens."))
    if "userId" in aenderung and aenderung["userId"] != vorher.get("userId") and aenderung["userId"] != uid:
        raise TeamFehler(400, merke("Ungültige Angaben zur Person."))
    _person_pruefen(aenderung)
    rest, kontakt = _kontakt_aus(aenderung)
    jetzt = _jetzt()
    batch = db.batch()
    if kontakt:
        kontakt_ref = db.collection("shops").document(vorher.get("shopId", "")).collection(CONTACTS).document(person_id)
        batch.set(kontakt_ref, {**kontakt, "updatedAt": jetzt}, merge=True)
        # Kontaktdaten von früher am öffentlichen Eintrag gleich mit entfernen
        batch.set(ref, {**rest, "email": store.DELETE_FIELD, "phone": store.DELETE_FIELD, "updatedAt": jetzt}, merge=True)
    else:
        batch.set(ref, {**rest, "updatedAt": jetzt}, merge=True)
    batch.commit()
    nachher = ref.get().to_dict() or {}
    kontakt_neu = None
    if inhaber:
        kontakt_snap = db.collection("shops").document(nachher.get("shopId", "")).collection(CONTACTS).document(person_id).get()
        kontakt_neu = kontakt_snap.to_dict() if kontakt_snap.exists else None
    return person_fuers_team(person_id, nachher, kontakt_neu, inhaber)


def person_aktiv(db, person_id: str, aktiv: bool) -> dict:
    """Deaktivieren oder zurückholen; der Team-Vermerk (app/libs/team.py) folgt. Gibt die Person (ohne Kontakte) zurück."""
    ref = db.collection(STAFF).document(person_id)
    snap = ref.get()
    if not snap.exists:
        raise TeamFehler(404, merke("Diese Person gibt es nicht mehr."))
    person = snap.to_dict() or {}
    jetzt = _jetzt()
    ref.set({"isActive": aktiv, "updatedAt": jetzt}, merge=True)
    if person.get("userId") and person.get("shopId"):
        try:
            if aktiv:
                set_member(db, person["shopId"], person["userId"], person_id, jetzt)
            else:
                member_ref(db, person["shopId"], person["userId"]).delete()
        except Exception as e:  # beim nächsten Start gleicht sync_members ab
            print(f"Team-Vermerk für {person_id} nicht geändert: {e}")
    return person_fuers_team(person_id, {**person, "isActive": aktiv, "updatedAt": jetzt}, None, inhaber=False)


# --- Leistungen schreiben ----------------------------------------------------------------------------------------


def _leistung_pruefen(daten: dict, neu: bool) -> None:
    if (neu or "name" in daten) and (not isinstance(daten.get("name"), str) or not daten["name"].strip()):
        raise TeamFehler(400, merke("Bitte gib einen Namen ein."))
    for feld in ("duration", "price", "setupTime"):
        if feld in daten and daten[feld] is not None and (isinstance(daten[feld], bool) or not isinstance(daten[feld], (int, float)) or daten[feld] < 0):
            raise TeamFehler(400, merke("Ungültige Angaben zur Leistung."))
    if neu and not isinstance(daten.get("duration"), (int, float)):
        raise TeamFehler(400, merke("Ungültige Angaben zur Leistung."))
    # Leistungsgruppe für „Läden finden“: leer = automatisch, „keine“ oder eine der festen Gruppen
    if "gruppe" in daten and not leistungsgruppen.gueltig(daten["gruppe"]):
        raise TeamFehler(400, merke("Ungültige Angaben zur Leistung."))


def leistung_anlegen(db, daten: dict) -> dict:
    daten = {k: v for k, v in daten.items() if k not in LEISTUNG_SERVER}
    _leistung_pruefen(daten, neu=True)
    ref = db.collection(SERVICES).document()
    jetzt = _jetzt()
    eintrag = {"id": ref.id, **daten, "createdAt": jetzt, "updatedAt": jetzt}
    ref.set(eintrag)
    return eintrag


def leistung_aendern(db, service_id: str, aenderung: dict) -> dict:
    """Ändern, ausblenden (archived: true) oder wiederherstellen. Der Laden einer Leistung bleibt."""
    ref = db.collection(SERVICES).document(service_id)
    if not ref.get().exists:
        raise TeamFehler(404, merke("Diese Leistung gibt es nicht mehr."))
    aenderung = {k: v for k, v in aenderung.items() if k not in LEISTUNG_SERVER and k != "shopId"}
    _leistung_pruefen(aenderung, neu=False)
    jetzt = _jetzt()
    if aenderung.get("archived") is True:
        aenderung["archivedAt"] = jetzt
    ref.set({**aenderung, "updatedAt": jetzt}, merge=True)
    return {"id": service_id, **(ref.get().to_dict() or {})}
