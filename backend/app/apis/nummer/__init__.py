"""Was Kunden an Nummern und Terminen tun, geht über das Backend: Nummer ziehen, Termin buchen, Platz ändern, absagen,
eine Nummer ohne Konto ins Konto übernehmen. Der Browser eines Kunden schreibt weder Termine noch Belegung oder
Tagesnummern (firestore.rules) – das Backend prüft den Platz frisch nach den Regeln und belegt ihn in einer Transaktion
(app/libs/buchung.py). Ziehen, Buchen und Absagen melden es gleich dem Team (Merker teamNotice, app/libs/team_notify.py).

Den Termin selbst kann ohne Anmeldung niemand lesen; die Nummernseite zeigt nur die öffentliche Kurzfassung
(app/libs/public_appointments.py). Ohne Konto zählt der Schlüssel der Nummer: Der Browser erzeugt ihn, am Termin steht
nur sein Hash (app/libs/ticket.py), der Schlüssel selbst im Link der Nummernseite und im Browser.

POST /nummer/ziehen       {shop_id, service_id, staff_ids, start?, key_hash | Anmeldung, name?, …}   Nummer ziehen
POST /nummer/termin       {shop_id, service_id, staff_ids, start, key_hash + name | Anmeldung, …}   fester Termin
POST /nummer/verschieben  {appointment_id, staff_ids, start, key?} oder Anmeldung     Platz ändern
POST /nummer/absagen      {appointment_id, key?} oder Anmeldung                       Nummer oder Termin absagen
POST /nummer/uebernehmen  {appointment_id, key} + Anmeldung   Nummer ins angemeldete Konto
"""

import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from google.cloud import firestore
from pydantic import BaseModel, Field, field_validator

from app.apis.cache import invalidate_shop_date_cache
from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.i18n import merke, sprache_von
from app.libs.buchung import TRANSACTION_ATTEMPTS, PlatzWeg, create_appointment, pick_reference_code, reference_codes_of_day
from app.libs.online_platz import (MonatVoll, freier_platz, jetzt, leistung_im_laden, monatsgrenze, naechste_plaetze, ortszeit,
                                   person_fuer_leistung, vorlauf_minuten)
from app.libs.plans import has_feature, is_suspended
from app.libs.public_appointments import write_public
from app.libs.schedule import BERLIN, SHOP_DAYS, Placement, aware, day_key, placement_of, read_placement
from app.libs.team_notify import notice_fields
from app.libs.throttle import throttle
from app.libs.ticket import key_matches, may_manage, request_uid

router = APIRouter()

NOT_FOUND = merke("Diese Nummer gibt es nicht.")
WRONG_KEY = merke("Diese Nummer lässt sich hier nicht ändern. Nimm das Handy, mit dem du sie gezogen hast, oder sag am Tresen Bescheid.")
NOT_OPEN = merke("Du bist schon dran oder fertig – sag bitte am Tresen Bescheid.")
NO_SHOP = merke("Diesen Laden gibt es nicht.")
NO_SERVICE = merke("Diese Leistung gibt es hier nicht mehr. Wähl bitte eine andere.")
NO_APPOINTMENTS = merke("Dieser Laden vergibt online keine festen Termine.")
TOO_SOON = merke("Diese Zeit ist zu kurzfristig. Such dir bitte eine spätere aus.")
TAKEN = merke("Diese Zeit ist gerade weggegangen. Such dir bitte eine andere aus.")
SUSPENDED = merke("Dieser Laden nimmt gerade keine Buchungen an.")
NO_STAFF = merke("Bei dieser Person geht das gerade nicht. Wähl bitte eine andere.")
DAY_FULL = merke("An diesem Tag ist kein Platz mehr frei. Such dir bitte einen anderen Tag aus.")
RUSH = merke("Gerade ziehen sehr viele eine Nummer. Versuch es gleich noch einmal.")
MONTH_FULL = merke("Über Dranzeit gehen in diesem Monat keine Nummern mehr. Komm einfach direkt im Laden vorbei.")
NEED_KEY = merke("Ohne Anmeldung fehlt der Schlüssel der Nummer. Lade die Seite neu.")
NEED_NAME = merke("Bitte gib deinen Namen an.")
ID_PATTERN = r"^[A-Za-z0-9_-]+$"


class TicketRequest(BaseModel):
    appointment_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    key: str = Field(min_length=16, max_length=64)


class AbsagenRequest(BaseModel):
    appointment_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    # Nummer ohne Konto: ihr Schlüssel; mit Konto reicht die Anmeldung
    key: Optional[str] = Field(default=None, min_length=16, max_length=64)


def _ticket(tx, ref, key: Optional[str], uid: Optional[str] = None) -> dict:
    """Termin in der Transaktion – eine Nummer ohne Konto mit passendem Schlüssel oder ein Termin des eigenen Kontos"""
    snap = ref.get(transaction=tx)
    if not snap.exists:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    appt = snap.to_dict() or {}
    anonymous = bool(key) and appt.get("isAnonymous") and not appt.get("customerId") and key_matches(appt, key)
    own = bool(uid) and appt.get("customerId") == uid
    if not (anonymous or own):
        raise HTTPException(status_code=403, detail=WRONG_KEY)
    return appt


@router.post("/nummer/absagen")
def cancel_ticket(body: AbsagenRequest, request: Request) -> dict:
    """Nummer zurückgeben oder Termin absagen – mit dem Schlüssel der Nummer oder als eigenes Konto (Nummernseite,
    Meine Termine). Status abgesagt, Platz in der Belegung frei, Kurzfassung mit – in einer Transaktion."""
    throttle(request, "nummer")
    db = get_firestore_db()
    ref = db.collection("appointments").document(body.appointment_id)
    uid = request_uid(request)

    @firestore.transactional
    def run(tx) -> dict:
        appt = _ticket(tx, ref, body.key, uid)
        if appt.get("status") == "cancelled":
            return appt
        if appt.get("status") != "scheduled":
            raise HTTPException(status_code=409, detail=NOT_OPEN)
        release = placement_of(appt)
        change = read_placement(tx, db, body.appointment_id, appt.get("shopId", ""), release=release) if release else None
        now = datetime.now(timezone.utc)
        update = {"status": "cancelled", "updatedAt": now}
        tx.update(ref, {**update, **(notice_fields(appt, "cancelled", now) or {})})
        write_public(tx, db, body.appointment_id, {**appt, **update})
        if change:
            change.write()
        return {**appt, **update, "_cancelled": True}

    appt = run(db.transaction())
    if appt.get("_cancelled"):
        # Inhaber und gebuchte Person bekommen Bescheid (app/libs/team_notify.py)
        from app.libs.notify_worker import wake

        wake()
        # Der Platz ist frei: "Früher dran" gleich neu verteilen (wie requestEarlierSlotCheck in der App)
        try:
            from app.apis.check_slots import trigger_check_in_background

            trigger_check_in_background(appt.get("shopId"), appt.get("staffId"))
        except Exception as e:
            print(f"Früher-dran-Prüfung nach Absage nicht angestoßen: {e}")
    return {"status": "cancelled"}


def _display_name(db, uid: str, email: str | None) -> str:
    """Name wie bisher beim Übernehmen: Anzeigename aus dem Profil, sonst der Teil der E-Mail vor dem @"""
    snap = db.collection("users").document(uid).get()
    profile = (snap.to_dict() or {}) if snap.exists else {}
    mail = profile.get("email") or email or ""
    return (profile.get("displayName") or (mail.split("@")[0] if mail else "") or "Unbekannt").strip()


@router.post("/nummer/uebernehmen")
def claim_ticket(body: TicketRequest, request: Request, user: AuthorizedUser) -> dict:
    """Nummer ohne Konto ins angemeldete Konto: danach unter „Meine Termine“, „Früher dran“ möglich."""
    throttle(request, "nummer")
    db = get_firestore_db()
    ref = db.collection("appointments").document(body.appointment_id)
    name = _display_name(db, user.sub, getattr(user, "email", None))

    @firestore.transactional
    def run(tx) -> None:
        appt = _ticket(tx, ref, body.key)
        update = {"customerId": user.sub, "customerName": name, "isAnonymous": False, "updatedAt": datetime.now(timezone.utc)}
        tx.update(ref, update)
        write_public(tx, db, body.appointment_id, {**appt, **update})

    run(db.transaction())
    return {"status": "ok"}


# --- Fester Termin ohne Konto und Platz ändern --------------------------------------------------------------------------
# Beides über das Backend statt direkt aus dem Browser: Es prüft den Platz frisch nach den Regeln (Öffnungs- und
# Arbeitszeiten, Pausen, Vorlauf, Tarif mit Online-Terminen) und belegt ihn in einer Transaktion mit der Belegung
# (app/libs/buchung.py, wie der Telefon-Assistent). Die Firestore-Regeln bleiben, wie sie sind.

class PlatzRequest(BaseModel):
    # Die gewählte Person; bei „Egal wer“ alle, die zu der Zeit frei sind – gebucht bei der ersten, die noch frei ist
    staff_ids: List[str] = Field(min_length=1, max_length=10)
    start: datetime

    @field_validator("staff_ids")
    @classmethod
    def _ids(cls, value: List[str]) -> List[str]:
        if not all(isinstance(v, str) and 0 < len(v) <= 64 and re.fullmatch(ID_PATTERN, v) for v in value):
            raise ValueError("ungültige Person")
        return list(dict.fromkeys(value))


class TerminRequest(PlatzRequest):
    shop_id: str = Field(min_length=1, max_length=64, pattern=ID_PATTERN)
    service_id: str = Field(min_length=1, max_length=64, pattern=ID_PATTERN)
    # Ohne Konto: Hash des Schlüssels, den der Browser erzeugt hat (utils/ticket-key.ts), und ein Name. Mit Konto
    # kommen Name und Handynummer aus dem Profil.
    key_hash: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    name: Optional[str] = Field(default=None, max_length=60)
    phone: Optional[str] = Field(default=None, max_length=40)
    language: Optional[str] = Field(default=None, max_length=10)
    # „Früher dran“ (nur mit Konto): Wird vorher ein Platz frei, bekommt der Kunde ihn angeboten
    check_earlier: bool = False


class ZiehenRequest(PlatzRequest):
    shop_id: str = Field(min_length=1, max_length=64, pattern=ID_PATTERN)
    service_id: str = Field(min_length=1, max_length=64, pattern=ID_PATTERN)
    # Angezeigter Platz: Die Nummer kommt an diesem Tag auf den frühesten freien (ohne: ab jetzt)
    start: Optional[datetime] = None
    key_hash: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    name: Optional[str] = Field(default=None, max_length=60)
    phone: Optional[str] = Field(default=None, max_length=40)
    language: Optional[str] = Field(default=None, max_length=10)
    check_earlier: bool = False


class VerschiebenRequest(PlatzRequest):
    appointment_id: str = Field(min_length=1, max_length=64, pattern=ID_PATTERN)
    # Nummer ohne Konto: ihr Schlüssel; mit Konto reicht die Anmeldung
    key: Optional[str] = Field(default=None, min_length=16, max_length=64)


def _laden_mit_terminen(db, shop_id: str) -> dict:
    snap = db.collection("shops").document(shop_id).get()
    shop = (snap.to_dict() or {}) if snap.exists else None
    if shop is None:
        raise HTTPException(status_code=404, detail=NO_SHOP)
    if not has_feature(shop, "termine"):
        raise HTTPException(status_code=403, detail=NO_APPOINTMENTS)
    return shop


def _plaetze(db, shop_id: str, shop: dict, service_id: str, staff_ids: List[str], start: datetime) -> List[Placement]:
    """Der gewünschte Platz bei jeder der Personen, bei der er nach den Regeln frei ist – sonst 409"""
    if aware(start) <= datetime.now(timezone.utc) + timedelta(minutes=vorlauf_minuten(shop)):
        raise HTTPException(status_code=409, detail=TOO_SOON)
    plaetze = []
    for staff_id in staff_ids:
        if not person_fuer_leistung(db, shop_id, staff_id, service_id):
            continue
        frei = freier_platz(db, shop_id, service_id, staff_id, start)
        if frei:
            plaetze.append(Placement(staff_id, *frei))
    if not plaetze:
        raise HTTPException(status_code=409, detail=TAKEN)
    return plaetze


def _cache_leeren(shop_id: str, days) -> None:
    for day in days:
        try:
            invalidate_shop_date_cache(shop_id, day, verbose=False)
        except Exception as e:
            print(f"Zwischenspeicher {shop_id} {day} nicht geleert: {e}")


def _frueher_dran_neu(shop_id: str, staff_id: Optional[str]) -> None:
    """Ein Platz ist frei geworden: "Früher dran" gleich neu verteilen (wie nach /nummer/absagen)"""
    try:
        from app.apis.check_slots import trigger_check_in_background

        trigger_check_in_background(shop_id, staff_id)
    except Exception as e:
        print(f"Früher-dran-Prüfung nach dem Verschieben nicht angestoßen: {e}")


def _kunde(db, uid: Optional[str], body) -> dict:
    """Wer bucht: das eigene Konto (Name und Handynummer aus dem Profil) oder ohne Konto mit Schlüssel und Namen"""
    if uid:
        snap = db.collection("users").document(uid).get()
        profile = (snap.to_dict() or {}) if snap.exists else {}
        phone = str(profile.get("phoneNumber") or "").strip()
        return {"customerId": uid, "isAnonymous": False, "customerName": _display_name(db, uid, None),
                **({"customerPhone": phone} if phone else {})}
    if not body.key_hash:
        raise HTTPException(status_code=400, detail=NEED_KEY)
    name, phone = " ".join((body.name or "").split()), (body.phone or "").strip()
    return {"isAnonymous": True, "ticketKeyHash": body.key_hash, "customerName": name or "Unbekannter Kunde",
            **({"customerPhone": phone} if phone else {})}


def _frueher_dran_wunsch(body, uid: Optional[str], now: datetime) -> dict:
    """„Früher dran“ gibt es nur mit Konto – ohne Konto fehlt der Weg, ein Angebot anzunehmen"""
    on = bool(body.check_earlier and uid)
    return {"checkEarlierOptions": on, **({"checkEarlierOptionsCreatedAt": now} if on else {})}


def _nach_dem_anlegen(created: dict) -> None:
    """Freie Zeiten neu rechnen, Team-Nachricht gleich schicken, für „Früher dran“ gleich nach einem Platz suchen"""
    _cache_leeren(created["shopId"], {day_key(created["startTime"])})
    try:
        from app.libs.notify_worker import wake

        wake()
    except Exception as e:
        print(f"Benachrichtigungsdienst nicht geweckt: {e}")
    if created.get("checkEarlierOptions"):
        _frueher_dran_neu(created["shopId"], created.get("staffId"))


@router.post("/nummer/termin")
def book_appointment(body: TerminRequest, request: Request) -> dict:
    """Fester Termin zur Wunschzeit, mit oder ohne Konto. Ohne Konto wie Nummer ziehen ohne Konto (Tagesnummer,
    Schlüssel); mit Konto ohne Tagesnummer, wie bisher aus dem Browser."""
    throttle(request, "nummer")
    db = get_firestore_db()
    uid = request_uid(request)
    if not uid and not (body.name or "").strip():
        raise HTTPException(status_code=422, detail=NEED_NAME)
    kunde = _kunde(db, uid, body)
    shop = _laden_mit_terminen(db, body.shop_id)
    if not leistung_im_laden(db, body.shop_id, body.service_id):
        raise HTTPException(status_code=404, detail=NO_SERVICE)
    plaetze = _plaetze(db, body.shop_id, shop, body.service_id, body.staff_ids, body.start)
    now = datetime.now(timezone.utc)
    data = {
        "shopId": body.shop_id, "serviceId": body.service_id, "status": "scheduled", "type": "booked",
        "language": sprache_von(body.language), **kunde, **_frueher_dran_wunsch(body, uid, now),
        # Inhaber und gebuchte Person bekommen Bescheid wie bei jeder Online-Buchung (app/libs/team_notify.py)
        **notice_fields({}, "new", now),
    }
    try:
        created = create_appointment(db, data, plaetze, needs_code=not uid)
    except PlatzWeg:
        raise HTTPException(status_code=409, detail=TAKEN)
    _nach_dem_anlegen(created)
    wer = "mit Konto" if uid else "ohne Konto"
    print(f"Termin {wer} {created['id']} in {body.shop_id}: {created['startTime']:%d.%m. %H:%M} bei {created['staffId']}")
    return {"appointment_id": created["id"], "reference_code": created.get("referenceCode")}


ZIEHEN_KANDIDATEN = 8   # Plätze zur Auswahl, falls der erste beim Speichern schon weg ist (wie beim Telefon-Assistenten)
ZIEHEN_RUNDEN = 3


@router.post("/nummer/ziehen")
def pull_number(body: ZiehenRequest, request: Request) -> dict:
    """Nummer ziehen, mit oder ohne Konto: frühester freier Platz bei der gewählten Person oder (Egal wer) bei der
    schnellsten – heute hinter der Schlange, an einem späteren angezeigten Tag ab dessen Beginn. Ist der Platz beim
    Speichern schon weg (Ansturm), nimmt die Transaktion den nächsten; doppelt vergeben wird nichts (Belegung,
    app/libs/schedule.py). Geht auch ohne Online-Termine im Tarif, im Gratis-Tarif bis zur Monatsgrenze."""
    throttle(request, "ziehen", max_hits=60)  # Im Laden teilen sich viele ein WLAN und damit eine Adresse
    db = get_firestore_db()
    uid = request_uid(request)
    kunde = _kunde(db, uid, body)
    snap = db.collection("shops").document(body.shop_id).get()
    shop = (snap.to_dict() or {}) if snap.exists else None
    if shop is None:
        raise HTTPException(status_code=404, detail=NO_SHOP)
    if is_suspended(shop):
        raise HTTPException(status_code=403, detail=SUSPENDED)
    if not leistung_im_laden(db, body.shop_id, body.service_id):
        raise HTTPException(status_code=404, detail=NO_SERVICE)
    staff_ids = [s for s in body.staff_ids if person_fuer_leistung(db, body.shop_id, s, body.service_id)]
    if not staff_ids:
        raise HTTPException(status_code=409, detail=NO_STAFF)
    now_local = jetzt()
    try:
        monatsgrenze(db, body.shop_id, shop, now_local)
    except MonatVoll:
        raise HTTPException(status_code=409, detail=MONTH_FULL)
    shown = ortszeit(body.start) if body.start else None
    ab = datetime.combine(shown.date(), datetime.min.time()) if shown and shown.date() > now_local.date() else None
    now = datetime.now(timezone.utc)
    data = {
        "shopId": body.shop_id, "serviceId": body.service_id, "status": "scheduled", "type": "queue",
        "language": sprache_von(body.language), **kunde, **_frueher_dran_wunsch(body, uid, now),
        **notice_fields({}, "new", now),
    }
    created = None
    for _ in range(ZIEHEN_RUNDEN):
        plaetze = naechste_plaetze(db, body.shop_id, shop, body.service_id, staff_ids, now_local, ab, ZIEHEN_KANDIDATEN, 1, nummer=True)
        if not plaetze:
            raise HTTPException(status_code=409, detail=DAY_FULL)
        try:
            created = create_appointment(db, data, [Placement(sid, aware(s), aware(e)) for sid, s, e in plaetze], needs_code=True)
            break
        except PlatzWeg:
            continue
    if created is None:
        raise HTTPException(status_code=409, detail=RUSH)
    _nach_dem_anlegen(created)
    start, end = aware(created["startTime"]), aware(created["endTime"])
    wer = "mit Konto" if uid else "ohne Konto"
    print(f"Nummer {created.get('referenceCode')} {wer} in {body.shop_id}: {start.astimezone(BERLIN):%d.%m. %H:%M} bei {created['staffId']}")
    return {"appointment_id": created["id"], "reference_code": created.get("referenceCode"), "staff_id": created["staffId"],
            "start": start.astimezone(timezone.utc).isoformat(), "end": end.astimezone(timezone.utc).isoformat()}


@router.post("/nummer/verschieben")
def move_ticket(body: VerschiebenRequest, request: Request) -> dict:
    """Platz ändern: Nummer oder Termin auf eine andere Zeit, auch bei einer anderen Person – mit dem Schlüssel der
    Nummer oder dem eigenen Konto. In einer Transaktion: Der alte Platz bleibt belegt, bis der neue sicher ist.
    Danach ist es ein fester Termin; "Früher dran" geht aus (wer eine spätere Zeit wählt, will kein Angebot für früher).
    Wechselt der Tag, bekommt die Nummer die nächste freie Tagesnummer des neuen Tages."""
    throttle(request, "nummer")
    db = get_firestore_db()
    ref = db.collection("appointments").document(body.appointment_id)
    snap = ref.get()
    appt = (snap.to_dict() or {}) if snap.exists else None
    if appt is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    if not may_manage(appt, body.key, request_uid(request)):
        raise HTTPException(status_code=403, detail=WRONG_KEY)
    if appt.get("status") != "scheduled":
        raise HTTPException(status_code=409, detail=NOT_OPEN)
    shop_id = appt.get("shopId", "")
    shop = _laden_mit_terminen(db, shop_id)
    plaetze = _plaetze(db, shop_id, shop, appt.get("serviceId", ""), body.staff_ids, body.start)

    old_start = appt.get("startTime")
    new_day = day_key(plaetze[0].start)
    new_code = bool(appt.get("referenceCode")) and (not isinstance(old_start, datetime) or day_key(old_start) != new_day)
    earlier = reference_codes_of_day(db, shop_id, aware(plaetze[0].start).astimezone(BERLIN).date()) if new_code else []

    @firestore.transactional
    def run(tx) -> dict:
        current_snap = ref.get(transaction=tx)
        current = (current_snap.to_dict() or {}) if current_snap.exists else None
        if current is None:
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        if current.get("status") != "scheduled":
            raise HTTPException(status_code=409, detail=NOT_OPEN)
        chosen, change = None, None
        for place in plaetze:
            change = read_placement(tx, db, body.appointment_id, shop_id, occupy=place, release=placement_of(current))
            if not change.conflict:
                chosen = place
                break
        if chosen is None:
            raise HTTPException(status_code=409, detail=TAKEN)
        numbers_ref = db.collection(SHOP_DAYS).document(f"{shop_id}_{new_day}") if new_code else None
        numbers = numbers_ref.get(transaction=tx) if numbers_ref else None
        codes = list(((numbers.to_dict() or {}).get("codes") or []) if numbers is not None and numbers.exists else [])
        now = datetime.now(timezone.utc)
        update = {"startTime": chosen.start, "endTime": chosen.end, "staffId": chosen.staff_id, "type": "booked",
                  "checkEarlierOptions": False, "updatedAt": now}
        if numbers_ref is not None:
            update["referenceCode"] = pick_reference_code(set(earlier) | set(codes))
        tx.update(ref, update)
        write_public(tx, db, body.appointment_id, {**current, **update})
        change.write()
        if numbers_ref is not None:
            tx.set(numbers_ref, {"shopId": shop_id, "day": new_day, "codes": codes + [update["referenceCode"]], "updatedAt": now})
        return {**current, **update}

    moved = run(db.transaction(max_attempts=TRANSACTION_ATTEMPTS))
    days = {new_day} | ({day_key(old_start)} if isinstance(old_start, datetime) else set())
    _cache_leeren(shop_id, days)
    # Offene Angebote für früher galten der alten Zeit; den frei gewordenen Platz bekommen andere
    try:
        offers = (db.collection("earlier_slot_notifications").where("appointmentId", "==", body.appointment_id)
                  .where("isAccepted", "==", False).stream())
        for offer in offers:
            offer.reference.delete()
    except Exception as e:
        print(f"Angebote zu {body.appointment_id} nicht entfernt: {e}")
    _frueher_dran_neu(shop_id, appt.get("staffId"))
    print(f"Platz geändert: {body.appointment_id} von {old_start} auf {moved['startTime']} bei {moved['staffId']}")
    return {"status": "ok", "start": aware(moved["startTime"]).isoformat(), "staff_id": moved["staffId"],
            "reference_code": moved.get("referenceCode")}
