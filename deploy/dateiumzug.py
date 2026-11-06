"""Ältere Logos und Fotos aus Firebase Storage auf den eigenen Server holen (Stufe 5, requirements/eigene-datenbank.md).

Seit Stufe 2 lädt die App neue Bilder zum eigenen Server hoch (backend/app/libs/laeden.py, /var/lib/q-me/dateien).
Ältere stehen noch als Adresse auf firebasestorage.googleapis.com in den Daten (logoUrl, profileImageUrl …). Dieses
Skript sucht jede solche Adresse in allen Dokumenten, lädt das Bild (öffentlich lesbar, storage.rules), prüft, dass es
ein PNG, JPEG oder WebP ist, legt es wie ein hochgeladenes Bild ab und setzt die neue Adresse ein. Dieselbe Adresse wird
nur einmal geholt. Was sich nicht laden lässt, bleibt stehen und wird gemeldet.

Beliebig oft wiederholbar: Ein zweiter Lauf findet nichts mehr. Aufruf auf dem Server über deploy/dateiumzug.sh umzug
(als Benutzer q-me mit der Umgebung des Dienstes); --probe zählt nur.
"""

import argparse
import os
import re
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

FIREBASE = re.compile(r"^https://firebasestorage\.googleapis\.com/v0/b/[^/]+/o/([^?#]+)")
ORDNER = ("shop-logos", "staff-profile-images")


def laden_aus(adresse: str) -> str | None:
    """Laden-ID aus dem Pfad im Speicher (shop-logos/<Laden>/<Datei>, staff-profile-images/<Laden>/<Datei>). Ältere
    Uploads liegen teils unter anderen Pfaden (etwa undefined/<Datei>); dann zählt der Laden des Dokuments
    (laden_im_dokument)."""
    treffer = FIREBASE.match(adresse)
    if not treffer:
        return None
    teile = unquote(treffer.group(1)).split("/")
    if len(teile) < 3 or teile[0] not in ORDNER or not re.match(r"^[A-Za-z0-9_-]{1,64}$", teile[1]):
        return None
    return teile[1]


def laden_im_dokument(sammlung: str, doc_id: str, daten: dict) -> str | None:
    """Zu welchem Laden gehört das Dokument: der Laden selbst oder sein Feld shopId"""
    laden = doc_id if sammlung == "shops" else daten.get("shopId")
    return laden if isinstance(laden, str) and re.match(r"^[A-Za-z0-9_-]{1,64}$", laden) else None


def adressen(wert, gefunden: set) -> None:
    if isinstance(wert, str):
        if FIREBASE.match(wert):
            gefunden.add(wert)
    elif isinstance(wert, dict):
        for v in wert.values():
            adressen(v, gefunden)
    elif isinstance(wert, list):
        for v in wert:
            adressen(v, gefunden)


def ersetzen(wert, neu: dict):
    if isinstance(wert, str):
        return neu.get(wert, wert)
    if isinstance(wert, dict):
        return {k: ersetzen(v, neu) for k, v in wert.items()}
    if isinstance(wert, list):
        return [ersetzen(v, neu) for v in wert]
    return wert


def herunterladen(adresse: str) -> bytes:
    import requests

    antwort = requests.get(adresse, timeout=30)
    antwort.raise_for_status()
    return antwort.content


def umziehen(db, sammlungen: list[str], probe: bool = False, holen=herunterladen) -> dict:
    """Alle Dokumente dieser Sammlungen durchsehen, Bilder holen und Adressen ersetzen. Rückgabe: Zahlen und Fehler"""
    from app import seo
    from app.libs import laeden

    fundstellen = []  # (Sammlung, ID, Daten, Adressen)
    for sammlung in sammlungen:
        for snap in db.collection(sammlung).stream():
            daten = snap.to_dict() or {}
            gefunden: set = set()
            adressen(daten, gefunden)
            if gefunden:
                fundstellen.append((sammlung, snap.id, daten, gefunden))
    alle = sorted({a for *_, g in fundstellen for a in g})
    # Laden je Adresse: aus dem Pfad, sonst aus dem (ersten) Dokument, in dem sie steht
    kontext = {}
    for sammlung, doc_id, daten, gefunden in fundstellen:
        for a in gefunden:
            kontext.setdefault(a, laden_im_dokument(sammlung, doc_id, daten))
    ergebnis = {"dokumente": len(fundstellen), "adressen": len(alle), "geholt": 0, "fehler": []}
    if probe:
        return ergebnis
    neu = {}
    for adresse in alle:
        laden = laden_aus(adresse) or kontext.get(adresse)
        if laden is None:
            ergebnis["fehler"].append(f"{adresse[:80]}…: kein Laden zu erkennen")
            continue
        try:
            name = laeden.bild_speichern(laden, holen(adresse))
        except Exception as e:  # nicht da, kein Bild, zu groß
            ergebnis["fehler"].append(f"{laden}: {e.__class__.__name__}: {str(e)[:120]}")
            continue
        neu[adresse] = f"{seo.public_url()}/routes/live/dateien/{laden}/{name}"
        ergebnis["geholt"] += 1
    for sammlung, doc_id, daten, gefunden in fundstellen:
        if gefunden & set(neu):
            db.collection(sammlung).document(doc_id).set(ersetzen(daten, neu))
    return ergebnis


def sammlungen() -> list[str]:
    """Alle Sammlungen samt Unter-Sammlungen (PostgreSQL: Spalte sammlung)"""
    from sqlalchemy import text

    from app.libs import datenbank

    with datenbank.engine().connect() as conn:
        return [z[0] for z in conn.execute(text("select distinct sammlung from dokumente order by 1"))]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--probe", action="store_true", help="nur zählen, nichts holen und nichts ändern")
    args = parser.parse_args()

    from app import store

    ergebnis = umziehen(store.db(), sammlungen(), probe=args.probe)
    print(f"Dokumente mit Firebase-Bildern: {ergebnis['dokumente']}, verschiedene Bilder: {ergebnis['adressen']}")
    if args.probe:
        print("Probelauf, nichts geändert.")
        return 0
    print(f"Geholt und ersetzt: {ergebnis['geholt']}")
    for f in ergebnis["fehler"]:
        print(f"  nicht geholt: {f}")
    return 1 if ergebnis["fehler"] else 0


if __name__ == "__main__":
    sys.exit(main())
