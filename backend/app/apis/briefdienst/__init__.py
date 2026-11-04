"""Webhook von PIN eBrief (requirements/briefversand.md, Stufe B), ohne Anmeldung:

    POST /routes/briefdienst/webhook/{geheimnis}    PIN meldet, dass sich der Stand eines Auftrags geändert hat

PIN schickt bei jeder Änderung den Auftrag wie bei GET /Jobs/{id}. Die Adresse samt Geheimnis (QME_PIN_WEBHOOK_GEHEIMNIS in
/etc/q-me.env) trägt der PIN-Support ein. Dem Inhalt trauen wir trotzdem nicht: Dranzeit fragt den Stand des Auftrags mit den
eigenen Zugangsdaten selbst ab (app/libs/briefaktion.py, auftrag_aktualisieren). Unbekannte Aufträge bekommen trotzdem 200,
sonst wiederholt PIN die Meldung immer wieder.
"""

import hmac
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from app.libs import briefaktion

router = APIRouter()


def _auftraege(daten) -> list:
    """Auftragsnummern aus der Meldung: ein Auftrag {Id} oder {Jobs: [...]} bzw. {Result: {Jobs: [...]}}"""
    if not isinstance(daten, dict):
        return []
    jobs = daten.get("Jobs") or (daten.get("Result") or {}).get("Jobs") or ([daten] if daten.get("Id") else [])
    return [str(j["Id"]) for j in jobs if isinstance(j, dict) and str(j.get("Id", "")).isdigit()][:50]


@router.post("/briefdienst/webhook/{geheimnis}")
async def webhook(geheimnis: str, request: Request) -> dict:
    soll = os.environ.get("QME_PIN_WEBHOOK_GEHEIMNIS", "")
    if not soll or not hmac.compare_digest(geheimnis.encode(), soll.encode()):
        raise HTTPException(status_code=403, detail="Unbekannt.")
    try:
        daten = await request.json()
    except ValueError:
        daten = {}
    for auftrag in _auftraege(daten):
        try:
            await run_in_threadpool(briefaktion.auftrag_aktualisieren, auftrag)
        except Exception as e:  # PIN soll trotzdem 200 sehen; der regelmäßige Abgleich holt es nach
            print(f"Briefe: Webhook für Auftrag {auftrag} nicht verarbeitet: {e}")
    return {"ok": True}
