"""
Eingang des Telefon-Assistenten: Twilio fragt hier bei jedem Anruf, was passieren soll, bevor jemand abnimmt.

    POST /telefon-eingang          Antwort als TwiML: Assistent, kurze Ansage oder abweisen (kostet nichts)
    POST /telefon-eingang/status   Twilio meldet das Ende eines Anrufs, die Gesprächszeit zählt beim Laden

Welcher Laden: Bei einer Umleitung ist "From" der Anrufer, die Nummer des Ladens steht in "ForwardedFrom". Hat ein
Laden eine eigene Nummer (telefon_leitungen), gilt die gewählte Nummer "To". Die Regeln stehen in app/libs/telefon.py,
die Daten je Laden in app/libs/telefon_laeden.py.

Der Assistent kommt von Vapi: POST /call mit phoneCallProviderBypassEnabled liefert das TwiML für Twilio, der Laden
geht als Variable laden_id mit (die Werkzeuge in app/apis/telefon schicken sie zurück).

Zugang: Twilio unterschreibt jede Anfrage (X-Twilio-Signature) mit QME_TWILIO_AUTH_TOKEN aus /etc/q-me.env.
Dazu QME_VAPI_API_KEY, QME_VAPI_ASSISTANT_ID und QME_VAPI_PHONE_NUMBER_ID. Einrichtung: deploy/telefon-assistent.md.
"""
import json
import logging
import os
from typing import Optional

import requests
from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool

from app.apis.firebase_utils import get_firestore_db
from app.apis.telefon import laden_daten
from app.libs import telefon as t
from app.libs import telefon_laeden as tl
from app.libs.plans import has_feature, is_suspended

log = logging.getLogger(__name__)

router = APIRouter()

VAPI_CALL = "https://api.vapi.ai/call"
VAPI_TIMEOUT = (3, 8)  # Twilio wartet höchstens 15 Sekunden auf die Antwort


def _basis() -> str:
    return (os.environ.get("PUBLIC_URL", "").strip() or "https://dranzeit.de").rstrip("/")


async def _von_twilio(request: Request, pfad: str, signatur: Optional[str]) -> dict:
    """Formularfelder der Anfrage, wenn sie wirklich von Twilio kommt"""
    token = os.environ.get("QME_TWILIO_AUTH_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="Telefon-Eingang ist nicht eingerichtet (QME_TWILIO_AUTH_TOKEN fehlt).")
    felder = {name: str(wert) for name, wert in (await request.form()).items()}
    if not t.twilio_signatur_ok(f"{_basis()}/routes{pfad}", felder, signatur, token):
        raise HTTPException(status_code=403, detail="Kein Zugang.")
    return felder


def _assistent(shop_id: str, name: str, begruessung: str, daten: str, anrufer: Optional[str]) -> str:
    """TwiML von Vapi, das den Anruf zum Assistenten dieses Ladens verbindet"""
    body: dict = {
        "phoneNumberId": os.environ["QME_VAPI_PHONE_NUMBER_ID"],
        "assistantId": os.environ["QME_VAPI_ASSISTANT_ID"],
        "phoneCallProviderBypassEnabled": True,
        "assistantOverrides": {"firstMessage": begruessung, "variableValues": {"laden_id": shop_id, "laden_name": name, "laden_daten": daten}},
    }
    if anrufer:
        body["customer"] = {"number": anrufer}
    antwort = requests.post(VAPI_CALL, json=body, headers={"Authorization": f"Bearer {os.environ['QME_VAPI_API_KEY']}"}, timeout=VAPI_TIMEOUT)
    antwort.raise_for_status()
    return antwort.json()["phoneCallProviderDetails"]["twiml"]


def _welcher_laden(db, gewaehlt: Optional[str], umleitung: Optional[str]) -> tuple:
    """(Laden-ID, Eintrag, kam über die Ladennummer) oder (None, {}, False)"""
    if gewaehlt:
        snap = db.collection(t.LEITUNGEN).document(gewaehlt).get()
        shop_id = (snap.to_dict() or {}).get("shopId") if snap.exists else None
        if shop_id:
            return shop_id, tl.eintrag(db, shop_id), False
    if umleitung:
        shop_id, daten = tl.zum_anschluss(db, umleitung)
        if shop_id:
            return shop_id, daten, True
    return None, {}, False


def _antwort(felder: dict) -> str:
    db = get_firestore_db()
    umleitung = t.e164(felder.get("ForwardedFrom")) or t.e164(felder.get("CalledVia"))
    shop_id, daten, ueber_anschluss = _welcher_laden(db, t.e164(felder.get("To")), umleitung)
    if not shop_id:
        return t.twiml_abweisen()
    snap = db.collection("shops").document(shop_id).get()
    shop = (snap.to_dict() or {}) if snap.exists else None
    if shop is None:
        return t.twiml_abweisen()
    name = shop.get("name") or "diesem Laden"
    if ueber_anschluss and daten.get("freigegeben") and daten.get("status") != "aktiv":
        tl.probeanruf(db, shop_id)
    if t.entscheiden(daten, is_suspended(shop)) != t.ANNEHMEN:
        return t.twiml_ansage(t.ansage_text(name))
    namen = [s["name"] for s in tl.leistungen(db, shop_id) if s["name"]]
    begruessung = t.begruessung(name, namen, has_feature(shop, "termine"))
    twiml = _assistent(shop_id, name, begruessung, json.dumps(laden_daten(db, shop_id, shop), ensure_ascii=False), t.e164(felder.get("From")))
    if felder.get("CallSid"):
        tl.anruf_merken(db, felder["CallSid"], shop_id)
    return twiml


def _sicher(felder: dict) -> str:
    """Twilio sagt bei einem Fehler auf Englisch „application error“ – der Anrufer soll etwas Verständliches hören"""
    try:
        return _antwort(felder)
    except Exception:
        log.exception("Telefon-Eingang: Anruf %s nicht verbunden", felder.get("CallSid"))
        return t.twiml_ansage(t.STOERUNG)


@router.post("/telefon-eingang", include_in_schema=False)
async def eingang(request: Request, x_twilio_signature: Optional[str] = Header(default=None)) -> Response:
    felder = await _von_twilio(request, "/telefon-eingang", x_twilio_signature)
    return Response(content=await run_in_threadpool(_sicher, felder), media_type="text/xml")


def _ende(felder: dict) -> None:
    try:
        tl.anruf_ende(get_firestore_db(), felder.get("CallSid", ""), int(felder.get("CallDuration") or 0))
    except Exception:
        log.exception("Telefon-Eingang: Ende von Anruf %s nicht gezählt", felder.get("CallSid"))


@router.post("/telefon-eingang/status", include_in_schema=False)
async def status(request: Request, x_twilio_signature: Optional[str] = Header(default=None)) -> Response:
    felder = await _von_twilio(request, "/telefon-eingang/status", x_twilio_signature)
    if felder.get("CallStatus") in t.ANRUF_ZU_ENDE and felder.get("CallSid"):
        await run_in_threadpool(_ende, felder)
    return Response(status_code=204)
