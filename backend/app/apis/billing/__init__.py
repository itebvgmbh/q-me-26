"""Tarif und Abo eines Ladens: Abo abschließen (Stripe Checkout), verwalten (Kundenportal), Gründerangebot.

Nur Inhaber des Ladens. Der Stand des Abos kommt über den Webhook (app/apis/stripe_webhook) an den Laden.
"""

import functools
import os
from datetime import datetime, timedelta, timezone

import stripe

from fastapi import APIRouter, HTTPException, Request
from google.cloud import firestore as gcf
from pydantic import BaseModel

from app.apis.firebase_utils import get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import require_shop_of_owner
from app.libs.plans import FOUNDER_LIMIT, FOUNDER_TRIAL_DAYS, PAID_PLANS, trial_end
from app.libs.stripe_billing import INTERVALS, client, lookup_key, price_id, stripe_configured

router = APIRouter()

FOUNDERS_DOC = ("meta", "gruender")
ALLOWED_ORIGINS = ("https://dranzeit.de", "https://www.dranzeit.de", "https://q-me.spielmacherei.de", "http://localhost:5173")
ACTIVE = ("active", "trialing", "past_due")


def _origin(request: Request) -> str:
    """Zurück zur Seite, von der der Inhaber kam – nur bekannte Adressen."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin in ALLOWED_ORIGINS:
        return origin
    return (os.environ.get("PUBLIC_URL", "").strip() or "https://dranzeit.de").rstrip("/")


def _shop(shop_id: str) -> dict:
    doc = get_firestore_db().collection("shops").document(shop_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Laden nicht gefunden.")
    return doc.to_dict() or {}


def stripe_errors(fn):
    """Fehler von Stripe verständlich melden. Im Testmodus mit Stripes eigener Meldung (hilft beim Einrichten)."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except stripe.StripeError as e:
            print(f"Stripe-Fehler in {fn.__name__}: {e}")
            test_mode = "_test_" in os.environ.get("STRIPE_SECRET_KEY", "")
            detail = f"Stripe meldet: {e.user_message or str(e)}" if test_mode else "Die Bezahlung klappt gerade nicht. Bitte versuch es später noch einmal."
            raise HTTPException(status_code=502, detail=detail) from e
        except RuntimeError as e:  # z. B. Preis fehlt, weil stripe-setup.py noch nicht lief
            print(f"Abrechnung nicht bereit in {fn.__name__}: {e}")
            raise HTTPException(status_code=503, detail="Die Bezahlung ist noch nicht fertig eingerichtet. Schreib uns, wir schalten dich frei.") from e

    return wrapper


def _require_stripe() -> None:
    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Die Bezahlung ist noch nicht eingerichtet. Schreib uns, wir schalten dich frei.")


class CheckoutRequest(BaseModel):
    shop_id: str
    plan: str
    interval: str = "monat"


@router.post("/billing/checkout")
@stripe_errors
def checkout(body: CheckoutRequest, user: AuthorizedUser, request: Request) -> dict:
    """Stripe-Checkout für ein Abo. Läuft schon eins, geht es ins Kundenportal (Tarif wechseln dort)."""
    require_shop_of_owner(user, body.shop_id)
    if body.plan not in PAID_PLANS or body.interval not in INTERVALS:
        raise HTTPException(status_code=400, detail="Unbekannter Tarif.")
    _require_stripe()
    shop = _shop(body.shop_id)
    billing = shop.get("billing") or {}
    base = _origin(request)
    c = client()

    if billing.get("status") in ACTIVE and billing.get("customerId"):
        return {"url": _portal_url(c, billing["customerId"], base)}

    customer_id = billing.get("customerId")
    if not customer_id:
        customer = c.v1.customers.create(
            params={
                "email": user.email or None,
                "name": shop.get("name") or None,
                "preferred_locales": ["de"],
                "metadata": {"shopId": body.shop_id, "ownerUid": user.sub},
            }
        )
        customer_id = customer.id
        get_firestore_db().collection("shops").document(body.shop_id).update({"billing.customerId": customer_id})

    founder = bool(shop.get("founder"))
    subscription_data: dict = {"metadata": {"shopId": body.shop_id}}
    # Restliche Testphase übernehmen: bezahlt wird erst danach (Stripe verlangt mind. 48 h Vorlauf)
    trial_until = trial_end(shop)
    if trial_until > datetime.now(timezone.utc) + timedelta(hours=49):
        subscription_data["trial_end"] = int(trial_until.timestamp())

    session = c.v1.checkout.sessions.create(
        params={
            "mode": "subscription",
            "customer": customer_id,
            "client_reference_id": body.shop_id,
            "line_items": [{"price": price_id(c, lookup_key(body.plan, body.interval, founder)), "quantity": 1}],
            "subscription_data": subscription_data,
            "metadata": {"shopId": body.shop_id},
            "automatic_tax": {"enabled": True},
            "tax_id_collection": {"enabled": True},
            "billing_address_collection": "required",
            "customer_update": {"address": "auto", "name": "auto"},
            "allow_promotion_codes": True,
            "locale": "de",
            "success_url": f"{base}/tarif?erfolg=1",
            "cancel_url": f"{base}/tarif",
        }
    )
    return {"url": session.url}


def _portal_url(c, customer_id: str, base: str) -> str:
    params = {"customer": customer_id, "return_url": f"{base}/tarif", "locale": "de"}
    config = os.environ.get("STRIPE_PORTAL_CONFIG", "").strip()
    if config:
        params["configuration"] = config
    return c.v1.billing_portal.sessions.create(params=params).url


class ShopRequest(BaseModel):
    shop_id: str


@router.post("/billing/portal")
@stripe_errors
def portal(body: ShopRequest, user: AuthorizedUser, request: Request) -> dict:
    """Kundenportal: Tarif wechseln, Zahlungsart ändern, Rechnungen, kündigen."""
    require_shop_of_owner(user, body.shop_id)
    _require_stripe()
    customer_id = (_shop(body.shop_id).get("billing") or {}).get("customerId")
    if not customer_id:
        raise HTTPException(status_code=409, detail="Für diesen Laden gibt es noch kein Abo.")
    return {"url": _portal_url(client(), customer_id, _origin(request))}


def founders_left() -> int:
    doc = get_firestore_db().collection(FOUNDERS_DOC[0]).document(FOUNDERS_DOC[1]).get()
    count = int((doc.to_dict() or {}).get("count", 0)) if doc.exists else 0
    return max(0, FOUNDER_LIMIT - count)


@router.post("/billing/claim-founder")
def claim_founder(body: ShopRequest, user: AuthorizedUser) -> dict:
    """Gründerangebot sichern: 3 Monate gratis, danach Laden zum Gründerpreis. Solange Plätze frei sind."""
    require_shop_of_owner(user, body.shop_id)
    db = get_firestore_db()
    shop_ref = db.collection("shops").document(body.shop_id)
    counter_ref = db.collection(FOUNDERS_DOC[0]).document(FOUNDERS_DOC[1])

    @gcf.transactional
    def claim(transaction) -> int:
        shop = shop_ref.get(transaction=transaction).to_dict() or {}
        counter = counter_ref.get(transaction=transaction).to_dict() or {}
        count = int(counter.get("count", 0))
        if shop.get("founder"):
            return FOUNDER_LIMIT - count
        if (shop.get("billing") or {}).get("status") in ACTIVE:
            raise HTTPException(status_code=409, detail="Das Gründerangebot gilt nur für Läden ohne laufendes Abo.")
        if count >= FOUNDER_LIMIT:
            raise HTTPException(status_code=409, detail="Die 100 Gründerplätze sind vergeben.")
        until = max(trial_end(shop), datetime.now(timezone.utc) + timedelta(days=FOUNDER_TRIAL_DAYS))
        transaction.set(counter_ref, {"count": count + 1, "updatedAt": datetime.now(timezone.utc)}, merge=True)
        transaction.update(shop_ref, {"founder": True, "founderSince": datetime.now(timezone.utc), "trialEndsAt": until})
        return FOUNDER_LIMIT - count - 1

    left = claim(db.transaction())
    return {"founder": True, "left": max(0, left)}
