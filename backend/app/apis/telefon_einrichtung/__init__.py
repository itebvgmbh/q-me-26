"""
Telefon-Assistent einrichten und zubuchen (/telefon-assistent). Nur der Inhaber des Ladens.

    GET  /telefon-einrichtung/{shop_id}             Stand: Testminuten, Zusatz, Verbrauch, Nummern, Probeanruf
    POST /telefon-einrichtung/{shop_id}             einschalten, ausschalten, Nummer ändern
    POST /telefon-einrichtung/{shop_id}/testen      30 Testminuten selbst starten (sobald der Betreiber für alle geöffnet hat)
    POST /telefon-einrichtung/{shop_id}/deckel      Kostendeckel je Monat in Euro netto
    POST /telefon-einrichtung/{shop_id}/buchen      Zusatz buchen: Stripe Checkout für ein eigenes Monatsabo
    POST /telefon-einrichtung/{shop_id}/kuendigen   zum Monatsende kündigen oder die Kündigung zurücknehmen

Den Probeanruf erkennt der Eingang (app/apis/telefon_eingang), die Daten stehen in app/libs/telefon_laeden.py, die
Abrechnung in app/libs/telefon_abrechnung.py. Den Stand des Abos schreibt der Stripe-Webhook.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.apis.billing import _require_stripe, known_customer, stripe_errors, _portal_url
from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.i18n import merke
from app.libs import telefon as t
from app.libs import telefon_abrechnung as ta
from app.libs import telefon_laeden as tl
from app.libs.links import public_origin
from app.libs.shop_privat import stripe_link
from app.libs.stripe_billing import client, price_id

router = APIRouter()


class Einstellung(BaseModel):
    aktiv: bool
    anschluss: str = ""


class Deckel(BaseModel):
    deckel: int


class Kuendigung(BaseModel):
    zurueck: bool = False  # True: Kündigung zurücknehmen


def _laden(db, shop_id: str) -> dict:
    snap = db.collection("shops").document(shop_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail=merke("Diesen Laden gibt es nicht."))
    return snap.to_dict() or {}


def _ausfuehren(aufruf) -> None:
    try:
        aufruf()
    except tl.Abgelehnt as nein:
        raise HTTPException(status_code=nein.status, detail=nein.text) from nein


@router.get("/telefon-einrichtung/{shop_id}")
def ansehen(shop_id: str, user: AuthorizedUser) -> dict:
    require_shop_of_owner(user, shop_id)
    db = get_firestore_db()
    return tl.stand(db, shop_id, _laden(db, shop_id))


@router.post("/telefon-einrichtung/{shop_id}")
def speichern(shop_id: str, body: Einstellung, user: AuthorizedUser) -> dict:
    require_shop_of_owner(user, shop_id)
    db = get_firestore_db()
    shop = _laden(db, shop_id)
    _ausfuehren(lambda: tl.einstellen(db, shop_id, body.aktiv, body.anschluss))
    return tl.stand(db, shop_id, shop)


@router.post("/telefon-einrichtung/{shop_id}/testen")
def testen(shop_id: str, user: AuthorizedUser) -> dict:
    require_shop_of_owner(user, shop_id)
    db = get_firestore_db()
    shop = _laden(db, shop_id)
    _ausfuehren(lambda: tl.testen(db, shop_id, shop))
    return tl.stand(db, shop_id, shop)


@router.post("/telefon-einrichtung/{shop_id}/deckel")
def deckel(shop_id: str, body: Deckel, user: AuthorizedUser) -> dict:
    require_shop_of_owner(user, shop_id)
    db = get_firestore_db()
    shop = _laden(db, shop_id)
    if not tl.zugelassen(tl.eintrag(db, shop_id)):
        raise HTTPException(status_code=403, detail=merke("Der Telefon-Assistent ist für diesen Laden noch nicht freigeschaltet."))
    _ausfuehren(lambda: tl.deckel_setzen(db, shop_id, body.deckel))
    ta.melden(db, shop_id)  # höherer Deckel: was über dem alten lag, zählt jetzt mit
    return tl.stand(db, shop_id, shop)


@router.post("/telefon-einrichtung/{shop_id}/buchen")
@stripe_errors
def buchen(shop_id: str, user: AuthorizedUser, request: Request) -> dict:
    """Stripe Checkout für den Zusatz. Ist er schon gebucht, geht es ins Kundenportal (Zahlungsart, Rechnungen)."""
    require_shop_of_owner(user, shop_id)
    db = get_firestore_db()
    shop = _laden(db, shop_id)
    stand = tl.stand(db, shop_id, shop)
    if stand["gesperrt"]:
        raise HTTPException(status_code=403, detail=merke("Der Telefon-Assistent ist für diesen Laden gesperrt. Schreib uns an hilfe@dranzeit.de."))
    if not stand["offen"] and not stand["freigegeben"]:
        raise HTTPException(status_code=403, detail=merke("Der Telefon-Assistent ist für diesen Laden noch nicht freigeschaltet."))
    if not stand["abo"]:
        raise HTTPException(status_code=409, detail=merke("Den Telefon-Assistenten gibt es zu einem Abo ab Solo. Wähl zuerst unter „Tarif“ ein Abo."))
    mode = stripe_link(db, shop_id, shop)[0]  # Testmodus: Sandbox (Betreiber-Bereich)
    _require_stripe(mode)
    c = client(mode)
    customer_id = known_customer(c, db, shop_id, shop, mode)
    if not customer_id:
        raise HTTPException(status_code=409, detail=merke("Den Telefon-Assistenten gibt es zu einem Abo ab Solo. Wähl zuerst unter „Tarif“ ein Abo."))
    base = public_origin(request)
    if (stand["zusatz"] or {}).get("status") in (*t.GEBUCHT, *t.ZAHLUNG_OFFEN):
        return {"url": _portal_url(c, customer_id, base, mode)}
    session = c.v1.checkout.sessions.create(
        params={
            "mode": "subscription",
            "customer": customer_id,
            "client_reference_id": shop_id,
            "line_items": [
                {"price": price_id(c, ta.GRUNDPREIS_KEY, mode), "quantity": 1},
                {"price": price_id(c, ta.MINUTEN_KEY, mode)},  # nach Nutzung: ohne Menge
            ],
            "subscription_data": {"metadata": {"shopId": shop_id, "zusatz": ta.ZUSATZ}, "description": "Dranzeit Telefon-Assistent"},
            "metadata": {"shopId": shop_id, "zusatz": ta.ZUSATZ},
            "automatic_tax": {"enabled": True},
            "tax_id_collection": {"enabled": True},
            "billing_address_collection": "required",
            "customer_update": {"address": "auto", "name": "auto"},
            "locale": "de",
            "success_url": f"{base}/telefon-assistent?gebucht=1",
            "cancel_url": f"{base}/telefon-assistent",
        }
    )
    return {"url": session.url}


@router.post("/telefon-einrichtung/{shop_id}/kuendigen")
@stripe_errors
def kuendigen(shop_id: str, body: Kuendigung, user: AuthorizedUser) -> dict:
    """Zum Ende des laufenden Monats kündigen (bis dahin nimmt er ab) oder die Kündigung zurücknehmen"""
    require_shop_of_owner(user, shop_id)
    db = get_firestore_db()
    shop = _laden(db, shop_id)
    z = t.zusatz(tl.eintrag(db, shop_id))
    if z.get("status") not in (*t.GEBUCHT, *t.ZAHLUNG_OFFEN) or not z.get("subscriptionId"):
        raise HTTPException(status_code=409, detail=merke("Der Telefon-Assistent ist nicht gebucht."))
    mode = z.get("modus") or "live"
    _require_stripe(mode)
    sub = client(mode).v1.subscriptions.update(z["subscriptionId"], params={"cancel_at_period_end": not body.zurueck})
    ta.uebernehmen(db, sub.to_dict(), mode)
    return tl.stand(db, shop_id, shop)
