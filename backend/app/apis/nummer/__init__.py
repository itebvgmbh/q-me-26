"""Nummer ohne Konto zurückgeben oder ins eigene Konto übernehmen – nur mit dem Schlüssel der Nummer. Zurückgeben meldet
das Backend gleich dem Team (Merker teamNotice, app/libs/team_notify.py).

Den Termin selbst kann ohne Anmeldung niemand lesen oder ändern (firestore.rules); die Nummernseite zeigt nur die
öffentliche Kurzfassung (app/libs/public_appointments.py). Wer die Nummer gezogen hat, hat ihren Schlüssel (im Link
der Nummernseite und im Browser), am Termin steht nur der Hash (app/libs/ticket.py).

POST /nummer/absagen      {appointment_id, key}               ohne Anmeldung
POST /nummer/uebernehmen  {appointment_id, key} + Anmeldung   Nummer ins angemeldete Konto
POST /nummer/termin       {shop_id, service_id, staff_ids, start, key_hash, name, …}   fester Termin ohne Konto
POST /nummer/verschieben  {appointment_id, staff_ids, start, key?} oder Anmeldung     Platz ändern
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
from app.libs.online_platz import freier_platz, leistung_im_laden, person_fuer_leistung, vorlauf_minuten
from app.libs.plans import has_feature
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
ID_PATTERN = r"^[A-Za-z0-9_-]+$"


class TicketRequest(BaseModel):
    appointment_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    key: str = Field(min_length=16, max_length=64)


def _ticket(tx, ref, key: str) -> dict:
    """Termin der Nummer in der Transaktion – nur, wenn es eine Nummer ohne Konto ist und der Schlüssel passt"""
    snap = ref.get(transaction=tx)
    if not snap.exists:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    appt = snap.to_dict() or {}
    if not appt.get("isAnonymous") or appt.get("customerId") or not key_matches(appt, key):
        raise HTTPException(status_code=403, detail=WRONG_KEY)
    return appt


@router.post("/nummer/absagen")
def cancel_ticket(body: TicketRequest, request: Request) -> dict:
    """Nummer zurückgeben: Status abgesagt, Platz in der Belegung frei, Kurzfassung mit – in einer Transaktion."""
    throttle(request, "nummer")
    db = get_firestore_db()
    ref = db.collection("appointments").document(body.appointment_id)

    @firestore.transactional
    def run(tx) -> dict:
        appt = _ticket(tx, ref, body.key)
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
    # Hash des Schlüssels, den der Browser erzeugt hat (utils/ticket-key.ts); der Schlüssel selbst bleibt dort
    key_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    name: str = Field(min_length=1, max_length=60)
    phone: Optional[str] = Field(default=None, max_length=40)
    language: Optional[str] = Field(default=None, max_length=10)


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


@router.post("/nummer/termin")
def book_without_account(body: TerminRequest, request: Request) -> dict:
    """Fester Termin ohne Konto: wie Nummer ziehen ohne Konto (Tagesnummer, Schlüssel), aber zur Wunschzeit."""
    throttle(request, "nummer")
    db = get_firestore_db()
    shop = _laden_mit_terminen(db, body.shop_id)
    if not leistung_im_laden(db, body.shop_id, body.service_id):
        raise HTTPException(status_code=404, detail=NO_SERVICE)
    plaetze = _plaetze(db, body.shop_id, shop, body.service_id, body.staff_ids, body.start)
    phone = (body.phone or "").strip()
    data = {
        "shopId": body.shop_id, "serviceId": body.service_id, "status": "scheduled", "type": "booked", "isAnonymous": True,
        "ticketKeyHash": body.key_hash, "customerName": " ".join(body.name.split()), "language": sprache_von(body.language),
        "checkEarlierOptions": False, **({"customerPhone": phone} if phone else {}),
        # Inhaber und gebuchte Person bekommen Bescheid wie bei jeder Online-Buchung (app/libs/team_notify.py)
        **notice_fields({}, "new", datetime.now(timezone.utc)),
    }
    try:
        created = create_appointment(db, data, plaetze, needs_code=True)
    except PlatzWeg:
        raise HTTPException(status_code=409, detail=TAKEN)
    _cache_leeren(body.shop_id, {day_key(created["startTime"])})
    print(f"Termin ohne Konto {created['id']} in {body.shop_id}: {created['startTime']:%d.%m. %H:%M} bei {created['staffId']}")
    return {"appointment_id": created["id"], "reference_code": created.get("referenceCode")}


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
