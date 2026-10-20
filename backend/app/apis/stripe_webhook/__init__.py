"""Öffentliche Teile der Abrechnung: Stripe-Webhook (Signatur geprüft) und freie Gründerplätze.

Der Webhook schreibt den Stand des Abos an den Laden (Feld billing, plan). Er liest immer den aktuellen
Stand des Abos, daher schadet es nicht, wenn Stripe ein Ereignis doppelt oder in anderer Reihenfolge schickt.
"""

import json
import os

import stripe
from fastapi import APIRouter, HTTPException, Request

from app.apis.firebase_utils import get_firestore_db
from app.libs.stripe_billing import client, shop_update_from_subscription

router = APIRouter()

SUBSCRIPTION_EVENTS = ("customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted")


@router.get("/billing-public/founders-left")
def founders_left_public() -> dict:
    from app.apis.billing import founders_left

    return {"left": founders_left()}


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request) -> dict:
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook nicht eingerichtet")
    payload = await request.body()
    try:
        stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature", ""), secret)
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Ungültige Signatur")

    # Signatur stimmt: ab hier mit einfachen dicts arbeiten (Stripe-Objekte sind seit SDK 15 keine dicts mehr)
    event = json.loads(payload)
    kind = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}
    subscription = None
    if kind in SUBSCRIPTION_EVENTS:
        subscription = obj
    elif kind == "checkout.session.completed" and obj.get("subscription"):
        subscription = client().v1.subscriptions.retrieve(obj["subscription"]).to_dict()
    elif kind in ("invoice.payment_failed", "invoice.paid"):
        sub_id = (obj.get("parent") or {}).get("subscription_details", {}).get("subscription") or obj.get("subscription")
        if sub_id:
            subscription = client().v1.subscriptions.retrieve(sub_id).to_dict()

    if subscription is not None:
        _apply(subscription)
    return {"received": True}


def _apply(subscription) -> None:
    shop_id = (subscription.get("metadata") or {}).get("shopId")
    if not shop_id:
        print(f"Stripe: Abo {subscription.get('id')} ohne shopId – übersprungen")
        return
    ref = get_firestore_db().collection("shops").document(shop_id)
    if not ref.get().exists:
        print(f"Stripe: Laden {shop_id} zum Abo {subscription.get('id')} gibt es nicht")
        return
    ref.update(shop_update_from_subscription(subscription))
    print(f"Stripe: Laden {shop_id}, Abo {subscription.get('status')}")
