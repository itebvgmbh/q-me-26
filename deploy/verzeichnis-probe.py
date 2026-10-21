#!/usr/bin/env python3
"""Probelauf fürs Salon-Verzeichnis: Google-Suche und Auslesen einer Webseite, ohne etwas zu speichern.

Zeigt, ob GOOGLE_MAPS_API_KEY (Places API (New), Textsuche) und ANTHROPIC_API_KEY gehen und was die KI aus einer
Salon-Webseite macht – genau wie „Ausgewählte anlegen“ im Betreiber-Bereich, nur ohne Firestore.
Als root auf dem Server (liest /etc/q-me.env selbst, gibt keine Schlüssel aus):

    cd /opt/q-me/backend && .venv/bin/python ../deploy/verzeichnis-probe.py --suche "Friseur Tegel"
    cd /opt/q-me/backend && .venv/bin/python ../deploy/verzeichnis-probe.py --webseite https://salon-beispiel.de
    cd /opt/q-me/backend && .venv/bin/python ../deploy/verzeichnis-probe.py --suche "Barbershop Wedding" --anlegen 3

--anlegen N liest die ersten N Treffer mit eigener Webseite aus (kostet je Salon ein paar Cent bei Claude).
"""

import argparse
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.getcwd())


def lade_umgebung(path: str = "/etc/q-me.env") -> None:
    if not os.path.exists(path):
        return
    from dotenv import load_dotenv

    load_dotenv(path, override=False)


def zeige(profil: dict) -> None:
    def default(value):
        return value.isoformat() if isinstance(value, datetime) else str(value)

    print(json.dumps(profil, ensure_ascii=False, indent=2, default=default))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--suche", help="Google-Textsuche, z. B. \"Friseur Tegel\"")
    parser.add_argument("--webseite", help="eine Salon-Webseite auslesen")
    parser.add_argument("--anlegen", type=int, default=0, help="die ersten N Treffer der Suche auslesen")
    args = parser.parse_args()
    if not args.suche and not args.webseite:
        parser.print_help()
        return 2
    lade_umgebung()
    from fastapi import HTTPException

    from app.libs import verzeichnis_import as imp

    print(f"Google-Suche eingerichtet: {'ja' if imp.google_key() else 'NEIN'} · Webseiten lesen: {'ja' if imp.ai_configured() else 'NEIN'}")
    ziele = []
    if args.suche:
        try:
            result = imp.google_suche(args.suche)
        except HTTPException as e:
            print(f"Suche fehlgeschlagen: {e.detail}")
            return 1
        for t in result["treffer"]:
            merk = [x for x, ok in (("andere Branche", t["kategorie"] is None), ("geschlossen", t["geschlossen"])) if ok]
            web = t["website"] or (f"keine eigene ({t['websiteFremd']})" if t["websiteFremd"] else "keine Webseite")
            print(f"- {t['name']} · {t['address']} · {web}{' · ' + ', '.join(merk) if merk else ''}")
        print(f"{len(result['treffer'])} Treffer{' (es gibt weitere)' if result['nextPageToken'] else ''}. Suchergebnisse: Google Maps")
        ziele = [t for t in result["treffer"] if t["website"] and t["kategorie"] and not t["geschlossen"]][: args.anlegen]
    if args.webseite:
        ziele.append({"website": args.webseite, "name": "", "address": ""})
    for t in ziele:
        print(f"\n=== {t.get('name') or t['website']} ===")
        try:
            profil = imp.mit_lage(imp.profil_von_webseite(t["website"], t.get("name", ""), t.get("address", "")))
        except HTTPException as e:
            print(f"nicht angelegt: {e.detail}")
            continue
        zeige(profil)
    return 0


if __name__ == "__main__":
    sys.exit(main())
