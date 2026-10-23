#!/usr/bin/env python3
"""Adressen in Firebase Authentication als erlaubte Anmelde-Domains eintragen (sonst scheitert Google-Login).

Auf dem Server als root, mit dem Dienstkonto aus /etc/q-me.env (FIREBASE_SERVICE_ACCOUNT_KEY_FILE):
    cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/firebase-domains.py dranzeit.de www.dranzeit.de
Ohne Domains: zeigt nur die eingetragenen. Entfernt nie etwas. Der Schlüssel wird nur gelesen, nie ausgegeben.
"""

import os
import sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

ENV_FILE = "/etc/q-me.env"


def env(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            key, sep, value = line.strip().partition("=")
            if sep and key == name:
                return value.strip()
    return ""


def main() -> None:
    project = env("FIREBASE_PROJECT_ID") or "qmedata-7c79e"
    key_file = env("FIREBASE_SERVICE_ACCOUNT_KEY_FILE")
    if not key_file or not os.path.isfile(key_file):
        sys.exit("Abbruch: FIREBASE_SERVICE_ACCOUNT_KEY_FILE fehlt oder zeigt auf keine Datei.")
    creds = service_account.Credentials.from_service_account_file(key_file, scopes=["https://www.googleapis.com/auth/cloud-platform"])
    session = AuthorizedSession(creds)
    url = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{project}/config"

    current = session.get(url, timeout=20)
    if current.status_code != 200:
        sys.exit(f"Abbruch: Firebase-Einstellungen nicht lesbar ({current.status_code}): {current.text[:300]}")
    domains = current.json().get("authorizedDomains", [])
    wanted = [d.strip().lower() for d in sys.argv[1:] if d.strip()]
    missing = [d for d in wanted if d not in domains]
    if not missing:
        print("Eingetragen sind:", ", ".join(domains))
        return
    update = session.patch(url, params={"updateMask": "authorizedDomains"}, json={"authorizedDomains": domains + missing}, timeout=20)
    if update.status_code != 200:
        sys.exit(f"Abbruch: Eintragen abgelehnt ({update.status_code}): {update.text[:300]}")
    print("Neu eingetragen:", ", ".join(missing))
    print("Eingetragen sind:", ", ".join(update.json().get("authorizedDomains", [])))


if __name__ == "__main__":
    main()
