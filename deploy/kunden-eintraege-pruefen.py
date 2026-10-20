#!/usr/bin/env python3
"""Einmalige Prüfung (20.10.2026): Kunden-Einträge ohne verbundenes Konto, deren E-Mail zu einem Konto gehört.

Bis zu diesem Stand legte "Nummer ziehen" mit Konto einen NICHT verbundenen Eintrag in customers an. Wählt der Laden
so jemanden in "Mein Tag" als "Bestandskunde", geht der Termin an die ID des Eintrags statt ans Konto, und der
Datenschutz-Lauf löscht den Eintrag nach 12 Monaten. Neu verbindet POST /routes/customer-link/{shopId} beim Buchen.

Nur lesen, nichts ändern. Gibt nur Zahlen aus, keine Namen oder Adressen. Auf dem Server als root:
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/kunden-eintraege-pruefen.py
Den Firebase-Schlüssel liest das Backend wie im Betrieb (Pfad aus /etc/q-me.env), er wird nie ausgegeben.
"""

import os
import sys
from collections import Counter
from datetime import datetime, timezone

ENV_FILE = os.environ.get("QME_ENV_FILE", "/etc/q-me.env")


def load_env() -> None:
    """Firebase-Einträge aus /etc/q-me.env übernehmen (ohne die Datei per Shell einzulesen)"""
    if not os.path.exists(ENV_FILE):
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            name, sep, value = line.strip().partition("=")
            if sep and name.startswith("FIREBASE_") and not os.environ.get(name):
                os.environ[name] = value.strip()


def utc(value):
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def main() -> None:
    load_env()
    sys.path.insert(0, os.getcwd())
    from firebase_admin import auth

    from app.apis.firebase_utils import get_firebase_app, get_firestore_db

    db = get_firestore_db()
    app = get_firebase_app()
    now = datetime.now(timezone.utc)

    rows = [(d.id, d.to_dict() or {}) for d in db.collection("customers").stream()]
    shops = {d.id: d.to_dict() or {} for d in db.collection("shops").stream()}
    linked = [(i, c) for i, c in rows if c.get("userId")]
    open_rows = [(i, c) for i, c in rows if not c.get("userId")]
    print(f"Kunden-Einträge gesamt: {len(rows)}  verbunden: {len(linked)}  nicht verbunden: {len(open_rows)}")

    # Konten zu den E-Mails der nicht verbundenen Einträge (Firebase vergleicht ohne Groß/klein)
    emails = sorted({(c.get("email") or "").strip().lower() for _, c in open_rows if (c.get("email") or "").strip()})
    identifiers = []
    for e in emails:
        try:
            identifiers.append(auth.EmailIdentifier(e))
        except ValueError:  # vom Laden vertippt, kein Konto möglich
            pass
    accounts = {}
    for start in range(0, len(identifiers), 100):
        result = auth.get_users(identifiers[start : start + 100], app=app)
        for user in result.users:
            accounts[(user.email or "").lower()] = user
    print(f"  davon mit E-Mail: {sum(1 for _, c in open_rows if (c.get('email') or '').strip())}, "
          f"verschiedene Adressen: {len(emails)}, davon mit Konto: {len(accounts)}")

    linked_pairs = {(c.get("shopId"), c.get("userId")) for _, c in linked}
    stats = Counter()
    per_shop = Counter()
    for entry_id, c in open_rows:
        user = accounts.get((c.get("email") or "").strip().lower())
        if not user:
            continue
        shop_id = c.get("shopId")
        stats["Konto zur E-Mail"] += 1
        shop = shops.get(shop_id) or {}
        per_shop[shop.get("name") or shop_id] += 1
        stats["  E-Mail im Konto bestätigt"] += bool(user.email_verified)
        stats["  ohne Feld phone (so legte es das Nummer-Ziehen an)"] += "phone" not in c
        stats["  Laden selbst ist das Konto (Inhaber)"] += shop.get("owner") == user.uid
        stats["  daneben schon ein verbundener Eintrag desselben Kontos"] += (shop_id, user.uid) in linked_pairs
        own = [a.to_dict() or {} for a in db.collection("appointments").where("customerId", "==", user.uid).stream()]
        own_here = [a for a in own if a.get("shopId") == shop_id]
        stats["  Konto hat Termine/Nummern in diesem Laden"] += bool(own_here)
        stats["  davon Nummer gezogen (type queue)"] += any(a.get("type") == "queue" for a in own_here)
        sure = "phone" not in c and any(a.get("type") == "queue" for a in own_here)
        stats["  sicher selbst angelegt (ohne phone UND Nummer im Laden gezogen)"] += sure
        on_entry = [a.to_dict() or {} for a in db.collection("appointments").where("customerId", "==", entry_id).stream()]
        on_entry = [a for a in on_entry if a.get("shopId") == shop_id]
        stats["  Einträge mit Terminen auf der Eintrags-ID (fehlen unter Meine Termine)"] += bool(on_entry)
        stats["    Termine auf der Eintrags-ID"] += len(on_entry)
        stats["    davon kommend und geplant"] += sum(
            1 for a in on_entry if a.get("status") == "scheduled" and (utc(a.get("startTime")) or now) > now
        )
        last = max([d for d in (utc(c.get("createdAt")), utc(c.get("updatedAt"))) if d], default=None)
        stats["  älter als 12 Monate ohne Änderung (fiele unter die Löschfrist)"] += bool(last and (now - last).days > 365)

    for name in [
        "Konto zur E-Mail",
        "  E-Mail im Konto bestätigt",
        "  ohne Feld phone (so legte es das Nummer-Ziehen an)",
        "  Konto hat Termine/Nummern in diesem Laden",
        "  davon Nummer gezogen (type queue)",
        "  sicher selbst angelegt (ohne phone UND Nummer im Laden gezogen)",
        "  Laden selbst ist das Konto (Inhaber)",
        "  daneben schon ein verbundener Eintrag desselben Kontos",
        "  Einträge mit Terminen auf der Eintrags-ID (fehlen unter Meine Termine)",
        "    Termine auf der Eintrags-ID",
        "    davon kommend und geplant",
        "  älter als 12 Monate ohne Änderung (fiele unter die Löschfrist)",
    ]:
        print(f"{name}: {stats[name]}")
    print("Je Laden (nicht verbunden, Konto zur E-Mail):")
    for shop, count in per_shop.most_common():
        print(f"  {shop}: {count}")
    print("Nichts geändert.")


if __name__ == "__main__":
    main()
