"""Öffentliche Teile der Abrechnung: Stripe-Webhook (Signatur geprüft) und freie Gründerplätze.

Der Webhook schreibt den Stand des Abos an den Laden (Feld billing, plan). Er liest immer den aktuellen
Stand des Abos, daher schadet es nicht, wenn Stripe ein Ereignis doppelt oder in anderer Reihenfolge schickt.

Live-Konto und Sandbox schicken an dieselbe Adresse; welches Geheimnis die Signatur bestätigt, sagt den Modus.
Ein Ereignis zählt nur für Läden im selben Modus (Testmodus je Laden, app/libs/shop_privat.py).
"""

import json
import os

import stripe
from fastapi import APIRouter, HTTPException, Request

from app.apis.firebase_utils import get_firestore_db
from app.libs.shop_privat import LIVE, TEST, save_stripe_ids, stripe_link
from app.libs.stripe_billing import WEBHOOK_ENV, client, shop_update_from_subscription

router = APIRouter()

SUBSCRIPTION_EVENTS = ("customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted")


@router.get("/billing-public/founders-left")
def founders_left_public() -> dict:
    from app.apis.billing import founders_left

    return {"left": founders_left()}


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request) -> dict:
    secrets = {mode: os.environ.get(WEBHOOK_ENV[mode], "").strip() for mode in (LIVE, TEST)}
    if not any(secrets.values()):
        raise HTTPException(status_code=503, detail="Webhook nicht eingerichtet")
    payload = await request.body()
    mode = _verified_mode(payload, request.headers.get("stripe-signature", ""), secrets)
    if mode is None:
        raise HTTPException(status_code=400, detail="Ungültige Signatur")

    # Signatur stimmt: ab hier mit einfachen dicts arbeiten (Stripe-Objekte sind seit SDK 15 keine dicts mehr)
    event = json.loads(payload)
    kind = event.get("type")
    obj = (event.get("data") or {}).get("object") or {}
    subscription = None
    if kind in SUBSCRIPTION_EVENTS:
        subscription = obj
    elif kind == "checkout.session.completed" and obj.get("subscription"):
        subscription = client(mode).v1.subscriptions.retrieve(obj["subscription"]).to_dict()
    elif kind in ("invoice.payment_failed", "invoice.paid"):
        sub_id = (obj.get("parent") or {}).get("subscription_details", {}).get("subscription") or obj.get("subscription")
        if sub_id:
            subscription = client(mode).v1.subscriptions.retrieve(sub_id).to_dict()

    if subscription is not None:
        _apply(subscription, mode)
    return {"received": True}


def _verified_mode(payload: bytes, header: str, secrets: dict) -> str | None:
    """Modus, dessen Webhook-Geheimnis die Signatur bestätigt – None, wenn keines passt"""
    for mode, secret in secrets.items():
        if not secret:
            continue
        try:
            stripe.Webhook.construct_event(payload, header, secret)
            return mode
        except stripe.SignatureVerificationError:
            continue
        except ValueError:
            return None
    return None


def _apply(subscription, mode: str = LIVE) -> None:
    shop_id = (subscription.get("metadata") or {}).get("shopId")
    if not shop_id:
        print(f"Stripe: Abo {subscription.get('id')} ohne shopId – übersprungen")
        return
    db = get_firestore_db()
    ref = db.collection("shops").document(shop_id)
    snap = ref.get()
    if not snap.exists:
        print(f"Stripe: Laden {shop_id} zum Abo {subscription.get('id')} gibt es nicht")
        return
    shop_mode, ids = stripe_link(db, shop_id, snap.to_dict() or {})
    if shop_mode != mode:  # z. B. altes Sandbox-Abo eines Ladens, der echt bucht – oder umgekehrt
        print(f"Stripe: Abo {subscription.get('id')} ({mode}) für Laden {shop_id} im Modus {shop_mode} – übersprungen")
        return
    if mode == TEST and ids.get("customerId") and ids["customerId"] != subscription.get("customer"):
        print(f"Stripe: Sandbox-Abo {subscription.get('id')} eines früheren Tests von Laden {shop_id} – übersprungen")
        return
    ref.update(shop_update_from_subscription(subscription))
    # Kunde und Abo nur dort, wo Browser nicht hinkommen (app/libs/shop_privat.py)
    save_stripe_ids(db, shop_id, subscription.get("customer"), subscription.get("id"), mode)
    print(f"Stripe: Laden {shop_id}, Abo {subscription.get('status')}" + (" (Sandbox)" if mode == TEST else ""))
