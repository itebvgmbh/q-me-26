"""Nummer ohne Konto zurückgeben oder ins eigene Konto übernehmen – nur mit dem Schlüssel der Nummer. Zurückgeben meldet
das Backend gleich dem Team (Merker teamNotice, app/libs/team_notify.py).

Den Termin selbst kann ohne Anmeldung niemand lesen oder ändern (firestore.rules); die Nummernseite zeigt nur die
öffentliche Kurzfassung (app/libs/public_appointments.py). Wer die Nummer gezogen hat, hat ihren Schlüssel (im Link
der Nummernseite und im Browser), am Termin steht nur der Hash (app/libs/ticket.py).

POST /nummer/absagen      {appointment_id, key}               ohne Anmeldung
POST /nummer/uebernehmen  {appointment_id, key} + Anmeldung   Nummer ins angemeldete Konto
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from google.cloud import firestore
from pydantic import BaseModel, Field

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.i18n import merke
from app.libs.public_appointments import write_public
from app.libs.schedule import placement_of, read_placement
from app.libs.team_notify import notice_fields
from app.libs.throttle import throttle
from app.libs.ticket import key_matches

router = APIRouter()

NOT_FOUND = merke("Diese Nummer gibt es nicht.")
WRONG_KEY = merke("Diese Nummer lässt sich hier nicht ändern. Nimm das Handy, mit dem du sie gezogen hast, oder sag am Tresen Bescheid.")


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
            raise HTTPException(status_code=409, detail="Du bist schon dran oder fertig – sag bitte am Tresen Bescheid.")
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
