#!/usr/bin/env python3
"""Prüft den Zugang zu PIN eBrief, ohne einen Brief zu schicken: holt nur ein Anmelde-Token (app/libs/briefdienst.py).
Als root auf dem Server (liest /etc/q-me.env selbst, gibt keine Zugangsdaten aus):
    cd /opt/q-me/backend && .venv/bin/python ../deploy/pin-pruefen.py test
    cd /opt/q-me/backend && .venv/bin/python ../deploy/pin-pruefen.py echt
Ausgabe: eine Zeile „PIN eBrief (…): Anmeldung klappt.“ oder der Grund, warum nicht. Exit 0 = klappt.
"""
import os
import sys

sys.path.insert(0, os.getcwd())


def lade_umgebung(path: str = "/etc/q-me.env") -> None:
    if not os.path.exists(path):
        return
    from dotenv import load_dotenv

    load_dotenv(path, override=False)


def main() -> int:
    lade_umgebung()
    from app.libs import briefdienst

    test = (sys.argv[1] if len(sys.argv) > 1 else "test") != "echt"
    name = "Testumgebung" if test else "echter Versand"
    if not briefdienst.eingerichtet()["test" if test else "echt"]:
        print(f"PIN eBrief ({name}): keine Zugangsdaten eingetragen.")
        return 2
    try:
        briefdienst.PinEbrief(test=test)._anmelden()
    except Exception as e:
        print(f"PIN eBrief ({name}): Anmeldung klappt nicht – {e}")
        return 1
    print(f"PIN eBrief ({name}): Anmeldung klappt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
