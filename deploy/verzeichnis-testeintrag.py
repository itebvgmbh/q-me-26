#!/usr/bin/env python3
"""Testeintrag fürs Salon-Verzeichnis: „Eintrag entfernen“ einmal echt durchspielen, ohne dass ein Salon Post bekommt.

Die Webseite des Eintrags ist https://itebv.de, darum passt eine Adresse @itebv.de. Er hat keine Lage und steht daher
nicht auf der Karte, solange er existiert. Als root auf dem Server (liest /etc/q-me.env selbst, gibt keine Schlüssel aus):

    cd /opt/q-me/backend && .venv/bin/python ../deploy/verzeichnis-testeintrag.py anlegen
    cd /opt/q-me/backend && .venv/bin/python ../deploy/verzeichnis-testeintrag.py status
    cd /opt/q-me/backend && .venv/bin/python ../deploy/verzeichnis-testeintrag.py loeschen
"""

import contextlib
import io
import os
import sys

sys.path.insert(0, os.getcwd())

ID = "test-entfernen-probe"


def lade_umgebung(path: str = "/etc/q-me.env") -> None:
    if not os.path.exists(path):
        return
    from dotenv import load_dotenv

    load_dotenv(path, override=False)


def main() -> int:
    was = sys.argv[1] if len(sys.argv) > 1 else ""
    if was not in ("anlegen", "status", "loeschen"):
        print(__doc__)
        return 2
    lade_umgebung()
    from app.apis.firebase_utils import get_firestore_db
    from app.libs import verzeichnis as vz

    with contextlib.redirect_stdout(io.StringIO()):  # Startmeldungen von firebase_utils nicht in die Ausgabe
        get_firestore_db()
    st = vz.store()
    if was == "anlegen":
        jetzt = vz.now()
        st.neu({"name": "Testeintrag Dranzeit (wird gleich geloescht)", "kategorie": "friseur", "street": "Teststrasse 1",
                "postalCode": "13403", "city": "Berlin", "stadtSlug": "berlin", "slug": ID, "website": "https://itebv.de",
                "status": "online", "wuensche": 0, "angelegtAm": jetzt, "geaendertAm": jetzt, "veroeffentlichtAm": jetzt}, ID)
        print(f"angelegt: {ID}")
    elif was == "status":
        entry = st.hole(ID)
        print(f"status: {entry.get('status') if entry else 'gibt es nicht'}")
    else:
        st.loesche(ID)
        print("weg" if st.hole(ID) is None else "noch da")
    return 0


if __name__ == "__main__":
    sys.exit(main())
