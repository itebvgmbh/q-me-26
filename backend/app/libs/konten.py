"""Konten und Läden im Überblick, Löschen mit Sicherung – für den Betreiber-Bereich (app/apis/betreiber) und
deploy/konten-aufraeumen.py. Beide zeigen und löschen dasselbe.

Ein Konto löschen heißt dasselbe wie "Konto löschen" im Profil (DELETE /routes/datenschutz/konto): delete_account_data
aus app/libs/privacy.py, danach das Firebase-Konto. Seine Termine bleiben ohne Namen und Kontakt, kommende werden
abgesagt. Anders als im Profil geht es hier auch für Läden und Team:
- Läden eines Kontos gehen nur mit, wenn sie selbst genannt sind (sonst Abbruch), samt Leistungen, Team, Pausen,
  Terminen, Kunden-Einträgen, Belegung, Angeboten und Push-Abos. Läden mit laufendem Abo und ITEBV GmbH: Abbruch.
- Team-Einträge des Kontos in Läden, die bleiben: nur die Verbindung zum Konto wird gelöst (userId leer).
  Person und Termine bleiben im Laden.
- Gründerplätze gelöschter Läden werden wieder frei (meta/gruender, wie /billing/claim-founder zählt).
"""

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")

ITEBV_SHOP = "zNS505OFvKZpFaR1vTdN"  # Standardladen von seiten.cjs, durchlauf-*.cjs, ladezeit.cjs und wlan.cjs
FOUNDERS_DOC = ("meta", "gruender")  # wie app/apis/billing
# Was an einem Laden hängt: wie dev/fixtures.py loeschen, dazu Angebote, alte Warteschlange und Push-Abos
SHOP_COLLECTIONS = (
    "services", "staff", "staff-invitations", "recurring-breaks", "breaks", "appointments", "customers",
    "schedules", "shop_days", "earlier_slot_notifications", "queue", "push_subscriptions", "telefon_leitungen",
)
TEST_SCRIPTS = (
    (re.compile(r"^q-me-test-\d+@example\.com$"), "FIXTURE"),  # dev/fixtures.py
    (re.compile(r"^q-me-last-\d+(-k\d+)?@example\.com$"), "LASTTEST"),  # dev/e2e/lasttest.cjs
    # team-einladen, email-bestaetigen, leistungen-kunden, frueher-dran-schalter
    (re.compile(r"^(bestaetigen|kim|kunde|mo|frueher-dran)-\d+@example\.com$"), "E2E"),
    (re.compile(r"^delivered\+dranzeit-\d+@resend\.dev$"), "E2E"),  # email-bestaetigen mit QME_RESEND_TEST=1
)
TEST_SHOP_NAMES = ("Testladen (wird gleich gelöscht)", "Lasttest (wird gleich gelöscht)")


def utc(value):
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def from_ms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc) if ms else None


def is_test_address(email: str) -> bool:
    from app.libs.onboarding_mail import is_test_address as check

    return check(email)


def account_row(user) -> dict:
    """Firebase-Konto als einfacher Eintrag (ohne Passwort-Hash)"""
    meta = user.user_metadata
    last = max(meta.last_sign_in_timestamp or 0, getattr(meta, "last_refresh_timestamp", None) or 0)
    return {
        "uid": user.uid,
        "email": user.email or "",
        "emailVerified": bool(user.email_verified),
        "disabled": bool(user.disabled),
        "created": from_ms(meta.creation_timestamp),
        "lastSignIn": from_ms(last),
        "providers": sorted(p.provider_id for p in user.provider_data),
    }


def auth_accounts(app) -> list:
    """Alle Firebase-Konten als einfache Einträge"""
    from firebase_admin import auth

    return [account_row(user) for user in auth.list_users(app=app).iterate_all()]


def read_all(fs, name: str) -> dict:
    return {d.id: d.to_dict() or {} for d in fs.collection(name).stream()}


def where(fs, name: str, field: str, value) -> list:
    return list(fs.collection(name).where(field, "==", value).stream())


def account_markers(acc: dict, admin_emails: set, admin_uids: set) -> list:
    email = (acc.get("email") or "").strip().lower()
    marks = []
    if (email and email in admin_emails) or acc["uid"].lower() in admin_uids:
        marks.append("BETREIBER")
    if ITEBV_SHOP in acc["shops"] or ITEBV_SHOP in {s["shopId"] for s in acc["staff"]}:
        marks.append("ITEBV")
    script = next((name for pattern, name in TEST_SCRIPTS if pattern.match(email)), None)
    if script:
        marks.append(script)
    elif email and is_test_address(email):
        marks.append("TESTADRESSE")
    if not acc["auth"]:
        marks.append("NUR PROFIL")
    elif not acc["profile"]:
        marks.append("OHNE PROFIL")
    if acc.get("disabled"):
        marks.append("GESPERRT")
    return marks


def overview(fs, accounts: list, admin_emails: set = frozenset(), admin_uids: set = frozenset(), now=None) -> dict:
    """Konten (Firebase-Anmeldung und Profil in users) und Läden mit allem, was daran hängt. Liest nur."""
    now = now or datetime.now(timezone.utc)
    users = read_all(fs, "users")
    shops = read_all(fs, "shops")
    staff = read_all(fs, "staff")
    customers = read_all(fs, "customers")
    appointments = read_all(fs, "appointments")
    services = read_all(fs, "services")

    by_uid = {}
    for a in accounts:
        by_uid[a["uid"]] = {**a, "auth": True, "profile": a["uid"] in users}
    for uid, profile in users.items():
        if uid not in by_uid:
            by_uid[uid] = {"uid": uid, "email": profile.get("email") or "", "emailVerified": None, "disabled": False,
                           "created": utc(profile.get("createdAt")), "lastSignIn": None, "providers": [],
                           "auth": False, "profile": True}
    for uid, acc in by_uid.items():
        profile = users.get(uid) or {}
        acc.update({
            "role": profile.get("role") or "",
            "name": profile.get("displayName") or profile.get("name") or "",
            "shops": sorted(sid for sid, s in shops.items() if s.get("owner") == uid),
            "staff": [{"shopId": s.get("shopId"), "role": s.get("role") or "", "active": s.get("isActive", True) is not False}
                      for s in staff.values() if s.get("userId") == uid],
            "customers": [c.get("shopId") for c in customers.values() if c.get("userId") == uid],
            "appointments": 0,
            "upcoming": 0,
        })
    for appt in appointments.values():
        acc = by_uid.get(appt.get("customerId"))
        if acc is not None:
            acc["appointments"] += 1
            start = utc(appt.get("startTime"))
            acc["upcoming"] += bool(appt.get("status") == "scheduled" and start and start > now)

    from app.libs.plans import active_grant, effective_plan, trial_end

    local = now.astimezone(BERLIN)
    month_start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_end = (month_start + timedelta(days=32)).replace(day=1)
    shop_rows = {}
    for sid, s in shops.items():
        billing = s.get("billing") or {}
        grant = s.get("grant") or {}
        suspended = s.get("suspended") or {}
        shop_rows[sid] = {
            "id": sid, "name": s.get("name") or "(ohne Namen)", "owner": s.get("owner") or "", "email": s.get("email") or "",
            "created": utc(s.get("createdAt")), "founder": bool(s.get("founder")),
            "billing": billing.get("status") or "", "plan": billing.get("plan") or "",
            "services": 0, "staff": 0, "appointments": 0, "upcoming": 0, "customers": 0,
            # Für den Betreiber-Bereich
            "city": s.get("city") or "", "phone": s.get("phone") or "",
            "effectivePlan": effective_plan(s, now), "trialEnd": trial_end(s),
            "grant": {"plan": grant.get("plan"), "until": utc(grant.get("until")), "active": bool(active_grant(s, now))} if grant else None,
            "suspended": utc(suspended.get("at")) or now if suspended else None,
            "interval": billing.get("interval") or "", "cancelAtPeriodEnd": bool(billing.get("cancelAtPeriodEnd")),
            "currentPeriodEnd": utc(billing.get("currentPeriodEnd")), "customerId": billing.get("customerId") or "",
            "subscriptionId": billing.get("subscriptionId") or "",
            "onboarding": sorted(k for k, v in (s.get("onboarding") or {}).items() if v),
            "thisMonth": 0, "last30": 0, "lastAppointment": None, "staffAccounts": [],
        }
    for svc in services.values():
        row = shop_rows.get(svc.get("shopId"))
        if row and not svc.get("archived"):
            row["services"] += 1
    for member in staff.values():
        row = shop_rows.get(member.get("shopId"))
        if row and member.get("isActive", True) is not False:
            row["staff"] += 1
            if member.get("userId"):
                row["staffAccounts"].append(member["userId"])
    for entry in customers.values():
        row = shop_rows.get(entry.get("shopId"))
        if row:
            row["customers"] += 1
    for appt in appointments.values():
        row = shop_rows.get(appt.get("shopId"))
        if row:
            row["appointments"] += 1
            start = utc(appt.get("startTime"))
            row["upcoming"] += bool(appt.get("status") == "scheduled" and start and start > now)
            # Wie der Verbrauch im Gratis-Tarif (frontend/src/utils/plan-usage.ts): abgesagte zählen nicht
            if start and appt.get("status") != "cancelled":
                row["thisMonth"] += bool(month_start <= start < month_end)
                row["last30"] += bool(now - timedelta(days=30) <= start <= now)
                if start <= now and (row["lastAppointment"] is None or start > row["lastAppointment"]):
                    row["lastAppointment"] = start

    far = datetime.max.replace(tzinfo=timezone.utc)
    ordered = sorted(by_uid.values(), key=lambda a: (a.get("created") or far, (a.get("email") or "").lower(), a["uid"]))
    for i, acc in enumerate(ordered, 1):
        acc["nr"] = f"K{i}"
        acc["markers"] = account_markers(acc, admin_emails, admin_uids)
    shops_ordered = sorted(shop_rows.values(), key=lambda s: (s.get("created") or far, s["name"].lower(), s["id"]))
    for i, shop in enumerate(shops_ordered, 1):
        shop["nr"] = f"L{i}"
    for shop in shops_ordered:
        marks = []
        if shop["id"] == ITEBV_SHOP:
            marks.append("ITEBV (seiten.cjs, durchlauf-*.cjs)")
        if shop["name"] in TEST_SHOP_NAMES:
            marks.append("TESTLADEN")
        owner = by_uid.get(shop["owner"])
        if owner:
            marks += [m for m in owner["markers"] if m in ("BETREIBER", "FIXTURE", "LASTTEST", "E2E", "TESTADRESSE")]
        else:
            marks.append("INHABER-KONTO FEHLT")
        if shop["billing"]:
            marks.append(f"ABO {shop['billing']}")
        if shop["founder"]:
            marks.append("GRÜNDER")
        shop["ownerLabel"] = f'{owner["nr"]} {owner["email"] or ""}'.strip() if owner else f'kein Konto (UID {shop["owner"] or "–"})'
        shop["markers"] = marks

    known = {uid for uid, a in by_uid.items() if a["auth"]}
    return {
        "now": now,
        "accounts": ordered,
        "shops": shops_ordered,
        "orphans": {
            "staff": sum(1 for s in staff.values() if s.get("userId") and s["userId"] not in known),
            "customers": sum(1 for c in customers.values() if c.get("userId") and c["userId"] not in known),
            "appointmentsInMissingShops": sum(1 for a in appointments.values() if a.get("shopId") not in shops),
        },
    }


def plan_deletion(fs, uids: list, shop_ids: list, accounts: dict, admin_emails: set = frozenset(),
                  admin_uids: set = frozenset(), now=None) -> dict:
    """Was beim Löschen passiert. Liest nur. Bricht ab, wenn etwas nicht sicher ist."""
    from app.libs.plans import ACTIVE_BILLING

    now = now or datetime.now(timezone.utc)
    problems = []
    shops = []
    for sid in shop_ids:
        snap = fs.collection("shops").document(sid).get()
        if not snap.exists:
            problems.append(f"Laden {sid} gibt es nicht mehr.")
            continue
        shop = snap.to_dict() or {}
        if sid == ITEBV_SHOP:
            problems.append(f"„{shop.get('name')}“ ist der Laden der ITEBV GmbH, gegen den seiten.cjs und durchlauf-*.cjs laufen – den löscht dieses Skript nicht.")
        if (shop.get("billing") or {}).get("status") in ACTIVE_BILLING:
            problems.append(f"„{shop.get('name')}“ hat ein laufendes Abo ({shop['billing']['status']}) – erst in Stripe kündigen "
                            f"(Kunde {shop['billing'].get('customerId') or '?'}, Abo {shop['billing'].get('subscriptionId') or '?'}, „sofort“).")
        related = {name: where(fs, name, "shopId", sid) for name in SHOP_COLLECTIONS}
        members = list(fs.collection("shops").document(sid).collection("members").stream())  # Team-Vermerke, app/libs/team.py
        shops.append({"id": sid, "name": shop.get("name") or "", "data": shop, "founder": bool(shop.get("founder")), "related": related,
                      "members": members})

    deleted_shops = set(shop_ids)
    users = []
    for uid in uids:
        acc = accounts.get(uid) or {}
        profile = fs.collection("users").document(uid).get()
        if not acc.get("auth") and not profile.exists:
            problems.append(f"Konto {uid} gibt es nicht mehr.")
            continue
        email = (acc.get("email") or (profile.to_dict() or {}).get("email") or "").strip().lower()
        if (email and email in admin_emails) or uid.lower() in admin_uids:
            problems.append(f"{email or uid} ist Betreiber der App (QME_ADMIN_EMAILS/QME_ADMIN_UIDS) – erst dort austragen.")
        owned = [d for d in where(fs, "shops", "owner", uid) if d.id not in deleted_shops]
        for d in owned:
            problems.append(f"{email or uid} ist Inhaber von „{(d.to_dict() or {}).get('name')}“ ({d.id}) – den Laden mitnennen oder das Konto behalten.")
        keep = lambda docs: [d for d in docs if (d.to_dict() or {}).get("shopId") not in deleted_shops]  # noqa: E731
        appts = keep(where(fs, "appointments", "customerId", uid))
        upcoming = sum(
            1 for d in appts
            if (d.to_dict() or {}).get("status") == "scheduled" and (utc((d.to_dict() or {}).get("startTime")) or now) > now
        )
        push = [s for d in appts for s in where(fs, "push_subscriptions", "appointmentId", d.id)]
        users.append({
            "uid": uid, "email": email, "auth": bool(acc.get("auth")), "authRecord": acc if acc.get("auth") else None,
            "profile": profile if profile.exists else None,
            "appointments": appts, "upcoming": upcoming, "push": push,
            "offers": keep(where(fs, "earlier_slot_notifications", "userId", uid)),
            "queue": keep(where(fs, "queue", "customerId", uid)),
            "customers": keep(where(fs, "customers", "userId", uid)),
            "staff": keep(where(fs, "staff", "userId", uid)),
        })

    founders = fs.collection(FOUNDERS_DOC[0]).document(FOUNDERS_DOC[1]).get()
    founder_count = int((founders.to_dict() or {}).get("count", 0)) if founders.exists else 0
    freed = sum(1 for s in shops if s["founder"])
    return {
        "now": now, "shops": shops, "users": users, "problems": problems,
        "founders": {"doc": founders, "count": founder_count, "freed": min(freed, founder_count)},
    }


def _plain(value):
    """Firestore-Werte für JSON"""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    path = getattr(value, "path", None)  # DocumentReference
    if isinstance(path, str):
        return {"ref": path}
    if hasattr(value, "latitude"):  # GeoPoint
        return {"lat": value.latitude, "lng": value.longitude}
    return str(value)


def backup_data(plan: dict, selection: str, list_file: str) -> dict:
    """Alles, was gelöscht oder geändert wird, im Zustand vorher"""
    docs = {}

    def add(coll, snaps):
        for s in snaps:
            docs[f"{coll}/{s.id}"] = _plain(s.to_dict() or {})

    for s in plan["shops"]:
        docs[f"shops/{s['id']}"] = _plain(s["data"])
        for m in s.get("members", []):
            docs[f"shops/{s['id']}/members/{m.id}"] = _plain(m.to_dict() or {})
        for name, snaps in s["related"].items():
            add(name, snaps)
    for u in plan["users"]:
        add("appointments", u["appointments"])
        add("push_subscriptions", u["push"])
        add("earlier_slot_notifications", u["offers"])
        add("queue", u["queue"])
        add("customers", u["customers"])
        add("staff", u["staff"])
        if u["profile"]:
            add("users", [u["profile"]])
    if plan["founders"]["doc"].exists:
        add(FOUNDERS_DOC[0], [plan["founders"]["doc"]])
    return {
        "erstellt": plan["now"].isoformat(),
        "auswahl": selection,
        "liste": list_file,
        "konten": [_plain(u["authRecord"]) for u in plan["users"] if u["authRecord"]],
        "dokumente": docs,
    }


def execute(fs, plan: dict, delete_auth_user) -> dict:
    """Erst die Läden, dann die Konten – so liest delete_account_data nur noch, was in bleibenden Läden liegt"""
    from app.libs.privacy import delete_account_data

    now = plan["now"]
    result = {"shopDocs": 0, "shops": 0, "accounts": 0, "anonymized": 0, "cancelled": 0, "staffUnlinked": 0}
    for s in plan["shops"]:
        for snaps in s["related"].values():
            for snap in snaps:
                snap.reference.delete()
                result["shopDocs"] += 1
        for m in s.get("members", []):
            m.reference.delete()
        fs.collection("shops").document(s["id"]).delete()
        # Vermerk wie in firestore.rules: unter dieser ID legt niemand mehr einen Laden an (frische Testphase)
        fs.collection("deleted_shops").document(s["id"]).set({"owner": s["data"].get("owner") or "", "deletedAt": now})
        result["shops"] += 1
    f = plan["founders"]
    if f["freed"]:
        f["doc"].reference.update({"count": f["count"] - f["freed"], "updatedAt": now})
    for u in plan["users"]:
        for snap in u["staff"]:
            snap.reference.update({"userId": "", "updatedAt": now})
            shop_id = (snap.to_dict() or {}).get("shopId")
            if shop_id:
                fs.collection("shops").document(shop_id).collection("members").document(u["uid"]).delete()
            result["staffUnlinked"] += 1
        done = delete_account_data(fs, u["uid"], now)
        result["anonymized"] += done["anonymized"]
        result["cancelled"] += done["cancelled"]
        delete_auth_user(u["uid"])
        result["accounts"] += 1
    return result


def verify(fs, plan: dict, auth_exists) -> list:
    """Nachprüfen: Was weg sein soll, ist weg"""
    from app.libs.privacy import ANONYMIZED_NAME

    left = []
    for s in plan["shops"]:
        if fs.collection("shops").document(s["id"]).get().exists:
            left.append(f"Laden {s['id']} ist noch da")
        if list(fs.collection("shops").document(s["id"]).collection("members").stream()):
            left.append(f"Team-Vermerke von Laden {s['id']} sind noch da")
        for name in SHOP_COLLECTIONS:
            n = len(where(fs, name, "shopId", s["id"]))
            if n:
                left.append(f"{name}: noch {n} Dokumente von Laden {s['id']}")
    for u in plan["users"]:
        if fs.collection("users").document(u["uid"]).get().exists:
            left.append(f"Profil {u['uid']} ist noch da")
        if auth_exists(u["uid"]):
            left.append(f"Firebase-Konto {u['uid']} ist noch da")
        for name, field in (("customers", "userId"), ("staff", "userId"), ("earlier_slot_notifications", "userId"), ("queue", "customerId")):
            n = len(where(fs, name, field, u["uid"]))
            if n:
                left.append(f"{name}: noch {n} Einträge mit Konto {u['uid']}")
        named = [d.id for d in where(fs, "appointments", "customerId", u["uid"]) if (d.to_dict() or {}).get("customerName") != ANONYMIZED_NAME]
        if named:
            left.append(f"appointments: {len(named)} Termine von {u['uid']} tragen noch einen Namen")
    return left
