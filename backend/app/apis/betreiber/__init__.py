"""Betreiber-Bereich (/betreiber): alle Läden und Konten sehen und eingreifen.

Nur für den Betreiber der App (QME_ADMIN_EMAILS/QME_ADMIN_UIDS, app/auth/access.py). Alle Endpunkte hängen am
Unter-Router `admin` mit require_admin; ohne Prüfung ist nur /betreiber/ich (sagt, ob das Konto Betreiber ist).

Was am Laden gespeichert wird (sieht auch der Laden, Firestore ist ohne Anmeldung lesbar – daher keine Gründe):
    trialEndsAt                  Testphase verlängern oder beenden
    founder, founderSince        Gründerplatz (Zähler meta/gruender wie /billing/claim-founder)
    grant {plan, until, at}      Tarif ohne Stripe freigeschaltet (Regel in app/libs/plans.py)
    suspended {at, accounts}     gesperrt: nicht buchbar, nicht auffindbar; accounts = Konten, die dabei gesperrt wurden
    billing                      Stand des Abos aus Stripe neu holen oder die Verknüpfung lösen
Gründe, vorher/nachher und Sicherungen stehen im Protokoll auf dem Server (app/libs/protokoll.py).
Konten und Läden löschen wie deploy/konten-aufraeumen.py (app/libs/konten.py): Probelauf, Sicherung, Löschen, Nachprüfung.
"""

import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from google.cloud import firestore as gcf
from pydantic import BaseModel

from app.apis.firebase_utils import get_firebase_app, get_firestore_db
from app.auth import AuthorizedUser
from app.auth.access import admin_lists, is_admin, is_admin_account, require_admin
from app.libs import konten, protokoll
from app.libs.konten import BERLIN, ITEBV_SHOP, utc
from app.libs.plans import ACTIVE_BILLING, FOUNDER_LIMIT, FOUNDER_TRIAL_DAYS, PAID_PLANS, PLANS, effective_plan, trial_end
from app.libs.telefon import LEITUNGEN, e164

router = APIRouter()
admin = APIRouter(dependencies=[Depends(require_admin)])

ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
FOUNDERS_DOC = konten.FOUNDERS_DOC
TEST_MARKS = {"FIXTURE", "LASTTEST", "E2E", "TESTADRESSE", "TESTLADEN"}
INTERNAL_MARKS = {"BETREIBER", "ITEBV"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _check_id(value: str, what: str) -> str:
    if not ID_RE.fullmatch(value or ""):
        raise HTTPException(status_code=404, detail=f"{what} gibt es nicht.")
    return value


def _shop_ref(shop_id: str):
    return get_firestore_db().collection("shops").document(_check_id(shop_id, "Diesen Laden"))


def _shop(shop_id: str) -> tuple:
    ref = _shop_ref(shop_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht mehr.")
    return ref, snap.to_dict() or {}


def _end_of_day(value: str) -> datetime:
    """'2026-12-31' → 31.12.2026 23:59:59 deutscher Zeit"""
    try:
        d = date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Datum im Format JJJJ-MM-TT angeben.")
    return datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=BERLIN).astimezone(timezone.utc)


def _reason(text: str) -> str:
    text = (text or "").strip()
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="Bitte einen Grund angeben (steht nur im Protokoll).")
    return text[:500]


def _auth():
    from firebase_admin import auth

    return auth


def _account(uid: str):
    """Firebase-Konto oder 404"""
    auth = _auth()
    try:
        return auth.get_user(_check_id(uid, "Dieses Konto"), app=get_firebase_app())
    except auth.UserNotFoundError:
        raise HTTPException(status_code=404, detail="Dieses Konto gibt es nicht mehr.")


def _plain(value):
    return konten._plain(value)


# --- Überblick ------------------------------------------------------------------------------------------------------


def monthly_net(row: dict) -> float:
    """Monatlicher Nettoumsatz eines Ladens aus seinem Abo in Euro (Jahresabo / 12). Testphase bei Stripe zählt nicht."""
    from app.libs.stripe_billing import CATALOG, FOUNDER_PRICES

    if row.get("billing") not in ("active", "past_due") or row.get("plan") not in CATALOG:
        return 0.0
    interval = "jahr" if row.get("interval") == "jahr" else "monat"
    prices = FOUNDER_PRICES if row.get("founder") and row["plan"] == "laden" else CATALOG[row["plan"]]
    cents = prices[interval] / (12 if interval == "jahr" else 1)
    return round(cents / 100, 2)


def kennzahlen(ov: dict, founders_taken: int, now: datetime) -> dict:
    """Zahlen für die Übersicht – ohne Testläden und eigene Läden (ITEBV, Betreiber)"""
    shops = [s for s in ov["shops"] if s["kind"] == "echt"]
    accounts = [a for a in ov["accounts"] if a["kind"] == "echt"]
    plans = {p: 0 for p in PLANS}
    for s in shops:
        plans[s["effectivePlan"]] += 1
    paying = [s for s in shops if s["billing"] in ACTIVE_BILLING]
    soon = now + timedelta(days=7)
    roles: dict = {}
    for a in accounts:
        key = a["role"] or "ohne"
        roles[key] = roles.get(key, 0) + 1
    return {
        "shops": len(shops),
        "shopsTest": len(ov["shops"]) - len(shops),
        "newShops7": sum(1 for s in shops if s["created"] and s["created"] > now - timedelta(days=7)),
        "newShops30": sum(1 for s in shops if s["created"] and s["created"] > now - timedelta(days=30)),
        "byPlan": plans,
        "inTrial": sum(1 for s in shops if s["source"] == "test"),
        "paying": len(paying),
        "granted": sum(1 for s in shops if s["source"] == "freischaltung"),
        "mrr": round(sum(monthly_net(s) for s in shops), 2),
        "pastDue": sum(1 for s in shops if s["billing"] == "past_due"),
        "cancelling": sum(1 for s in paying if s["cancelAtPeriodEnd"]),
        "trialEndingSoon": sum(1 for s in shops if s["source"] == "test" and now < s["trialEnd"] <= soon),
        "suspended": sum(1 for s in shops if s["suspended"]),
        "founders": {"taken": founders_taken, "limit": FOUNDER_LIMIT},
        "accounts": len(accounts),
        "accountsTest": len(ov["accounts"]) - len(accounts),
        "accountsByRole": roles,
        "accountsUnverified": sum(1 for a in accounts if a.get("emailVerified") is False),
        "appointments30": sum(s["last30"] for s in shops),
    }


def _kind(markers: list) -> str:
    if INTERNAL_MARKS & {m.split(" ")[0] for m in markers}:
        return "intern"
    if TEST_MARKS & set(markers):
        return "test"
    return "echt"


def _source(row: dict, now: datetime) -> str:
    """Woher der wirksame Tarif kommt: abo | freischaltung | test | gratis (wie frontend/src/utils/plans.ts)"""
    if row["billing"] in ACTIVE_BILLING and row["plan"] in PAID_PLANS:
        grant = row.get("grant") or {}
        if grant.get("active") and PAID_PLANS.index(grant["plan"]) > PAID_PLANS.index(row["plan"]):
            return "freischaltung"
        return "abo"
    if row["trialEnd"] > now:
        return "test"
    return "freischaltung" if (row.get("grant") or {}).get("active") else "gratis"


def system_status() -> dict:
    """Was eingerichtet ist – nur ja/nein, nie die Werte der Schlüssel"""
    from app.apis import schedulers
    from app.libs.mail import DEFAULT_FROM, mail_configured

    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    emails, uids = admin_lists()
    return {
        "stripe": "" if not key else ("test" if "_test_" in key else "live"),
        "stripeWebhook": bool(os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()),
        "stripePortal": bool(os.environ.get("STRIPE_PORTAL_CONFIG", "").strip()),
        "resend": mail_configured(),
        "mailFrom": os.environ.get("MAIL_FROM", "").strip() or DEFAULT_FROM,
        "publicUrl": os.environ.get("PUBLIC_URL", "").strip(),
        "scheduler": {
            "running": bool(schedulers.scheduler_running),
            "lastRun": schedulers.last_run_time.isoformat() if schedulers.last_run_time else None,
            "intervalSeconds": schedulers.run_interval,
        },
        "admins": len(emails) + len(uids),
    }


@router.get("/betreiber/ich")
def who_am_i(user: AuthorizedUser) -> dict:
    """Für das Menü: Betreiber oder nicht"""
    return {"admin": is_admin(user)}


@admin.get("/betreiber/uebersicht")
def uebersicht() -> dict:
    """Alle Läden und Konten mit Kennzahlen und dem Stand der Einrichtung"""
    fs, now = get_firestore_db(), _now()
    emails, uids = admin_lists()
    ov = konten.overview(fs, konten.auth_accounts(get_firebase_app()), emails, uids, now)
    blocked = protokoll.blocked_accounts()
    for a in ov["accounts"]:
        a["kind"] = _kind(a["markers"])
        a["blockedByAdmin"] = a["uid"] in blocked
    for s in ov["shops"]:
        s["kind"] = _kind(s["markers"])
        s["source"] = _source(s, now)
    founders = fs.collection(FOUNDERS_DOC[0]).document(FOUNDERS_DOC[1]).get()
    taken = int((founders.to_dict() or {}).get("count", 0)) if founders.exists else 0
    return _plain({
        "now": now,
        "stats": kennzahlen(ov, taken, now),
        "shops": ov["shops"],
        "accounts": ov["accounts"],
        "orphans": ov["orphans"],
        "system": system_status(),
    })


@admin.get("/betreiber/laden/{shop_id}")
def laden(shop_id: str) -> dict:
    """Ein Laden mit Team, Inhaber-Konto und Protokoll"""
    _, shop = _shop(shop_id)
    fs = get_firestore_db()
    staff = []
    for snap in fs.collection("staff").where("shopId", "==", shop_id).stream():
        m = snap.to_dict() or {}
        staff.append({
            "id": snap.id, "name": m.get("name") or "", "email": m.get("email") or "", "role": m.get("role") or "",
            "userId": m.get("userId") or "", "active": m.get("isActive", True) is not False,
        })
    owner = None
    if shop.get("owner") and ID_RE.fullmatch(shop["owner"]):
        auth = _auth()
        try:
            owner = konten.account_row(auth.get_user(shop["owner"], app=get_firebase_app()))
        except auth.UserNotFoundError:
            owner = None
    keep = ("name", "street", "postalCode", "city", "phone", "email", "website", "industry", "ownerName", "owner",
            "createdAt", "updatedAt", "trialEndsAt", "founder", "founderSince", "billing", "grant", "suspended", "onboarding")
    return _plain({
        "id": shop_id,
        "shop": {k: shop.get(k) for k in keep if k in shop},
        "effectivePlan": effective_plan(shop),
        "trialEnd": trial_end(shop),
        "staff": staff,
        "owner": owner,
        "telefon": _telefon_nummern(shop_id),
        "protokoll": protokoll.read(100, shop_id=shop_id),
    })


@admin.get("/betreiber/protokoll")
def protokoll_lesen(limit: int = 300) -> dict:
    return {"entries": protokoll.read(max(1, min(limit, 2000)))}


# --- Läden ----------------------------------------------------------------------------------------------------------


class UntilRequest(BaseModel):
    until: str
    reason: str = ""


@admin.post("/betreiber/laden/{shop_id}/testphase")
def testphase(shop_id: str, body: UntilRequest, user: AuthorizedUser) -> dict:
    """Testphase bis zu einem Tag (auch in der Vergangenheit: dann endet sie)"""
    ref, shop = _shop(shop_id)
    until = _end_of_day(body.until)
    before = trial_end(shop)
    ref.update({"trialEndsAt": until, "updatedAt": _now()})
    protokoll.write(user, "Testphase", {"shopId": shop_id, "name": shop.get("name")}, body.reason.strip(),
                    {"trialEndsAt": before}, {"trialEndsAt": until})
    return _plain({"trialEndsAt": until})


class FounderRequest(BaseModel):
    founder: bool
    reason: str = ""


@admin.post("/betreiber/laden/{shop_id}/gruender")
def gruender(shop_id: str, body: FounderRequest, user: AuthorizedUser) -> dict:
    """Gründerplatz vergeben (wie /billing/claim-founder: 3 Monate gratis) oder entziehen; der Zähler zählt mit"""
    ref, _ = _shop(shop_id)
    db = get_firestore_db()
    counter_ref = db.collection(FOUNDERS_DOC[0]).document(FOUNDERS_DOC[1])
    now = _now()

    @gcf.transactional
    def change(transaction) -> dict:
        shop = ref.get(transaction=transaction).to_dict() or {}
        counter = counter_ref.get(transaction=transaction).to_dict() or {}
        count = int(counter.get("count", 0))
        if bool(shop.get("founder")) == body.founder:
            return {"founder": body.founder, "count": count, "changed": False, "name": shop.get("name")}
        if body.founder:
            if count >= FOUNDER_LIMIT:
                raise HTTPException(status_code=409, detail=f"Alle {FOUNDER_LIMIT} Gründerplätze sind vergeben.")
            until = max(trial_end(shop), now + timedelta(days=FOUNDER_TRIAL_DAYS))
            transaction.update(ref, {"founder": True, "founderSince": now, "trialEndsAt": until, "updatedAt": now})
            count += 1
        else:
            transaction.update(ref, {"founder": False, "updatedAt": now})
            count = max(0, count - 1)
        transaction.set(counter_ref, {"count": count, "updatedAt": now}, merge=True)
        return {"founder": body.founder, "count": count, "changed": True, "name": shop.get("name")}

    result = change(db.transaction())
    if result.pop("changed"):
        protokoll.write(user, "Gründer vergeben" if body.founder else "Gründer entzogen",
                        {"shopId": shop_id, "name": result.pop("name")}, body.reason.strip(), after={"zaehler": result["count"]})
    else:
        result.pop("name")
    return result


class GrantRequest(BaseModel):
    plan: str
    until: str
    reason: str


@admin.post("/betreiber/laden/{shop_id}/freischaltung")
def freischalten(shop_id: str, body: GrantRequest, user: AuthorizedUser) -> dict:
    """Tarif ohne Stripe bis zu einem Tag freischalten (Kulanz, Partner, eigener Laden)"""
    ref, shop = _shop(shop_id)
    if body.plan not in PAID_PLANS:
        raise HTTPException(status_code=400, detail="Unbekannter Tarif.")
    reason = _reason(body.reason)
    until = _end_of_day(body.until)
    if until <= _now():
        raise HTTPException(status_code=400, detail="Das Enddatum muss in der Zukunft liegen.")
    grant = {"plan": body.plan, "until": until, "at": _now()}
    ref.update({"grant": grant, "updatedAt": _now()})
    protokoll.write(user, "Freigeschaltet", {"shopId": shop_id, "name": shop.get("name")}, reason,
                    {"grant": shop.get("grant")}, {"grant": grant})
    return _plain({"grant": grant})


class ReasonRequest(BaseModel):
    reason: str = ""


@admin.post("/betreiber/laden/{shop_id}/freischaltung-beenden")
def freischaltung_beenden(shop_id: str, body: ReasonRequest, user: AuthorizedUser) -> dict:
    ref, shop = _shop(shop_id)
    ref.update({"grant": None, "updatedAt": _now()})
    protokoll.write(user, "Freischaltung beendet", {"shopId": shop_id, "name": shop.get("name")}, body.reason.strip(),
                    {"grant": shop.get("grant")})
    return {"grant": None}


def _stripe_call(fn):
    """Stripe-Fehler für den Betreiber im Wortlaut melden"""
    from app.libs.stripe_billing import stripe_configured

    if not stripe_configured():
        raise HTTPException(status_code=503, detail="Stripe ist auf dem Server nicht eingerichtet (STRIPE_SECRET_KEY fehlt).")
    try:
        return fn()
    except stripe.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe meldet: {e.user_message or str(e)}") from e


@admin.post("/betreiber/laden/{shop_id}/stripe-abgleich")
def stripe_abgleich(shop_id: str, user: AuthorizedUser) -> dict:
    """Stand des Abos neu von Stripe holen – falls eine Meldung (Webhook) verloren ging"""
    from app.libs.stripe_billing import client, shop_update_from_subscription

    ref, shop = _shop(shop_id)
    billing = shop.get("billing") or {}
    if not billing.get("subscriptionId") and not billing.get("customerId"):
        raise HTTPException(status_code=409, detail="Dieser Laden hatte nie ein Abo bei Stripe.")

    def fetch():
        c = client()
        if billing.get("subscriptionId"):
            return c.v1.subscriptions.retrieve(billing["subscriptionId"]).to_dict()
        subs = c.v1.subscriptions.list(params={"customer": billing["customerId"], "status": "all", "limit": 1})
        return subs.data[0].to_dict() if subs.data else None

    subscription = _stripe_call(fetch)
    if subscription is None:
        return {"changed": False, "message": "Bei Stripe gibt es zu diesem Kunden kein Abo."}
    update = shop_update_from_subscription(subscription)
    ref.update(update)
    protokoll.write(user, "Stripe-Abgleich", {"shopId": shop_id, "name": shop.get("name")}, before={"billing": billing},
                    after={k.removeprefix("billing."): v for k, v in update.items()})
    return _plain({"changed": True, "billing": update})


@admin.post("/betreiber/laden/{shop_id}/stripe-loesen")
def stripe_loesen(shop_id: str, body: ReasonRequest, user: AuthorizedUser) -> dict:
    """Verknüpfung mit Stripe entfernen (z. B. Test-Kunden beim Wechsel in den Live-Modus). Bei Stripe ändert sich nichts."""
    ref, shop = _shop(shop_id)
    reason = _reason(body.reason)
    billing = shop.get("billing") or {}
    if not billing:
        return {"changed": False}
    ref.update({"billing": None, "plan": "gratis", "updatedAt": _now()})
    protokoll.write(user, "Stripe gelöst", {"shopId": shop_id, "name": shop.get("name")}, reason,
                    {"billing": billing})
    return {"changed": True}


def _telefon_nummern(shop_id: str) -> list:
    return sorted(snap.id for snap in get_firestore_db().collection(LEITUNGEN).where("shopId", "==", shop_id).stream())


class TelefonRequest(BaseModel):
    nummer: str = ""  # leer = Zuordnung aufheben
    reason: str = ""


@admin.post("/betreiber/laden/{shop_id}/telefon")
def telefon_zuordnen(shop_id: str, body: TelefonRequest, user: AuthorizedUser) -> dict:
    """Rufnummer des Telefon-Assistenten für diesen Laden (eine je Laden): Anrufe darauf gehören zu ihm (app/apis/telefon)"""
    _, shop = _shop(shop_id)
    fs = get_firestore_db()
    wanted = body.nummer.strip()
    nummer = e164(wanted)
    if wanted and not nummer:
        raise HTTPException(status_code=400, detail="Das ist keine Rufnummer (z. B. +49 30 1234567).")
    if nummer:
        snap = fs.collection(LEITUNGEN).document(nummer).get()
        other = (snap.to_dict() or {}).get("shopId") if snap.exists else None
        if other and other != shop_id:
            raise HTTPException(status_code=409, detail=f"Die Nummer gehört schon zu einem anderen Laden ({other}).")
    before = _telefon_nummern(shop_id)
    for old in before:
        if old != nummer:
            fs.collection(LEITUNGEN).document(old).delete()
    if nummer and nummer not in before:
        fs.collection(LEITUNGEN).document(nummer).set({"shopId": shop_id, "nummer": nummer, "createdAt": _now()})
    protokoll.write(user, "Telefon-Nummer zugeordnet" if nummer else "Telefon-Nummer entfernt",
                    {"shopId": shop_id, "name": shop.get("name")}, body.reason.strip(), {"telefon": before},
                    {"telefon": [nummer] if nummer else []})
    return {"telefon": [nummer] if nummer else []}


def _shop_accounts(shop_id: str, shop: dict) -> list:
    """Inhaber und aktive Personen im Team mit Konto"""
    uids = [shop.get("owner") or ""]
    for snap in get_firestore_db().collection("staff").where("shopId", "==", shop_id).stream():
        m = snap.to_dict() or {}
        if m.get("userId") and m.get("isActive", True) is not False:
            uids.append(m["userId"])
    return [u for i, u in enumerate(uids) if u and ID_RE.fullmatch(u) and u not in uids[:i]]


@admin.post("/betreiber/laden/{shop_id}/sperren")
def laden_sperren(shop_id: str, body: ReasonRequest, user: AuthorizedUser) -> dict:
    """Laden offline nehmen: nicht buchbar, nicht auffindbar; Inhaber und Team können sich nicht mehr anmelden.
    Betreiber-Konten bleiben offen (sonst sperrst du dich selbst aus)."""
    ref, shop = _shop(shop_id)
    if shop.get("suspended"):
        return {"changed": False}
    reason = _reason(body.reason)
    auth, app = _auth(), get_firebase_app()
    disabled, skipped = [], []
    for uid in _shop_accounts(shop_id, shop):
        try:
            record = auth.get_user(uid, app=app)
        except auth.UserNotFoundError:
            continue
        if is_admin_account(uid, record.email or ""):
            skipped.append(record.email or uid)
            continue
        if not record.disabled:
            auth.update_user(uid, disabled=True, app=app)
            auth.revoke_refresh_tokens(uid, app=app)
            disabled.append(uid)
    suspended = {"at": _now(), "accounts": disabled}
    ref.update({"suspended": suspended, "updatedAt": _now()})
    protokoll.write(user, "Laden gesperrt", {"shopId": shop_id, "name": shop.get("name")}, reason,
                    after={"kontenGesperrt": disabled, "betreiberNichtGesperrt": skipped})
    return {"changed": True, "accounts": len(disabled), "skipped": skipped}


@admin.post("/betreiber/laden/{shop_id}/entsperren")
def laden_entsperren(shop_id: str, body: ReasonRequest, user: AuthorizedUser) -> dict:
    """Laden wieder online. Konten, die beim Sperren gesperrt wurden, gehen wieder auf – außer sie sind einzeln
    gesperrt oder gehören zu einem anderen gesperrten Laden."""
    ref, shop = _shop(shop_id)
    suspended = shop.get("suspended")
    if not suspended:
        return {"changed": False}
    auth, app = _auth(), get_firebase_app()
    blocked = protokoll.blocked_accounts()
    other = set()
    for snap in get_firestore_db().collection("shops").stream():
        if snap.id != shop_id:
            other.update(((snap.to_dict() or {}).get("suspended") or {}).get("accounts") or [])
    enabled, kept = [], []
    for uid in suspended.get("accounts") or []:
        if uid in blocked or uid in other:
            kept.append(uid)
            continue
        try:
            auth.update_user(uid, disabled=False, app=app)
            enabled.append(uid)
        except auth.UserNotFoundError:
            pass
    ref.update({"suspended": None, "updatedAt": _now()})
    protokoll.write(user, "Laden entsperrt", {"shopId": shop_id, "name": shop.get("name")}, body.reason.strip(),
                    {"suspended": suspended}, {"kontenEntsperrt": enabled, "bleibenGesperrt": kept})
    return {"changed": True, "accounts": len(enabled), "kept": len(kept)}


# --- Konten ---------------------------------------------------------------------------------------------------------


@admin.post("/betreiber/konto/{uid}/sperren")
def konto_sperren(uid: str, body: ReasonRequest, user: AuthorizedUser) -> dict:
    record = _account(uid)
    if is_admin_account(uid, record.email or ""):
        raise HTTPException(status_code=409, detail="Betreiber-Konten lassen sich hier nicht sperren.")
    reason = _reason(body.reason)
    auth, app = _auth(), get_firebase_app()
    auth.update_user(uid, disabled=True, app=app)
    auth.revoke_refresh_tokens(uid, app=app)
    protokoll.set_blocked(uid, True)
    protokoll.write(user, "Konto gesperrt", {"uid": uid, "email": record.email}, reason, {"disabled": record.disabled})
    return {"disabled": True}


@admin.post("/betreiber/konto/{uid}/entsperren")
def konto_entsperren(uid: str, body: ReasonRequest, user: AuthorizedUser) -> dict:
    record = _account(uid)
    auth = _auth()
    auth.update_user(uid, disabled=False, app=get_firebase_app())
    protokoll.set_blocked(uid, False)
    protokoll.write(user, "Konto entsperrt", {"uid": uid, "email": record.email}, body.reason.strip(), {"disabled": record.disabled})
    return {"disabled": False}


class EmailRequest(BaseModel):
    email: str
    reason: str = ""


@admin.post("/betreiber/konto/{uid}/email")
def email_aendern(uid: str, body: EmailRequest, user: AuthorizedUser) -> dict:
    """Neue Anmelde-Adresse (Support). Sie gilt danach als unbestätigt."""
    record = _account(uid)
    email = (body.email or "").strip().lower()
    if not EMAIL_RE.fullmatch(email):
        raise HTTPException(status_code=400, detail="Das ist keine gültige E-Mail-Adresse.")
    if email == (record.email or "").lower():
        return {"email": email, "changed": False}
    auth = _auth()
    try:
        auth.update_user(uid, email=email, email_verified=False, app=get_firebase_app())
    except auth.EmailAlreadyExistsError:
        raise HTTPException(status_code=409, detail="Mit dieser Adresse gibt es schon ein Konto.")
    profile = get_firestore_db().collection("users").document(uid)
    if profile.get().exists:
        profile.update({"email": email, "updatedAt": _now()})
    protokoll.write(user, "E-Mail geändert", {"uid": uid, "email": email}, body.reason.strip(), {"email": record.email}, {"email": email})
    return {"email": email, "changed": True}


class VerifiedRequest(BaseModel):
    verified: bool


@admin.post("/betreiber/konto/{uid}/email-bestaetigt")
def email_bestaetigt(uid: str, body: VerifiedRequest, user: AuthorizedUser) -> dict:
    record = _account(uid)
    _auth().update_user(uid, email_verified=body.verified, app=get_firebase_app())
    protokoll.write(user, "E-Mail als bestätigt markiert" if body.verified else "E-Mail als unbestätigt markiert",
                    {"uid": uid, "email": record.email}, before={"emailVerified": record.email_verified})
    return {"emailVerified": body.verified}


@admin.post("/betreiber/konto/{uid}/bestaetigungs-mail")
def bestaetigungs_mail(uid: str, request: Request, user: AuthorizedUser) -> dict:
    """Bestätigungs-Mail wie nach dem Registrieren (app/apis/email_verification), ohne Mengenbegrenzung"""
    from app.apis import email_verification as ev
    from app.libs.mail import mail_configured, send_mail
    from app.libs.onboarding_mail import is_test_address

    record = _account(uid)
    email = (record.email or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Zu diesem Konto gibt es keine E-Mail-Adresse.")
    if record.email_verified:
        return {"status": "bestaetigt"}
    if is_test_address(email):
        return {"status": "testadresse"}
    if not mail_configured():
        return {"status": "nicht_eingerichtet"}
    try:
        subject, html, text = ev.verification_mail(email, ev.verification_link(ev._firebase_link(email), ev._origin(request)))
        send_mail(email, subject, html, text)
    except Exception as e:
        print(f"Bestätigungs-Mail an {email} nicht verschickt: {e}")
        raise HTTPException(status_code=502, detail="Die E-Mail konnte nicht verschickt werden. Im Server-Log steht der Grund.")
    protokoll.write(user, "Bestätigungs-Mail geschickt", {"uid": uid, "email": email})
    return {"status": "verschickt"}


@admin.post("/betreiber/konto/{uid}/passwort-mail")
def passwort_mail(uid: str, request: Request, user: AuthorizedUser) -> dict:
    """Passwort-Mail wie bei „Passwort vergessen“ (app/apis/password_reset), über Resend und ohne Mengenbegrenzung.
    status: verschickt | nicht_eingerichtet (kein Resend-Schlüssel: dann verschickt der Browser Firebases eigene Mail)"""
    from app.apis import password_reset as pr
    from app.apis.email_verification import _origin
    from app.libs.mail import mail_configured
    from app.libs.onboarding_mail import is_test_address

    record = _account(uid)
    email = (record.email or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Zu diesem Konto gibt es keine E-Mail-Adresse.")
    if getattr(record, "disabled", False):
        raise HTTPException(status_code=400, detail="Das Konto ist gesperrt. Erst entsperren, dann die Passwort-Mail schicken.")
    if is_test_address(email):
        raise HTTPException(status_code=400, detail="An Testadressen wie example.com verschickt Dranzeit keine E-Mails.")
    if not mail_configured():
        protokoll.write(user, "Passwort-Mail angestoßen", {"uid": uid, "email": email})
        return {"email": email, "status": "nicht_eingerichtet"}
    try:
        pr.mail_reset(email, _origin(request))
    except Exception as e:
        print(f"Passwort-Mail an {email} nicht verschickt: {e}")
        raise HTTPException(status_code=502, detail="Die E-Mail konnte nicht verschickt werden. Im Server-Log steht der Grund.")
    protokoll.write(user, "Passwort-Mail geschickt", {"uid": uid, "email": email})
    return {"email": email, "status": "verschickt"}


# --- Löschen --------------------------------------------------------------------------------------------------------


class DeleteRequest(BaseModel):
    uids: List[str] = []
    shopIds: List[str] = []
    confirm: Optional[str] = None


def _deletion_plan(body: DeleteRequest) -> dict:
    if len(body.shopIds) > 1 or len(body.uids) > 1 or not (body.shopIds or body.uids):
        raise HTTPException(status_code=400, detail="Einen Laden und/oder ein Konto auswählen.")
    for value in body.uids + body.shopIds:
        _check_id(value, "Das")
    auth, app = _auth(), get_firebase_app()
    accounts = {}
    for uid in body.uids:
        try:
            accounts[uid] = {**konten.account_row(auth.get_user(uid, app=app)), "auth": True}
        except auth.UserNotFoundError:
            pass
    emails, uids = admin_lists()
    return konten.plan_deletion(get_firestore_db(), body.uids, body.shopIds, accounts, emails, uids, _now())


def _summary(plan: dict) -> dict:
    return {
        "shops": [{"id": s["id"], "name": s["name"], "related": {n: len(d) for n, d in s["related"].items() if d}} for s in plan["shops"]],
        "users": [{
            "uid": u["uid"], "email": u["email"], "auth": u["auth"], "profile": bool(u["profile"]),
            "appointments": len(u["appointments"]), "upcoming": u["upcoming"], "push": len(u["push"]),
            "offers": len(u["offers"]), "queue": len(u["queue"]), "customers": len(u["customers"]), "staff": len(u["staff"]),
        } for u in plan["users"]],
        "foundersFreed": plan["founders"]["freed"],
        "problems": plan["problems"],
    }


def _confirm_word(plan: dict) -> str:
    """Was zur Bestätigung eingetippt werden muss: Name des Ladens, sonst die E-Mail des Kontos"""
    if plan["shops"]:
        return plan["shops"][0]["name"].strip()
    u = plan["users"][0]
    return (u["email"] or u["uid"]).strip()


@admin.post("/betreiber/loeschen/probe")
def loeschen_probe(body: DeleteRequest) -> dict:
    """Probelauf: was wegginge, was es verhindert. Ändert nichts."""
    plan = _deletion_plan(body)
    return {**_summary(plan), "confirmWord": _confirm_word(plan) if (plan["shops"] or plan["users"]) else ""}


@admin.post("/betreiber/loeschen")
def loeschen(body: DeleteRequest, user: AuthorizedUser) -> dict:
    """Löschen wie deploy/konten-aufraeumen.py: Sicherung auf dem Server, löschen, nachprüfen"""
    plan = _deletion_plan(body)
    if plan["problems"]:
        raise HTTPException(status_code=409, detail=" ".join(plan["problems"]))
    if not plan["shops"] and not plan["users"]:
        raise HTTPException(status_code=404, detail="Das gibt es schon nicht mehr.")
    word = _confirm_word(plan)
    if (body.confirm or "").strip().lower() != word.lower():
        raise HTTPException(status_code=400, detail=f"Zur Bestätigung genau „{word}“ eintippen.")
    if any(s["id"] == ITEBV_SHOP for s in plan["shops"]):  # plan_deletion meldet das schon; doppelt hält besser
        raise HTTPException(status_code=409, detail="Den Laden der ITEBV GmbH löscht der Betreiber-Bereich nicht.")

    summary = _summary(plan)
    selection = ", ".join([f"Laden {s['name']} ({s['id']})" for s in plan["shops"]] + [f"Konto {u['email'] or u['uid']}" for u in plan["users"]])
    backup = protokoll.save_backup(konten.backup_data(plan, selection, "Betreiber-Bereich"), plan["now"])
    auth, app = _auth(), get_firebase_app()

    def delete_auth_user(uid):
        try:
            auth.delete_user(uid, app=app)
        except auth.UserNotFoundError:
            pass

    def auth_exists(uid):
        try:
            auth.get_user(uid, app=app)
            return True
        except auth.UserNotFoundError:
            return False

    result = konten.execute(get_firestore_db(), plan, delete_auth_user)
    left = konten.verify(get_firestore_db(), plan, auth_exists)
    for u in plan["users"]:
        protokoll.set_blocked(u["uid"], False)
    protokoll.write(user, "Gelöscht", {"shopIds": [s["id"] for s in plan["shops"]], "uids": [u["uid"] for u in plan["users"]],
                                       "name": selection}, after={**summary, "ergebnis": result, "sicherung": backup.name, "reste": left})
    return {"result": result, "left": left, "backup": backup.name}


# Reiter Verzeichnis (Salons ohne Dranzeit, Seiten der Läden): eigene Datei, gleiche Prüfung
from app.apis.betreiber import verzeichnis as _verzeichnis  # noqa: E402

admin.include_router(_verzeichnis.router)
router.include_router(admin)
