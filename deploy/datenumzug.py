"""Umzug aller Daten von Firestore nach PostgreSQL (requirements/eigene-datenbank.md, Stufe 3).

Liest alle Sammlungen samt Unter-Sammlungen aus Firestore und schreibt sie unverändert in die Tabelle `dokumente`
(app/store/postgres.py) – in einer einzigen Transaktion: Erst wird die Tabelle geleert, dann alles eingefügt. Danach
vergleicht es Anzahlen je Sammlung und eine Stichprobe Dokument für Dokument. Beliebig oft wiederholbar.

Aufruf nur über deploy/datenumzug.sh (dort Wartung, Umschalten und Zurück):

    datenumzug.py --ziel <postgresql://…>          # schreiben und vergleichen
    datenumzug.py --ziel <postgresql://…> --lesen  # nur lesen und zählen, nichts schreiben

Braucht die Umgebung des Dienstes (Firebase-Dienstkonto aus /etc/q-me.env). Gibt keine Inhalte aus, nur Pfade,
Anzahlen und Abweichungen.
"""

import argparse
import json
import os
import random
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")
sys.path.insert(0, BACKEND)

STICHPROBE = 300
STUECK = 500


def _pfad_der_sammlung(col) -> str:
    oben = col.parent
    return f"{oben.path}/{col.id}" if oben is not None else col.id


def alle_dokumente(fs) -> list[tuple[str, str, dict]]:
    """(Pfad der Sammlung, ID, Inhalt) für alle Dokumente, auch in Unter-Sammlungen. Dokumente, die es selbst nicht
    gibt, die aber Unter-Sammlungen haben (Firestore erlaubt das), fehlen als Zeile, ihre Unter-Sammlungen nicht."""
    ergebnis: list[tuple[str, str, dict]] = []

    def sammlung(col, pool):
        pfad = _pfad_der_sammlung(col)
        for snap in col.stream():
            ergebnis.append((pfad, snap.id, snap.to_dict() or {}))
        refs = list(col.list_documents())
        for unter in pool.map(lambda r: list(r.collections()), refs):
            for c in unter:
                sammlung(c, pool)

    with ThreadPoolExecutor(16) as pool:
        for col in fs.collections():
            sammlung(col, pool)
    return ergebnis


def kodieren_alle(dokumente):
    """Alles in JSON fürs jsonb; Werte, die PostgreSQL nicht kennt (GeoPoint, Bytes, Verweise), als Liste melden"""
    from app.store import postgres as pg

    zeilen, fehler = [], []
    for sammlung, doc_id, daten in dokumente:
        try:
            zeilen.append({"s": sammlung, "i": doc_id, "d": json.dumps(pg.kodieren(daten), ensure_ascii=False)})
        except (TypeError, ValueError) as e:
            fehler.append(f"{sammlung}/{doc_id}: {e}")
    return zeilen, fehler


def umziehen(fs, ziel: str, lesen: bool = False) -> int:
    """Alles aus fs (Firestore-Client) nach ziel (PostgreSQL-Adresse); 0, wenn der Vergleich stimmt"""
    from sqlalchemy import create_engine, text

    from app.libs import datenbank
    from app.store import postgres as pg

    t0 = time.monotonic()
    dokumente = alle_dokumente(fs)
    anzahl = Counter(s for s, _, _ in dokumente)
    print(f"Firestore: {len(dokumente)} Dokumente in {len(anzahl)} Sammlungen ({time.monotonic() - t0:.0f} s)")
    for sammlung, n in sorted(anzahl.items()):
        print(f"    {n:>7}  {sammlung}")
    zeilen, fehler = kodieren_alle(dokumente)
    if fehler:
        print(f"FEHLER: {len(fehler)} Dokumente mit Werten, die sich nicht speichern lassen:", file=sys.stderr)
        for f in fehler[:30]:
            print(f"    {f}", file=sys.stderr)
        return 1
    if lesen:
        print("Nur gelesen, nichts geschrieben.")
        return 0

    engine = create_engine(datenbank.sqlalchemy_url(ziel), connect_args={"connect_timeout": 10})
    t1 = time.monotonic()
    with engine.begin() as conn:
        conn.execute(text("truncate dokumente"))
        einfuegen = text("insert into dokumente (sammlung, id, daten, geaendert) values (:s, :i, cast(:d as jsonb), now())")
        for i in range(0, len(zeilen), STUECK):
            conn.execute(einfuegen, zeilen[i:i + STUECK])
    print(f"PostgreSQL: {len(zeilen)} Zeilen geschrieben ({time.monotonic() - t1:.0f} s)")

    # Vergleich: Anzahlen je Sammlung und eine Stichprobe Dokument für Dokument
    abweichungen = []
    with engine.connect() as conn:
        dort = dict(conn.execute(text("select sammlung, count(*) from dokumente group by sammlung")).all())
        for sammlung in sorted(set(anzahl) | set(dort)):
            if anzahl.get(sammlung, 0) != dort.get(sammlung, 0):
                abweichungen.append(f"Anzahl {sammlung}: Firestore {anzahl.get(sammlung, 0)}, PostgreSQL {dort.get(sammlung, 0)}")
        probe = random.sample(dokumente, min(STICHPROBE, len(dokumente)))
        abfrage = text("select daten from dokumente where sammlung = :s and id = :i")
        for sammlung, doc_id, daten in probe:
            zeile = conn.execute(abfrage, {"s": sammlung, "i": doc_id}).first()
            erwartet = pg.dekodieren(pg.kodieren(daten))  # Zeitpunkte auf die Mikrosekunde in UTC, wie gespeichert
            if zeile is None or pg.dekodieren(zeile.daten) != erwartet:
                abweichungen.append(f"Inhalt {sammlung}/{doc_id}")
    if abweichungen:
        print(f"FEHLER: {len(abweichungen)} Abweichungen:", file=sys.stderr)
        for a in abweichungen[:30]:
            print(f"    {a}", file=sys.stderr)
        return 1
    print(f"Vergleich stimmt: {len(anzahl)} Sammlungen, Stichprobe {len(probe)} Dokumente.")
    engine.dispose()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ziel", required=True, help="PostgreSQL-Adresse der Ziel-Datenbank")
    parser.add_argument("--lesen", action="store_true", help="nur lesen und zählen")
    args = parser.parse_args()

    from app.apis.firebase_utils import get_firestore_db

    return umziehen(get_firestore_db(), args.ziel, args.lesen)


if __name__ == "__main__":
    sys.exit(main())
