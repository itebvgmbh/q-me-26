"""„Früher dran“ selbst schalten: Kunden schalten es unter „Meine Termine“ für einen kommenden Termin ein oder aus.

Gebraucht vor allem für Termine, die der Laden eingetragen hat: Dort fehlt der Haken, den man beim Buchen oder
Nummer-Ziehen setzt (checkEarlierOptions). Seit dem Kunden-Link /activate (customer_activation) stehen diese Termine
im Konto der Person – hier kann sie ihn nachholen.

Geprüft wird im Backend, nicht im Browser: nur der eigene Termin (customerId = Konto), nur gebucht und noch nicht
angefangen, Einschalten nur, wenn der Tarif des Ladens „Früher dran“ enthält (app/libs/plans.py). Danach läuft die
Angebotsprüfung sofort (check_slots): Ein offenes Angebot verschwindet beim Ausschalten, und der Platz geht weiter.
"""

import re
from datetime import datetime

from fastapi import APIRouter, HTTPException
from google.cloud import firestore as gcf
from pydantic import BaseModel

from app.apis.check_slots import trigger_check_in_background
from app.apis.firebase_utils import get_firestore_db
from app.apis.utils import convert_timestamp_to_datetime
from app.auth import AuthorizedUser
from app.i18n import merke
from app.libs.plans import has_feature

router = APIRouter()

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
NOT_FOUND = merke("Diesen Termin gibt es nicht mehr.")


class FrueherDranRequest(BaseModel):
    an: bool


@router.post("/frueher-dran/{appointment_id}")
def set_frueher_dran(appointment_id: str, body: FrueherDranRequest, user: AuthorizedUser) -> dict:
    """„Früher dran“ für einen eigenen, kommenden Termin ein- oder ausschalten"""
    if not ID_RE.fullmatch(appointment_id or ""):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    db = get_firestore_db()
    snap = db.collection("appointments").document(appointment_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    appt = snap.to_dict() or {}
    if not appt.get("customerId") or appt.get("customerId") != user.sub:
        raise HTTPException(status_code=403, detail="Das ist nicht dein Termin.")

    current = appt.get("checkEarlierOptions") is True
    if body.an == current:
        return {"checkEarlierOptions": current}

    if body.an:
        start = convert_timestamp_to_datetime(appt.get("startTime"))
        if appt.get("status") != "scheduled" or not start or start <= datetime.now():
            raise HTTPException(status_code=409, detail="Für diesen Termin geht „Früher dran“ nicht mehr: Er hat schon angefangen oder ist abgesagt.")
        shop = db.collection("shops").document(appt.get("shopId") or "-").get()
        if not shop.exists or not has_feature(shop.to_dict() or {}, "frueherDran"):
            raise HTTPException(status_code=403, detail="Dieser Laden bietet „Früher dran“ gerade nicht an.")
        changes = {"checkEarlierOptions": True, "checkEarlierOptionsCreatedAt": gcf.SERVER_TIMESTAMP}
    else:
        # Ausschalten geht immer – auch wenn der Laden den Tarif inzwischen gewechselt hat
        changes = {"checkEarlierOptions": False, "checkEarlierOptionsCreatedAt": gcf.DELETE_FIELD}

    snap.reference.update({**changes, "updatedAt": gcf.SERVER_TIMESTAMP})
    # Gleich prüfen: Einschalten kann sofort ein Angebot bringen, Ausschalten gibt ein reserviertes Angebot frei
    trigger_check_in_background(appt.get("shopId"), appt.get("staffId"))
    return {"checkEarlierOptions": body.an}
