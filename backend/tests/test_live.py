"""
Tests für die Live-Daten von Nummernseite und Bildschirm (app/apis/live, app/libs/live.py). Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_live.py
"""
import asyncio
import os
import sys
import threading
import time
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import seo, store  # noqa: E402
from app.apis import live as api  # noqa: E402
from app.libs import live  # noqa: E402

UTC = timezone.utc


# --- kleine Attrappe für Firestore: nur was die Endpunkte brauchen ------------------------------------------------


class Snap:
    def __init__(self, doc_id, daten):
        self.id = doc_id
        self._daten = daten

    @property
    def exists(self):
        return self._daten is not None

    def to_dict(self):
        return None if self._daten is None else dict(self._daten)


class Abfrage:
    def __init__(self, docs, filter_=()):
        self._docs = docs
        self._filter = list(filter_)

    def where(self, *args, filter=None):
        f = filter if filter is not None else store.FieldFilter(*args)
        return Abfrage(self._docs, self._filter + [(f.field_path, f.op_string, f.value)])

    def stream(self):
        for doc_id in sorted(self._docs):
            d = self._docs[doc_id]
            if all(op == "==" and d.get(feld) == wert for feld, op, wert in self._filter):
                yield Snap(doc_id, d)


class Sammlung(Abfrage):
    def document(self, doc_id):
        return SimpleNamespace(get=lambda: Snap(doc_id, self._docs.get(doc_id)))


class FakeDb:
    def __init__(self, daten):
        self.daten = daten
        self.lesen = 0

    def collection(self, name):
        self.lesen += 1
        return Sammlung(self.daten.setdefault(name, {}))


T = lambda h, m=0: datetime(2026, 11, 4, h, m, tzinfo=UTC)  # noqa: E731


def daten():
    return {
        "shops": {
            "laden1": {
                "name": "Salon Eins", "logoUrl": "https://x/logo.png", "owner": "geheim-uid", "email": "chef@example.com",
                "phone": "+49 30 1", "plan": "laden", "trialEndsAt": T(0), "createdAt": T(0),
                "billing": {"plan": "laden", "status": "active", "customerId": "cus_geheim", "currentPeriodEnd": T(1)},
                "suspended": None,
            },
            "gesperrt": {"name": "Weg", "suspended": {"at": T(0), "accounts": ["uid1"]}},
        },
        "staff": {
            "kim": {"shopId": "laden1", "name": "Kim", "userId": "uid-kim", "isActive": True, "email": "kim@example.com"},
            "alt": {"shopId": "laden1", "name": "Alt", "isActive": False},
            "ali": {"shopId": "laden1", "name": "Ali"},
            "fremd": {"shopId": "laden2", "name": "Fremd"},
        },
        "services": {"schnitt": {"shopId": "laden1", "name": "Schnitt", "price": 20}},
        "public_appointments": {
            "n1": {"shopId": "laden1", "staffId": "kim", "serviceId": "schnitt", "status": "scheduled", "type": "queue",
                   "startTime": T(10), "endTime": T(10, 30), "referenceCode": "A12", "isAnonymous": True,
                   "staffDay": "kim_2026-11-04", "shopDay": "laden1_2026-11-04"},
            "n2": {"shopId": "laden1", "staffId": "kim", "status": "in-progress", "type": "queue", "startTime": T(9, 30),
                   "staffDay": "kim_2026-11-04", "shopDay": "laden1_2026-11-04"},
            "n3": {"shopId": "laden1", "staffId": "ali", "status": "scheduled", "startTime": T(11),
                   "staffDay": "ali_2026-11-04", "shopDay": "laden1_2026-11-04"},
            "morgen": {"shopId": "laden1", "staffId": "kim", "status": "scheduled", "startTime": T(10) + timedelta(days=1),
                       "staffDay": "kim_2026-11-05", "shopDay": "laden1_2026-11-05"},
        },
    }


def client_mit(db):
    store.db = lambda: db  # die Endpunkte holen den Client über die Speicher-Schicht
    seo._cache.clear()
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    return TestClient(app)


# --- Werte -----------------------------------------------------------------------------------------------------


def test_zeitpunkte_und_andere_werte_als_json():
    wert = live.json_wert({
        "aware": datetime(2026, 7, 1, 12, 0, 5, 120000, tzinfo=live.BERLIN),
        "naiv": datetime(2026, 7, 1, 10, 0),
        "liste": [T(9), {"tief": T(8)}],
        "ort": SimpleNamespace(latitude=52.5, longitude=13.4),
        "ref": SimpleNamespace(path="shops/x"),
        "sonst": object(),
        "zahl": 3, "text": "ä", "nichts": None, "ja": True,
    })
    assert wert["aware"] == {"__zeit": "2026-07-01T10:00:05.120000Z"}
    assert wert["naiv"] == {"__zeit": "2026-07-01T10:00:00.000000Z"}
    assert wert["liste"] == [{"__zeit": "2026-11-04T09:00:00.000000Z"}, {"tief": {"__zeit": "2026-11-04T08:00:00.000000Z"}}]
    assert wert["ort"] == {"latitude": 52.5, "longitude": 13.4} and wert["ref"] == "shops/x" and wert["sonst"] is None
    assert (wert["zahl"], wert["text"], wert["nichts"], wert["ja"]) == (3, "ä", None, True)


def test_tagesbeginn_deutsche_zeit():
    assert live.tagesbeginn(date(2026, 11, 4)) == datetime(2026, 11, 3, 23, 0, tzinfo=UTC)
    assert live.tagesbeginn(date(2026, 7, 1)) == datetime(2026, 6, 30, 22, 0, tzinfo=UTC)
    assert live.heute(datetime(2026, 11, 4, 23, 30, tzinfo=UTC)) == date(2026, 11, 5)


def test_vom_laden_nur_anzeige_und_tarif():
    laden = api.laden_oeffentlich("laden1", daten()["shops"]["laden1"])
    assert "owner" not in laden and "email" not in laden and "phone" not in laden
    assert laden["name"] == "Salon Eins" and laden["id"] == "laden1" and laden["plan"] == "laden"
    assert laden["billing"] == {"plan": "laden", "status": "active", "currentPeriodEnd": T(1)}
    assert "suspended" not in laden
    gesperrt = api.laden_oeffentlich("gesperrt", daten()["shops"]["gesperrt"])
    assert gesperrt["suspended"] == {"at": T(0)}


# --- Endpunkte -------------------------------------------------------------------------------------------------


def test_nummer_mit_schlange_laden_und_namen():
    c = client_mit(FakeDb(daten()))
    r = c.get("/routes/live/nummer/n1")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    d = r.json()
    assert d["termin"]["id"] == "n1" and d["termin"]["referenceCode"] == "A12"
    assert d["termin"]["startTime"] == {"__zeit": "2026-11-04T10:00:00.000000Z"}
    assert [a["id"] for a in d["spur"]] == ["n1", "n2"]  # nur dieselbe Person am selben Tag
    assert d["laden"]["name"] == "Salon Eins" and "owner" not in d["laden"]
    assert d["leistung"] == {"name": "Schnitt"} and d["person"] == {"name": "Kim"}
    assert d["kanaele"] == ["termin:n1", "tag:laden1_2026-11-04"]


def test_nummer_die_es_nicht_gibt():
    c = client_mit(FakeDb(daten()))
    assert c.get("/routes/live/nummer/gibtsnicht").status_code == 404
    assert c.get("/routes/live/nummer/..%2Fshops").status_code == 404


def test_bildschirm_nur_aktive_personen_und_der_tag():
    c = client_mit(FakeDb(daten()))
    d = c.get("/routes/live/bildschirm/laden1?tag=2026-11-04").json()
    assert [p["id"] for p in d["personen"]] == ["ali", "kim"]  # "alt" ist inaktiv, "fremd" aus einem anderen Laden
    assert d["personen"][1] == {"id": "kim", "name": "Kim"}  # keine E-Mail, kein Konto
    assert [t["id"] for t in d["termine"]] == ["n1", "n2", "n3"]
    assert d["kanaele"] == ["tag:laden1_2026-11-04"] and d["tag"] == "2026-11-04"
    morgen = c.get("/routes/live/bildschirm/laden1?tag=2026-11-05").json()
    assert [t["id"] for t in morgen["termine"]] == ["morgen"]


def test_bildschirm_ohne_tag_nimmt_heute_und_prueft_eingaben():
    c = client_mit(FakeDb(daten()))
    assert c.get("/routes/live/bildschirm/laden1").json()["tag"] == live.heute().isoformat()
    assert c.get("/routes/live/bildschirm/gibtsnicht").status_code == 404
    assert c.get("/routes/live/bildschirm/laden1?tag=morgen").status_code == 400
    assert c.get("/routes/live/bildschirm/laden1?tag=2026-13-40").status_code == 400


def test_namen_werden_zwischengespeichert():
    db = FakeDb(daten())
    c = client_mit(db)
    c.get("/routes/live/nummer/n1")
    vorher = db.lesen
    c.get("/routes/live/nummer/n1")
    assert db.lesen - vorher == 2  # nur Termin und Schlange, Laden/Leistung/Person aus dem Zwischenspeicher


def test_ereignisse_brauchen_gueltige_kanaele():
    c = client_mit(FakeDb(daten()))
    assert c.get("/routes/live/ereignisse").status_code == 400
    assert c.get("/routes/live/ereignisse?kanal=shops:alles").status_code == 400
    assert c.get("/routes/live/ereignisse?kanal=tag:laden1_heute").status_code == 400


def test_ereignisse_melden_aenderungen():
    """Direkt am Datenstrom: der Test-Client von FastAPI würde warten, bis der (absichtlich lange) Strom endet"""
    gestartet = []
    getrennt = [False]

    async def is_disconnected():
        return getrennt[0]

    async def ablauf():
        alt, alt_ping = live.verteiler, api.PING_SEKUNDEN
        live.verteiler = live.Verteiler(waechter_bauen=lambda v: SimpleNamespace(sicherstellen=lambda: gestartet.append(1)))
        api.PING_SEKUNDEN = 0.05
        try:
            antwort = await api.ereignisse(SimpleNamespace(is_disconnected=is_disconnected), kanal=["tag:laden1_2026-11-04", "termin:n1", "quatsch"])
            assert antwort.media_type == "text/event-stream" and antwort.headers["cache-control"] == "no-store"
            strom = antwort.body_iterator
            weiter = lambda: asyncio.wait_for(strom.__anext__(), 2)  # noqa: E731
            erstes = await weiter()
            assert erstes.startswith("retry: 3000") and "event: bereit" in erstes and "quatsch" not in erstes
            assert gestartet == [1] and live.verteiler.anzahl() == 1
            assert await weiter() == ": ping\n\n"  # hält die Verbindung offen, solange nichts passiert
            # wie der Firestore-Listener: aus einem fremden Thread melden
            threading.Thread(target=live.verteiler.melden, args=("termin:n1",)).start()
            naechstes = await weiter()
            while naechstes.startswith(":"):
                naechstes = await weiter()
            assert naechstes == 'event: aenderung\ndata: {"kanal": "termin:n1"}\n\n', naechstes
            assert live.verteiler.melden("tag:anderer_2026-11-04") == 0
            # Seite zu: der Strom endet und meldet ab
            getrennt[0] = True
            try:
                while True:
                    await weiter()
            except StopAsyncIteration:
                pass
            assert live.verteiler.anzahl() == 0
        finally:
            live.verteiler, api.PING_SEKUNDEN = alt, alt_ping

    asyncio.run(ablauf())


# --- Verteiler und Wächter --------------------------------------------------------------------------------------


def test_verteiler_an_und_abmelden_und_stau():
    async def ablauf():
        v = live.Verteiler(waechter_bauen=lambda _: SimpleNamespace(sicherstellen=lambda: None))
        schleife = asyncio.get_running_loop()
        a = v.anmelden(["tag:x", "termin:1", "tag:x"], schleife)
        b = v.anmelden(["tag:x"], schleife)
        assert a.kanaele == ["tag:x", "termin:1"] and v.anzahl() == 2
        assert v.melden("tag:x") == 2 and v.melden("termin:1") == 1 and v.melden("tag:y") == 0
        await asyncio.sleep(0)
        assert a.schlange.qsize() == 2 and b.schlange.qsize() == 1
        for _ in range(live.STAU + 5):
            v.melden("termin:1")
        await asyncio.sleep(0)
        assert a.schlange.qsize() == live.STAU  # voll: weitere Hinweise fallen weg, einer reicht zum Neuladen
        v.abmelden(a)
        assert v.melden("termin:1") == 0 and v.anzahl() == 1
        v.abmelden(b)
        assert v.anzahl() == 0

    asyncio.run(ablauf())


def test_waechter_meldet_alten_und_neuen_tag():
    gemeldet = []
    w = live.Waechter(SimpleNamespace(melden=gemeldet.append, anzahl=lambda: 1), db=object())
    aenderung = lambda art, doc_id, daten: SimpleNamespace(type=SimpleNamespace(name=art), document=Snap(doc_id, daten))  # noqa: E731
    w.bei_aenderung([], [aenderung("ADDED", "a", {"shopDay": "s_2026-11-04"})], None)
    assert gemeldet == ["termin:a", "tag:s_2026-11-04"]
    gemeldet.clear()
    # Platz geändert: anderer Tag – beide Tage erfahren es
    w.bei_aenderung([], [aenderung("MODIFIED", "a", {"shopDay": "s_2026-11-06"})], None)
    assert gemeldet[0] == "termin:a" and sorted(gemeldet[1:]) == ["tag:s_2026-11-04", "tag:s_2026-11-06"]
    gemeldet.clear()
    w.bei_aenderung([], [aenderung("REMOVED", "a", {"shopDay": "s_2026-11-06"})], None)
    assert gemeldet == ["termin:a", "tag:s_2026-11-06"] and "a" not in w._tage
    # kaputte Änderung bringt den Listener nicht um
    w.bei_aenderung([], [SimpleNamespace(type=None, document=None)], None)


class FakeWatch:
    def __init__(self):
        self.beendet = False

    def unsubscribe(self):
        self.beendet = True


class WatchDb:
    """Zählt, wie oft ein Listener gestartet wird, und merkt sich die Grenzen der Abfrage"""

    def __init__(self):
        self.watches = []
        self.grenzen = []

    def collection(self, name):
        assert name == live.PUBLIC
        db = self

        class Q:
            def __init__(self, f=()):
                self.f = list(f)

            def where(self, filter):
                return Q(self.f + [(filter.op_string, filter.value)])

            def on_snapshot(self, callback):
                db.grenzen.append(self.f)
                db.watches.append(FakeWatch())
                return db.watches[-1]

        return Q()


def test_waechter_startet_einmal_hoert_auf_und_beginnt_neuen_tag():
    uhr = [1000.0]
    zuhoerer = [1]
    db = WatchDb()
    w = live.Waechter(SimpleNamespace(melden=lambda k: None, anzahl=lambda: zuhoerer[0]), db=db, uhr=lambda: uhr[0])
    w._pruefer = SimpleNamespace(is_alive=lambda: True)  # kein echter Prüf-Thread im Test
    w.sicherstellen()
    w.sicherstellen()
    assert len(db.watches) == 1
    (op1, von), (op2, bis) = db.grenzen[0]
    assert (op1, op2) == (">=", "<") and von == live.tagesbeginn(live.heute()) and bis - von == timedelta(days=live.TAGE)
    # niemand mehr da: erst nach RUHE_SEKUNDEN aufhören
    zuhoerer[0] = 0
    w.pruefen()
    uhr[0] += live.RUHE_SEKUNDEN - 1
    w.pruefen()
    assert not db.watches[0].beendet
    uhr[0] += 2
    w.pruefen()
    assert db.watches[0].beendet and w._watch is None
    # jemand kommt wieder: neuer Listener
    zuhoerer[0] = 1
    w.sicherstellen()
    assert len(db.watches) == 2
    # neuer Tag: neu anfangen
    w._tag = live.heute() - timedelta(days=1)
    w.pruefen()
    assert db.watches[1].beendet and len(db.watches) == 3 and w._tag == live.heute()


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
