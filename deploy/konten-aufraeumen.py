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
Lesen und Löschen stehen in backend/app/libs/konten.py, damit der Betreiber-Bereich (/betreiber) dasselbe tut.
"""

import json
import os
import re
import sys
import warnings
from datetime import datetime
from pathlib import Path

# Gemeinsam mit dem Betreiber-Bereich: backend/app/libs/konten.py (auf dem Server /opt/q-me/backend)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.libs.konten import ITEBV_SHOP, auth_accounts, backup_data, execute, overview, plan_deletion, utc, verify  # noqa: E402,F401

ENV_FILE = os.environ.get("QME_ENV_FILE", "/etc/q-me.env")
OUT_DIR = Path(os.environ.get("QME_KONTEN_DIR", "/root/dranzeit-konten"))
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


def fmt(value, with_time: bool = True) -> str:
    """Deutsche Zeit, "–" wenn unbekannt"""
    from zoneinfo import ZoneInfo

    d = utc(value)
    if not d:
        return "–"
    return d.astimezone(ZoneInfo("Europe/Berlin")).strftime("%d.%m.%Y %H:%M" if with_time else "%d.%m.%Y")


# --- Lesen ----------------------------------------------------------------------------------------------------------


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
