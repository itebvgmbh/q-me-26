"""
Vertrag der Speicher-Schicht (app/store, requirements/eigene-datenbank.md): So verhält sich der Teil von Firestore, den
das Backend benutzt. Die Tests laufen auf GitHub gegen den Firestore-Emulator (Workflow „Datenbank“). In Stufe 3 muss
die Umsetzung auf PostgreSQL genau dieselben Tests bestehen. Weicht sie ab, ändert sich das Verhalten der App.

Ohne Emulator wird alles übersprungen. Mit Emulator (Java und firebase-tools aus dev/regeln):

    cd dev/regeln && npx firebase emulators:exec --only firestore --project demo-dranzeit \
        "../../backend/.venv/bin/python ../../backend/tests/test_speicher_vertrag.py"

Jeder Lauf schreibt in eigene Sammlungen (vertrag_<zufall>_…), im Emulator also ohne Rückstände für andere Tests.
"""
import os
import secrets
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app import store  # noqa: E402

LAUF = "vertrag_" + secrets.token_hex(3)
UTC = timezone.utc
BERLIN = ZoneInfo("Europe/Berlin")


def client():
    """Client für den Vertrag: Firestore-Emulator, in Stufe 3 zusätzlich PostgreSQL."""
    if os.environ.get("FIRESTORE_EMULATOR_HOST"):
        from google.cloud import firestore

        return firestore.Client(project=os.environ.get("GCLOUD_PROJECT", "demo-dranzeit"))
    return None


def sammlung(db, name):
    return db.collection(f"{LAUF}_{name}")


def ids(snaps):
    return [s.id for s in snaps]


# --- Dokumente lesen und schreiben ---------------------------------------------------------------------------------


def vertrag_fehlendes_dokument(db):
    snap = sammlung(db, "leer").document("gibtsnicht").get()
    assert snap.exists is False
    assert snap.to_dict() is None
    assert snap.id == "gibtsnicht"


def vertrag_werte_kommen_unveraendert_zurueck(db):
    wann = datetime(2026, 11, 4, 9, 30, 15, 123456, tzinfo=UTC)
    daten = {
        "text": "Grüße", "zahl": 7, "komma": 2.5, "ja": True, "nein": False, "nichts": None,
        "liste": [1, "zwei", {"drei": 3}], "karte": {"innen": {"tief": "x"}, "leer": {}},
        "zeit": wann, "leere_liste": [],
    }
    ref = sammlung(db, "werte").document("a")
    ref.set(daten)
    zurueck = ref.get().to_dict()
    assert zurueck == daten, zurueck
    assert isinstance(zurueck["zahl"], int) and isinstance(zurueck["komma"], float)
    # Zeitpunkte kommen als datetime in UTC zurück, auf die Mikrosekunde
    assert zurueck["zeit"].tzinfo is not None and zurueck["zeit"].utcoffset() == timedelta(0)
    assert zurueck["zeit"] == wann and zurueck["zeit"].microsecond == 123456


def vertrag_zeit_ohne_zone_gilt_als_utc_und_berlin_wird_umgerechnet(db):
    ref = sammlung(db, "zeiten").document("a")
    ref.set({"naiv": datetime(2026, 7, 1, 10, 0), "berlin": datetime(2026, 7, 1, 12, 0, tzinfo=BERLIN)})
    d = ref.get().to_dict()
    assert d["naiv"] == datetime(2026, 7, 1, 10, 0, tzinfo=UTC)
    assert d["berlin"] == datetime(2026, 7, 1, 10, 0, tzinfo=UTC)


def vertrag_set_ersetzt_und_merge_fuehrt_karten_zusammen(db):
    ref = sammlung(db, "merge").document("a")
    ref.set({"a": 1, "karte": {"x": 1, "y": 1}})
    ref.set({"b": 2})
    assert ref.get().to_dict() == {"b": 2}
    ref.set({"a": 1, "karte": {"x": 1}}, merge=True)
    ref.set({"karte": {"y": 2}}, merge=True)
    assert ref.get().to_dict() == {"a": 1, "b": 2, "karte": {"x": 1, "y": 2}}
    # merge auf ein fehlendes Dokument legt es an
    neu = sammlung(db, "merge").document("neu")
    neu.set({"z": 1}, merge=True)
    assert neu.get().to_dict() == {"z": 1}


def vertrag_update_mit_punkt_pfaden(db):
    ref = sammlung(db, "update").document("a")
    ref.set({"billing": {"plan": "solo", "status": "aktiv"}, "name": "A"})
    ref.update({"billing.status": "gekündigt", "billing.neu": 1, "name": "B"})
    assert ref.get().to_dict() == {"billing": {"plan": "solo", "status": "gekündigt", "neu": 1}, "name": "B"}
    # ohne Punkt wird die ganze Karte ersetzt
    ref.update({"billing": {"plan": "team"}})
    assert ref.get().to_dict()["billing"] == {"plan": "team"}
    # Punkt-Pfad legt fehlende Karten an
    ref.update({"onboarding.mails.start": True})
    assert ref.get().to_dict()["onboarding"] == {"mails": {"start": True}}


def vertrag_update_auf_fehlendes_dokument_scheitert(db):
    try:
        sammlung(db, "update").document("gibtsnicht").update({"a": 1})
    except store.NotFound:
        return
    raise AssertionError("update ohne Dokument wurde angenommen")


def vertrag_delete_field(db):
    ref = sammlung(db, "loeschen").document("a")
    ref.set({"a": 1, "b": 2, "karte": {"x": 1, "y": 2}})
    ref.update({"a": store.DELETE_FIELD, "karte.x": store.DELETE_FIELD})
    assert ref.get().to_dict() == {"b": 2, "karte": {"y": 2}}
    ref.set({"b": store.DELETE_FIELD, "c": 3}, merge=True)
    assert ref.get().to_dict() == {"karte": {"y": 2}, "c": 3}
    # fehlendes Feld löschen ist kein Fehler
    ref.update({"gibtsnicht": store.DELETE_FIELD})


def vertrag_server_timestamp(db):
    vorher = datetime.now(UTC) - timedelta(seconds=60)
    ref = sammlung(db, "zeitstempel").document("a")
    ref.set({"createdAt": store.SERVER_TIMESTAMP, "karte": {"at": store.SERVER_TIMESTAMP}})
    ref.update({"updatedAt": store.SERVER_TIMESTAMP})
    d = ref.get().to_dict()
    nachher = datetime.now(UTC) + timedelta(seconds=60)
    for wert in (d["createdAt"], d["karte"]["at"], d["updatedAt"]):
        assert isinstance(wert, datetime) and wert.tzinfo is not None
        assert vorher <= wert <= nachher, wert


def vertrag_increment(db):
    ref = sammlung(db, "zaehler").document("a")
    ref.set({"anrufe": 2})
    ref.update({"anrufe": store.Increment(3), "neu": store.Increment(1)})
    assert ref.get().to_dict() == {"anrufe": 5, "neu": 1}
    # wie app/libs/telefon_laeden.py: merge auf ein fehlendes Dokument zählt ab 0
    leer = sammlung(db, "zaehler").document("leer")
    leer.set({"sekunden": store.Increment(42), "anrufe": store.Increment(1)}, merge=True)
    leer.set({"sekunden": store.Increment(8), "anrufe": store.Increment(1)}, merge=True)
    assert leer.get().to_dict() == {"sekunden": 50, "anrufe": 2}


def vertrag_create_nur_wenn_neu(db):
    ref = sammlung(db, "anlegen").document("a")
    ref.create({"n": 1})
    try:
        ref.create({"n": 2})
    except store.Conflict:
        pass
    else:
        raise AssertionError("create auf vorhandenes Dokument wurde angenommen")
    assert ref.get().to_dict() == {"n": 1}


def vertrag_delete_auch_ohne_dokument(db):
    ref = sammlung(db, "weg").document("a")
    ref.set({"n": 1})
    ref.delete()
    assert not ref.get().exists
    sammlung(db, "weg").document("gibtsnicht").delete()


def vertrag_neue_id(db):
    ref = sammlung(db, "ids").document()
    assert len(ref.id) == 20 and ref.id.isalnum(), ref.id
    assert sammlung(db, "ids").document().id != ref.id
    ref.set({"n": 1})
    assert ref.get().exists


def vertrag_unter_sammlungen_und_pfade(db):
    laden = sammlung(db, "shops").document("laden1")
    laden.set({"name": "Laden"})
    mitglied = laden.collection("members").document("kim")
    mitglied.set({"staffId": "s1"})
    assert mitglied.get().to_dict() == {"staffId": "s1"}
    assert mitglied.path == f"{LAUF}_shops/laden1/members/kim"
    assert mitglied.parent.id == "members" and mitglied.parent.parent.id == "laden1"
    # Unter-Sammlungen gehören nicht zur Abfrage der Eltern-Sammlung
    assert ids(sammlung(db, "shops").stream()) == ["laden1"]
    assert ids(laden.collection("members").stream()) == ["kim"]
    snap = mitglied.get()
    assert snap.reference.path == mitglied.path


# --- Abfragen ----------------------------------------------------------------------------------------------------


def _termine(db):
    col = sammlung(db, "termine")
    t = lambda h, m=0: datetime(2026, 11, 4, h, m, tzinfo=UTC)  # noqa: E731
    daten = {
        "t1": {"shopId": "a", "staffId": "kim", "status": "scheduled", "startTime": t(9), "nr": 3},
        "t2": {"shopId": "a", "staffId": "ali", "status": "in-progress", "startTime": t(10), "nr": 1},
        "t3": {"shopId": "a", "staffId": "kim", "status": "cancelled", "startTime": t(11), "nr": 2},
        "t4": {"shopId": "b", "staffId": "kim", "status": "scheduled", "startTime": t(10, 30), "nr": 5},
        "t5": {"shopId": "a", "staffId": "kim", "status": "scheduled", "startTime": "10:00"},  # alt: Zeit als Text
        "t6": {"shopId": "a", "status": "scheduled"},  # ohne startTime, ohne staffId
    }
    for i, d in daten.items():
        col.document(i).set(d)
    return col, t


def vertrag_abfragen_mit_gleich(db):
    col, _ = _termine(db)
    # ohne order_by: nach ID aufsteigend
    assert ids(col.where("shopId", "==", "a").stream()) == ["t1", "t2", "t3", "t5", "t6"]
    assert ids(col.where("shopId", "==", "a").where("staffId", "==", "kim").stream()) == ["t1", "t3", "t5"]
    assert ids(col.where(filter=store.FieldFilter("status", "==", "cancelled")).stream()) == ["t3"]
    # fehlendes Feld passt nie, auch nicht auf None
    assert ids(col.where("staffId", "==", None).stream()) == []
    assert ids(col.where("shopId", "==", "c").stream()) == []
    # get() liefert dasselbe als Liste
    assert ids(col.where("shopId", "==", "b").get()) == ["t4"]


def vertrag_abfragen_mit_in(db):
    col, _ = _termine(db)
    assert ids(col.where("status", "in", ["in-progress", "cancelled"]).stream()) == ["t2", "t3"]
    assert ids(col.where("staffId", "in", ["ali", "niemand"]).stream()) == ["t2"]


def vertrag_bereiche_nur_innerhalb_desselben_typs(db):
    col, t = _termine(db)
    # Zeitbereich: sortiert nach dem Feld; Text-Zeiten (t5) und fehlende (t6) gehören nicht dazu
    tag = col.where("shopId", "==", "a").where("startTime", ">=", t(9, 30)).where("startTime", "<", t(12))
    assert ids(tag.stream()) == ["t2", "t3"]
    assert ids(col.where("startTime", ">=", t(0)).stream()) == ["t1", "t2", "t4", "t3"]
    assert ids(col.where("nr", ">", 2).stream()) == ["t1", "t4"]
    assert ids(col.where("nr", "<", 2).stream()) == ["t2"]


def vertrag_sortieren_und_begrenzen(db):
    col, _ = _termine(db)
    assert ids(col.order_by("startTime").stream()) == ["t1", "t2", "t4", "t3", "t5"]  # Zeitpunkte vor Text
    assert ids(col.order_by("nr", direction=store.DESCENDING).limit(2).stream()) == ["t4", "t1"]
    assert ids(col.where("shopId", "==", "a").limit(1).stream()) == ["t1"]
    assert ids(col.order_by("nr").stream()) == ["t2", "t3", "t1", "t4"]  # ohne nr nicht dabei


def vertrag_ergebnis_bearbeiten(db):
    col, _ = _termine(db)
    for snap in col.where("status", "==", "cancelled").stream():
        snap.reference.update({"status": "scheduled", "geaendert": True})
    assert col.document("t3").get().to_dict()["geaendert"] is True


# --- Transaktionen und Sammel-Schreiben ------------------------------------------------------------------------------


def vertrag_transaktion_lesen_schreiben(db):
    ref = sammlung(db, "tx").document("zaehler")
    ref.set({"n": 0, "codes": []})

    @store.transactional
    def ziehen(tx):
        d = ref.get(transaction=tx).to_dict()
        code = d["n"] + 1
        tx.update(ref, {"n": code, "codes": d["codes"] + [code]})
        tx.set(sammlung(db, "tx").document(f"nr{code}"), {"code": code})
        return code

    assert ziehen(db.transaction()) == 1
    assert ziehen(db.transaction()) == 2
    assert ref.get().to_dict() == {"n": 2, "codes": [1, 2]}
    assert sammlung(db, "tx").document("nr2").get().to_dict() == {"code": 2}


def vertrag_transaktion_bei_fehler_ohne_wirkung(db):
    ref = sammlung(db, "tx").document("fehler")
    ref.set({"n": 0})

    @store.transactional
    def kaputt(tx):
        ref.get(transaction=tx)
        tx.update(ref, {"n": 1})
        tx.set(sammlung(db, "tx").document("nie"), {"x": 1})
        raise ValueError("abbrechen")

    try:
        kaputt(db.transaction())
    except ValueError:
        pass
    else:
        raise AssertionError("Fehler in der Transaktion kam nicht an")
    assert ref.get().to_dict() == {"n": 0}
    assert not sammlung(db, "tx").document("nie").get().exists


def vertrag_gleichzeitige_transaktionen_verlieren_nichts(db):
    """Wie Nummer ziehen im Ansturm: jede Nummer genau einmal, keine geht verloren."""
    ref = sammlung(db, "tx").document("ansturm")
    ref.set({"codes": []})
    fehler = []

    @store.transactional
    def eine(tx):
        codes = ref.get(transaction=tx).to_dict()["codes"]
        tx.update(ref, {"codes": codes + [len(codes) + 1]})

    def arbeiter():
        for _ in range(4):
            try:
                eine(db.transaction(max_attempts=20))
            except Exception as e:  # noqa: BLE001
                fehler.append(e)

    threads = [threading.Thread(target=arbeiter) for _ in range(3)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(120)
    assert not fehler, fehler
    assert ref.get().to_dict()["codes"] == list(range(1, 13))


def vertrag_sammel_schreiben_ganz_oder_gar_nicht(db):
    col = sammlung(db, "batch")
    col.document("b").set({"n": 1})
    col.document("c").set({"n": 1})
    b = db.batch()
    b.set(col.document("a"), {"n": 1})
    b.update(col.document("b"), {"n": 2})
    b.delete(col.document("c"))
    b.commit()
    assert ids(col.stream()) == ["a", "b"] and col.document("b").get().to_dict() == {"n": 2}

    b = db.batch()
    b.set(col.document("d"), {"n": 1})
    b.update(col.document("gibtsnicht"), {"n": 1})
    try:
        b.commit()
    except store.NotFound:
        pass
    else:
        raise AssertionError("Sammel-Schreiben mit fehlendem Dokument wurde angenommen")
    assert not col.document("d").get().exists


# --- Live-Abfragen (app/libs/appointment_window.py, notify_worker.py, public_appointments.py) ------------------------


def vertrag_live_abfrage_meldet_aenderungen(db):
    col = sammlung(db, "live")
    col.document("a").set({"status": "scheduled"})
    gesehen = []
    neu = threading.Event()

    def bei_aenderung(docs, changes, read_time):
        gesehen.append(sorted(d.id for d in docs))
        if "b" in gesehen[-1]:
            neu.set()

    watch = col.where("status", "==", "in-progress").on_snapshot(bei_aenderung)
    try:
        frist = time.time() + 15
        while not gesehen and time.time() < frist:
            time.sleep(0.1)
        assert gesehen and gesehen[0] == [], gesehen  # erster Stand: noch nichts aufgerufen
        col.document("b").set({"status": "in-progress"})
        assert neu.wait(15), gesehen
    finally:
        watch.unsubscribe()


if __name__ == "__main__":
    db = client()
    vertraege = [v for k, v in dict(globals()).items() if k.startswith("vertrag_")]
    if db is None:
        print(f"{len(vertraege)} Verträge übersprungen (ohne FIRESTORE_EMULATOR_HOST)")
        sys.exit(0)
    for v in vertraege:
        v(db)
        print("ok ", v.__name__)
    print(f"{len(vertraege)} Verträge bestanden ({LAUF})")
