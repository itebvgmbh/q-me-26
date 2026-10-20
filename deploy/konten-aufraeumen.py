#!/usr/bin/env python3
"""Konten aufräumen (20.10.2026): erst eine Liste aller Konten und Läden, dann nur das Freigegebene löschen.

Stefan am 20.10.2026: Die bisherigen Konten seien alles Testkonten. Gelöscht wird trotzdem nur, was er nach Ansicht
der Liste ausdrücklich nennt. Auf dem Server als root, im Backend-Ordner (Firebase-Schlüssel wie im Betrieb):

    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/konten-aufraeumen.py liste
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/konten-aufraeumen.py loeschen K1-K4,K7,L2
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/konten-aufraeumen.py loeschen K1-K4,K7,L2 --ausfuehren

liste      Liest nur. Nummeriert Konten (K1 …) und Läden (L1 …) und merkt sich die Nummern in
           /root/dranzeit-konten/liste-<Zeit>.json (nur für root lesbar), damit "loeschen" genau diese meint.
           Wer nach der Liste dazukommt, hat keine Nummer und bleibt.
loeschen   Ohne --ausfuehren ein Probelauf: zeigt, was wegginge, ändert nichts. Mit --ausfuehren erst eine Sicherung
           aller betroffenen Dokumente nach /root/dranzeit-konten/sicherung-<Zeit>.json, dann löschen, dann nachprüfen.

Ein Konto löschen heißt dasselbe wie "Konto löschen" im Profil (DELETE /routes/datenschutz/konto): delete_account_data
aus app/libs/privacy.py, danach das Firebase-Konto. Seine Termine bleiben ohne Namen und Kontakt, kommende werden
abgesagt. Anders als im Profil geht es hier auch für Läden und Team:
- Läden eines Kontos gehen nur mit, wenn sie selbst genannt sind (sonst Abbruch), samt Leistungen, Team, Pausen,
  Terminen, Kunden-Einträgen, Belegung, Angeboten und Push-Abos. Läden mit laufendem Abo und ITEBV GmbH: Abbruch.
- Team-Einträge des Kontos in Läden, die bleiben: nur die Verbindung zum Konto wird gelöst (userId leer).
  Person und Termine bleiben im Laden.
- Gründerplätze gelöschter Läden werden wieder frei (meta/gruender, wie /billing/claim-founder zählt).
Die Sicherung hält fest, was es gab. Firebase-Konten lassen sich daraus nicht mit Passwort wiederherstellen.
"""

import json
import os
import re
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

ENV_FILE = os.environ.get("QME_ENV_FILE", "/etc/q-me.env")
OUT_DIR = Path(os.environ.get("QME_KONTEN_DIR", "/root/dranzeit-konten"))
ITEBV_SHOP = "zNS505OFvKZpFaR1vTdN"  # Standardladen von seiten.cjs, durchlauf-*.cjs, ladezeit.cjs und wlan.cjs
FOUNDERS_DOC = ("meta", "gruender")  # wie app/apis/billing
# Was an einem Laden hängt: wie dev/fixtures.py loeschen, dazu Angebote, alte Warteschlange und Push-Abos
SHOP_COLLECTIONS = (
    "services", "staff", "staff-invitations", "recurring-breaks", "breaks", "appointments", "customers",
    "schedules", "shop_days", "earlier_slot_notifications", "queue", "push_subscriptions",
)
TEST_SCRIPTS = (
    (re.compile(r"^q-me-test-\d+@example\.com$"), "FIXTURE"),  # dev/fixtures.py
    (re.compile(r"^q-me-last-\d+(-k\d+)?@example\.com$"), "LASTTEST"),  # dev/e2e/lasttest.cjs
    # team-einladen, email-bestaetigen, leistungen-kunden, frueher-dran-schalter
    (re.compile(r"^(bestaetigen|kim|kunde|mo|frueher-dran)-\d+@example\.com$"), "E2E"),
    (re.compile(r"^delivered\+dranzeit-\d+@resend\.dev$"), "E2E"),  # email-bestaetigen mit QME_RESEND_TEST=1
)
TEST_SHOP_NAMES = ("Testladen (wird gleich gelöscht)", "Lasttest (wird gleich gelöscht)")
LEGEND = (
    "Kennzeichen: BETREIBER = steht in QME_ADMIN_EMAILS/QME_ADMIN_UIDS · ITEBV = Inhaber oder Team im Laden ITEBV GmbH\n"
    "  FIXTURE = dev/fixtures.py · LASTTEST = dev/e2e/lasttest.cjs · E2E = anderes Testskript in dev/e2e\n"
    "  TESTADRESSE = @example.com u. ä. · NUR PROFIL = Profil ohne Firebase-Konto · OHNE PROFIL = Konto ohne Profil\n"
    "  GESPERRT = Firebase-Konto deaktiviert"
)


def load_env() -> None:
    """Firebase-Einträge und die Betreiber-Liste aus /etc/q-me.env übernehmen (ohne die Datei per Shell einzulesen)"""
    if not os.path.exists(ENV_FILE):
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            name, sep, value = line.strip().partition("=")
            if sep and (name.startswith("FIREBASE_") or name in ("QME_ADMIN_EMAILS", "QME_ADMIN_UIDS")) and not os.environ.get(name):
                os.environ[name] = value.strip()


def env_set(name: str) -> set:
    return {p.strip().lower() for p in os.environ.get(name, "").split(",") if p.strip()}


def utc(value):
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def from_ms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc) if ms else None


def fmt(value, with_time: bool = True) -> str:
    """Deutsche Zeit, "–" wenn unbekannt"""
    from zoneinfo import ZoneInfo

    d = utc(value)
    if not d:
        return "–"
    return d.astimezone(ZoneInfo("Europe/Berlin")).strftime("%d.%m.%Y %H:%M" if with_time else "%d.%m.%Y")


def is_test_address(email: str) -> bool:
    from app.libs.onboarding_mail import is_test_address as check

    return check(email)


# --- Lesen ----------------------------------------------------------------------------------------------------------


def auth_accounts(app) -> list:
    """Alle Firebase-Konten als einfache Einträge (ohne Passwort-Hash)"""
    from firebase_admin import auth

    rows = []
    for user in auth.list_users(app=app).iterate_all():
        meta = user.user_metadata
        last = max(meta.last_sign_in_timestamp or 0, getattr(meta, "last_refresh_timestamp", None) or 0)
        rows.append({
            "uid": user.uid,
            "email": user.email or "",
            "emailVerified": bool(user.email_verified),
            "disabled": bool(user.disabled),
            "created": from_ms(meta.creation_timestamp),
            "lastSignIn": from_ms(last),
            "providers": sorted(p.provider_id for p in user.provider_data),
        })
    return rows


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

    shop_rows = {}
    for sid, s in shops.items():
        billing = s.get("billing") or {}
        shop_rows[sid] = {
            "id": sid, "name": s.get("name") or "(ohne Namen)", "owner": s.get("owner") or "", "email": s.get("email") or "",
            "created": utc(s.get("createdAt")), "founder": bool(s.get("founder")),
            "billing": billing.get("status") or "", "plan": billing.get("plan") or "",
            "services": 0, "staff": 0, "appointments": 0, "upcoming": 0, "customers": 0,
        }
    for svc in services.values():
        row = shop_rows.get(svc.get("shopId"))
        if row and not svc.get("archived"):
            row["services"] += 1
    for member in staff.values():
        row = shop_rows.get(member.get("shopId"))
        if row and member.get("isActive", True) is not False:
            row["staff"] += 1
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


def format_overview(ov: dict) -> str:
    shop_nr = {s["id"]: s for s in ov["shops"]}

    def shop_label(sid):
        s = shop_nr.get(sid)
        return f'{s["nr"]} „{s["name"]}“' if s else f"(Laden {sid} gibt es nicht mehr)"

    lines = [f"Dranzeit – Konten und Läden, Stand {fmt(ov['now'])} (nur gelesen, nichts geändert)", ""]
    lines.append(f"KONTEN: {len(ov['accounts'])} (älteste zuerst)")
    lines.append(LEGEND)
    for a in ov["accounts"]:
        verified = {True: "bestätigt", False: "unbestätigt", None: "–"}[a.get("emailVerified")]
        lines.append("")
        lines.append(f"{a['nr']:<4} {a['email'] or '(ohne E-Mail)'}" + (f"  ({a['name']})" if a["name"] else ""))
        lines.append(f"     Rolle {a['role'] or '–'} · angelegt {fmt(a['created'])} · zuletzt angemeldet {fmt(a['lastSignIn'])}"
                     f" · E-Mail {verified}" + (f" · Anmeldung {', '.join(a['providers'])}" if a["providers"] else ""))
        lines.append(f"     UID {a['uid']}")
        if a["shops"]:
            lines.append(f"     Inhaber: {', '.join(shop_label(s) for s in a['shops'])}")
        if a["staff"]:
            lines.append("     Team: " + ", ".join(
                f"{shop_label(s['shopId'])} ({s['role'] or 'ohne Rolle'}{'' if s['active'] else ', deaktiviert'})" for s in a["staff"]))
        if a["customers"]:
            lines.append(f"     Kunden-Einträge: {', '.join(shop_label(s) for s in a['customers'])}")
        lines.append(f"     Termine/Nummern als Kunde: {a['appointments']}" + (f" (davon {a['upcoming']} kommend)" if a["upcoming"] else ""))
        if a["markers"]:
            lines.append(f"     Kennzeichen: {', '.join(a['markers'])}")
    lines += ["", f"LÄDEN: {len(ov['shops'])} (älteste zuerst)"]
    for s in ov["shops"]:
        lines.append("")
        lines.append(f"{s['nr']:<4} {s['name']}  (ID {s['id']})")
        lines.append(f"     Inhaber {s['ownerLabel']} · angelegt {fmt(s['created'])} · Laden-E-Mail {s['email'] or '–'}")
        lines.append(f"     Leistungen {s['services']} · Team {s['staff']} · Kunden-Einträge {s['customers']} · Termine {s['appointments']}"
                     + (f" (davon {s['upcoming']} kommend)" if s["upcoming"] else ""))
        if s["markers"]:
            lines.append(f"     Kennzeichen: {', '.join(s['markers'])}")
    o = ov["orphans"]
    lines += [
        "",
        "REST OHNE KONTO",
        f"  Team-Einträge mit userId eines Kontos, das es nicht mehr gibt: {o['staff']}",
        f"  Kunden-Einträge mit userId eines Kontos, das es nicht mehr gibt: {o['customers']}",
        f"  Termine in Läden, die es nicht mehr gibt: {o['appointmentsInMissingShops']}",
    ]
    keep = [a["nr"] for a in ov["accounts"] if {"BETREIBER", "ITEBV"} & set(a["markers"])]
    tests = [a["nr"] for a in ov["accounts"] if {"FIXTURE", "LASTTEST", "E2E"} & set(a["markers"])]
    lines += [
        "",
        "ÜBERBLICK",
        f"  Betreiber oder ITEBV GmbH: {', '.join(keep) or 'keine'}",
        f"  aus Testskripten: {', '.join(tests) or 'keine'}",
        "  Gelöscht wird nur, was ausdrücklich genannt ist, z. B.: loeschen K1-K4,K7,L2",
    ]
    return "\n".join(lines)


def save_numbers(ov: dict, out_dir: Path = None) -> Path:
    """Nummern merken, damit "loeschen K3" genau das Konto aus dieser Liste meint (nur für root lesbar)"""
    out_dir = out_dir or OUT_DIR
    out_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = out_dir / f"liste-{ov['now'].strftime('%Y%m%d-%H%M%S')}.json"
    data = {
        "stand": ov["now"].isoformat(),
        "konten": {a["nr"]: {"uid": a["uid"], "email": a["email"]} for a in ov["accounts"]},
        "laeden": {s["nr"]: {"id": s["id"], "name": s["name"]} for s in ov["shops"]},
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(path, 0o600)
    return path


# --- Löschen --------------------------------------------------------------------------------------------------------


def latest_list(out_dir: Path = None) -> Path:
    files = sorted((out_dir or OUT_DIR).glob("liste-*.json"))
    if not files:
        raise SystemExit("Abbruch: Es gibt noch keine Liste. Erst: konten-aufraeumen.py liste")
    return files[-1]


def parse_selection(text: str, saved: dict) -> tuple:
    """"K1-K4,K7,L2" → (UIDs, Laden-IDs). Nur Nummern aus der gespeicherten Liste."""
    uids, shop_ids = [], []
    for part in [p.strip().upper() for p in (text or "").replace(" ", ",").split(",") if p.strip()]:
        m = re.fullmatch(r"([KL])(\d+)(?:-\1?(\d+))?", part)
        if not m:
            raise SystemExit(f"Abbruch: „{part}“ verstehe ich nicht. Erlaubt: K3, L2, K1-K4")
        kind, first, last = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        if last < first:
            raise SystemExit(f"Abbruch: „{part}“ – das Ende liegt vor dem Anfang.")
        table = saved["konten"] if kind == "K" else saved["laeden"]
        for n in range(first, last + 1):
            entry = table.get(f"{kind}{n}")
            if not entry:
                raise SystemExit(f"Abbruch: {kind}{n} steht nicht in der Liste vom {saved['stand'][:16]}.")
            target, value = (uids, entry["uid"]) if kind == "K" else (shop_ids, entry["id"])
            if value not in target:
                target.append(value)
    if not uids and not shop_ids:
        raise SystemExit("Abbruch: Nichts ausgewählt.")
    return uids, shop_ids


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
        shops.append({"id": sid, "name": shop.get("name") or "", "data": shop, "founder": bool(shop.get("founder")), "related": related})

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


def format_plan(plan: dict, numbers: dict) -> str:
    lines = []
    if plan["shops"]:
        lines.append(f"LÄDEN LÖSCHEN: {len(plan['shops'])}")
        for s in plan["shops"]:
            counts = ", ".join(f"{name} {len(docs)}" for name, docs in s["related"].items() if docs) or "sonst nichts"
            lines.append(f"  {numbers.get(s['id'], '')} „{s['name']}“ ({s['id']}): Laden, {counts}")
    if plan["users"]:
        lines.append(f"KONTEN LÖSCHEN (wie „Konto löschen“ im Profil): {len(plan['users'])}")
        for u in plan["users"]:
            parts = [
                f"Termine ohne Namen/Kontakt {len(u['appointments'])}" + (f" (davon {u['upcoming']} kommend → abgesagt)" if u["upcoming"] else ""),
                f"Push-Abos {len(u['push'])}", f"Angebote {len(u['offers'])}", f"Warteschlange alt {len(u['queue'])}",
                f"Kunden-Einträge {len(u['customers'])}", f"Profil {'ja' if u['profile'] else 'nein'}",
                f"Firebase-Konto {'ja' if u['auth'] else 'nein'}",
            ]
            lines.append(f"  {numbers.get(u['uid'], '')} {u['email'] or u['uid']}: " + ", ".join(parts))
            if u["staff"]:
                lines.append(f"      Team-Einträge in Läden, die bleiben: {len(u['staff'])} – Verbindung zum Konto wird gelöst, Person bleibt")
    f = plan["founders"]
    if f["freed"]:
        lines.append(f"GRÜNDERPLÄTZE: {f['freed']} wieder frei (Zähler {f['count']} → {f['count'] - f['freed']})")
    if plan["problems"]:
        lines.append("")
        lines.append("ABBRUCH, so wird nichts gelöscht:")
        lines += [f"  - {p}" for p in plan["problems"]]
    return "\n".join(lines)


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
        fs.collection("shops").document(s["id"]).delete()
        result["shops"] += 1
    f = plan["founders"]
    if f["freed"]:
        f["doc"].reference.update({"count": f["count"] - f["freed"], "updatedAt": now})
    for u in plan["users"]:
        for snap in u["staff"]:
            snap.reference.update({"userId": "", "updatedAt": now})
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


# --- Aufruf ---------------------------------------------------------------------------------------------------------


def firebase():
    import contextlib
    import io

    load_env()
    sys.path.insert(0, os.getcwd())
    from app.apis.firebase_utils import get_firebase_app, get_firestore_db

    # Hinweis der Firestore-Bibliothek zu where(); PowerShell zeigt ihn sonst als roten Fehler
    warnings.filterwarnings("ignore", message="Detected filter using positional arguments")
    with contextlib.redirect_stdout(io.StringIO()):  # Startmeldungen von firebase_utils nicht in die Liste
        return get_firestore_db(), get_firebase_app()


def cmd_liste() -> None:
    fs, app = firebase()
    ov = overview(fs, auth_accounts(app), env_set("QME_ADMIN_EMAILS"), env_set("QME_ADMIN_UIDS"))
    print(format_overview(ov))
    path = save_numbers(ov)
    print(f"\nNummern gemerkt in {path}. Nichts geändert.")


def cmd_loeschen(selection: str, run: bool) -> None:
    from firebase_admin import auth

    fs, app = firebase()
    list_file = latest_list()
    saved = json.loads(list_file.read_text(encoding="utf-8"))
    uids, shop_ids = parse_selection(selection, saved)
    accounts = {a["uid"]: {**a, "auth": True} for a in auth_accounts(app)}
    numbers = {v["uid"]: k for k, v in saved["konten"].items()} | {v["id"]: k for k, v in saved["laeden"].items()}
    plan = plan_deletion(fs, uids, shop_ids, accounts, env_set("QME_ADMIN_EMAILS"), env_set("QME_ADMIN_UIDS"))
    print(f"Auswahl {selection} aus der Liste vom {fmt(datetime.fromisoformat(saved['stand']))} ({list_file})")
    print(format_plan(plan, numbers))
    if plan["problems"]:
        raise SystemExit(1)
    if not run:
        print("\nProbelauf – nichts geändert. Zum Ausführen denselben Befehl mit --ausfuehren.")
        return

    OUT_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = OUT_DIR / f"sicherung-{plan['now'].strftime('%Y%m%d-%H%M%S')}.json"
    backup.write_text(json.dumps(backup_data(plan, selection, str(list_file)), ensure_ascii=False, indent=1), encoding="utf-8")
    os.chmod(backup, 0o600)
    print(f"\nSicherung: {backup} ({backup.stat().st_size // 1024} KB)")

    def delete_auth_user(uid):
        try:
            auth.delete_user(uid, app=app)
        except auth.UserNotFoundError:
            pass  # nur ein Profil ohne Konto

    def auth_exists(uid):
        try:
            auth.get_user(uid, app=app)
            return True
        except auth.UserNotFoundError:
            return False

    result = execute(fs, plan, delete_auth_user)
    print(f"Gelöscht: {result['shops']} Läden mit {result['shopDocs']} Dokumenten, {result['accounts']} Konten; "
          f"{result['anonymized']} Termine ohne Namen (davon {result['cancelled']} abgesagt), "
          f"{result['staffUnlinked']} Team-Einträge vom Konto gelöst.")
    left = verify(fs, plan, auth_exists)
    if left:
        print("NACHPRÜFUNG: Es ist noch etwas da:")
        print("\n".join(f"  - {line}" for line in left))
        raise SystemExit(1)
    print("Nachprüfung: alles Ausgewählte ist weg. Fertig.")


def main(argv: list) -> None:
    if len(argv) >= 1 and argv[0] == "liste":
        cmd_liste()
    elif len(argv) >= 2 and argv[0] == "loeschen" and set(argv[2:]) <= {"--ausfuehren"}:
        cmd_loeschen(argv[1], "--ausfuehren" in argv[2:])
    else:
        raise SystemExit("Aufruf: konten-aufraeumen.py liste | loeschen K1-K4,K7,L2 [--ausfuehren]")


if __name__ == "__main__":
    main(sys.argv[1:])
