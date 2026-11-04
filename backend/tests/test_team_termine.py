"""
Tests für Termine des Teams (app/libs/team_termine.py, app/apis/team_termine): Anlegen und Ändern wie bisher die
Transaktionen im Browser (frontend/src/utils/firestore/appointments.ts). Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_team_termine.py
"""
import itertools
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import store  # noqa: E402
from app.libs import live  # noqa: E402
from app.libs import team_termine as tt  # noqa: E402
from app.libs.buchung import PlatzWeg  # noqa: E402
from app.libs.schedule import BERLIN, day_key  # noqa: E402

UTC = timezone.utc
# Ein Tag in der Zukunft, damit die Nachricht an den Kunden greift (vergangene Tage nicht)
TAG = (datetime.now(BERLIN) + timedelta(days=3)).date()
B = lambda h, m=0, tag=None: datetime(*(tag or TAG).timetuple()[:3], h, m, tzinfo=BERLIN).astimezone(UTC)  # noqa: E731
DAY = TAG.isoformat()


# --- nachgebaute Datenbank: Transaktionen, neue IDs, Bereichsabfragen, filter= ------------------------------------


class Snap:
    def __init__(self, ref, data):
        self.reference, self.id, self._data = ref, ref.id, data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


_ids = itertools.count(1)


class Ref:
    def __init__(self, db, coll, doc_id=None):
        self.db, self.coll, self.id = db, coll, doc_id or f"neu{next(_ids):04d}"

    def _docs(self):
        return self.db.daten.setdefault(self.coll, {})

    def get(self, transaction=None):
        if transaction is not None:
            assert not transaction.writes, "Firestore: erst lesen, dann schreiben"
        data = self._docs().get(self.id)
        return Snap(self, dict(data) if data is not None else None)

    def set(self, data, merge=False):
        doc = dict(self._docs().get(self.id) or {}) if merge else {}
        for k, v in data.items():
            if v is store.DELETE_FIELD:
                doc.pop(k, None)
            else:
                doc[k] = v
        self._docs()[self.id] = doc


OPS = {"==": lambda a, b: a == b, "<": lambda a, b: a < b, ">=": lambda a, b: a >= b, ">": lambda a, b: a > b}


class Query:
    def __init__(self, db, coll, filters=()):
        self.db, self.coll, self.filters = db, coll, list(filters)

    def where(self, *args, filter=None):
        f = filter or store.FieldFilter(*args)
        return Query(self.db, self.coll, self.filters + [(f.field_path, f.op_string, f.value)])

    def stream(self):
        for doc_id, data in sorted(self.db.daten.get(self.coll, {}).items()):
            ok = True
            for feld, op, wert in self.filters:
                # Wie Firestore: fehlende Felder passen nie, Vergleiche nur innerhalb desselben Typs (bei „in“: je Wert)
                gleich_typ = isinstance(data.get(feld), datetime) and isinstance(wert, datetime) or type(data.get(feld)) is type(wert)
                if feld not in data or (op != "in" and not gleich_typ):
                    ok = False
                    break
                ok = ok and OPS[op](data[feld], wert)
            if ok:
                yield Snap(Ref(self.db, self.coll, doc_id), dict(data))

    def document(self, doc_id=None):
        return Ref(self.db, self.coll, doc_id)


class Writes:
    def __init__(self):
        self.writes = []

    def set(self, ref, data, merge=False):
        self.writes.append(lambda: ref.set(data, merge=merge))

    def update(self, ref, data):
        self.writes.append(lambda: ref.set(data, merge=True))

    def commit(self):
        for w in self.writes:
            w()


class Db:
    def __init__(self, daten):
        self.daten = daten

    def collection(self, name):
        return Query(self, name)

    def transaction(self, max_attempts=5):
        return Writes()


def transactional(fn):
    """Wie google.cloud.firestore.transactional: Fehler = nichts geschrieben, sonst alle Schreibvorgänge"""
    def run(tx):
        result = fn(tx)
        tx.commit()
        return result

    return run


def laden(**termine):
    daten = {
        "shops": {"laden1": {"name": "Salon", "owner": "chefin"}, "laden2": {"name": "Anderer", "owner": "fremd"}},
        "staff": {
            "kim": {"shopId": "laden1", "name": "Kim", "userId": "kim-konto", "isActive": True},
            "ali": {"shopId": "laden1", "name": "Ali", "isActive": True},
            "fremd": {"shopId": "laden2", "name": "Fremd", "isActive": True},
        },
        "users": {"kundin": {"displayName": "Kundin Kara", "phoneNumber": "0170 1"}},
        "appointments": {},
    }
    for termin_id, t in termine.items():
        daten["appointments"][termin_id] = t
        slot = tt.placement_of(t)
        if slot:
            schedule = daten.setdefault("schedules", {}).setdefault(f"{slot.staff_id}_{day_key(slot.start)}", {"slots": {}})
            schedule["slots"][termin_id] = {"start": slot.start, "end": slot.end}
    return daten


def termin(**extra):
    return {"shopId": "laden1", "staffId": "kim", "serviceId": "schnitt", "type": "booked", "status": "scheduled",
            "startTime": B(10), "endTime": B(10, 30), "customerName": "Robin", "customerPhone": "0170 2", **extra}


class Nebenwirkungen:
    """Ersetzt Zwischenspeicher, „Früher dran“, Benachrichtigungen und Live-Kanäle durch Aufzeichnung"""

    def __init__(self):
        import app.apis.cache as cache
        import app.apis.check_slots as cs
        import app.libs.notify_worker as nw

        self.geleert, self.frueher, self.geweckt, self.kanaele = [], [], [], []
        store.transactional = transactional
        cache.invalidate_shop_date_cache = lambda shop, tag, staff_id=None, verbose=True: self.geleert.append((shop, tag))
        cs.trigger_check_in_background = lambda shop_id=None, staff_id=None: self.frueher.append((shop_id, staff_id))
        nw.wake = lambda: self.geweckt.append(1)
        live.verteiler = SimpleNamespace(melden=self.kanaele.append)


# --- Anlegen -----------------------------------------------------------------------------------------------------


def test_anlegen_belegt_platz_und_schreibt_kurzfassung():
    n = Nebenwirkungen()
    daten = laden()
    created = tt.termin_anlegen(Db(daten), "chefin", termin())
    tid = created["id"]
    gespeichert = daten["appointments"][tid]
    assert gespeichert["staffId"] == "kim" and gespeichert["startTime"] == B(10) and gespeichert["type"] == "booked"
    assert "referenceCode" not in gespeichert  # fester Termin mit Namen: keine Tagesnummer
    assert daten["public_appointments"][tid]["shopDay"] == f"laden1_{DAY}" and "customerName" not in daten["public_appointments"][tid]
    assert daten["schedules"][f"kim_{DAY}"]["slots"][tid] == {"start": B(10), "end": B(10, 30)}
    assert ("laden1", DAY) in n.geleert and f"laden:laden1" in n.kanaele and f"tag:laden1_{DAY}" in n.kanaele


def test_anlegen_nummer_aus_der_schlange_bekommt_tagesnummer():
    Nebenwirkungen()
    daten = laden(alt=termin(referenceCode="42", startTime=B(8), endTime=B(8, 30)))
    created = tt.termin_anlegen(Db(daten), "chefin", termin(type="queue", startTime=B(11), endTime=B(11, 30)))
    code = created["referenceCode"]
    assert code and code != "42" and daten["shop_days"][f"laden1_{DAY}"]["codes"] == [code]


def test_anlegen_auf_belegten_platz():
    Nebenwirkungen()
    daten = laden(alt=termin())
    try:
        tt.termin_anlegen(Db(daten), "chefin", termin(startTime=B(10, 15), endTime=B(10, 45)))
    except PlatzWeg as e:
        assert e.window.start == B(10) and e.window.end == B(10, 30)
    else:
        raise AssertionError("Doppelbuchung angenommen")
    assert list(daten["appointments"]) == ["alt"]
    # andere Person zur selben Zeit geht
    tt.termin_anlegen(Db(daten), "chefin", termin(staffId="ali", startTime=B(10, 15), endTime=B(10, 45)))


def test_anlegen_prueft_person_zeit_und_status():
    Nebenwirkungen()
    for kaputt, status in (
        (termin(staffId="fremd"), 400), (termin(staffId=None), 400), (termin(endTime=B(9)), 400),
        (termin(startTime="10:00"), 400), (termin(status="cancelled"), 400), (termin(status="quatsch"), 400),
        (termin(type="irgendwas"), 400), (termin(shopId=None), 400),
    ):
        try:
            tt.termin_anlegen(Db(laden()), "chefin", kaputt)
        except tt.TerminFehler as e:
            assert e.status == status, (kaputt, e.status)
        else:
            raise AssertionError(f"angenommen: {kaputt}")


def test_anlegen_ohne_felder_die_nur_das_backend_setzt():
    Nebenwirkungen()
    daten = laden()
    created = tt.termin_anlegen(Db(daten), "chefin", termin(referenceCode="1", calledAt=B(9), ticketKeyHash="x", customerNotice="moved", id="geklaut"))
    g = daten["appointments"][created["id"]]
    assert created["id"] != "geklaut" and not {"referenceCode", "calledAt", "ticketKeyHash", "customerNotice"} & set(g)


def test_anlegen_fuer_sich_selbst_nimmt_name_aus_dem_profil():
    Nebenwirkungen()
    daten = laden()
    created = tt.termin_anlegen(Db(daten), "kundin", termin(customerId="kundin", customerName="", customerPhone=None))
    g = daten["appointments"][created["id"]]
    assert g["customerName"] == "Kundin Kara" and g["customerPhone"] == "0170 1"


# --- Ändern ------------------------------------------------------------------------------------------------------


def test_aufrufen_setzt_zeitpunkte_und_verschiebt_belegung():
    n = Nebenwirkungen()
    daten = laden(t1=termin())
    jetzt = B(9, 50)  # zehn Minuten früher dran
    nachher = tt.termin_aendern(Db(daten), "t1", {"status": "in-progress"}, jetzt=jetzt)
    g = daten["appointments"]["t1"]
    assert g["status"] == "in-progress" and g["calledAt"] == jetzt and g["lastCalledAt"] == jetzt and nachher["id"] == "t1"
    assert daten["public_appointments"]["t1"]["status"] == "in-progress"
    assert daten["schedules"][f"kim_{DAY}"]["slots"]["t1"] == {"start": jetzt, "end": jetzt + timedelta(minutes=30)}
    assert ("laden1", "kim") in n.frueher  # früher aufgerufen: Platz frei für „Früher dran“
    # zweiter Aufruf behält den ersten Zeitpunkt
    tt.termin_aendern(Db(daten), "t1", {"status": "scheduled"}, jetzt=B(9, 55))
    assert "notifiedCalledAt" not in daten["appointments"]["t1"]
    tt.termin_aendern(Db(daten), "t1", {"status": "in-progress"}, jetzt=B(10))
    assert daten["appointments"]["t1"]["calledAt"] == jetzt and daten["appointments"]["t1"]["lastCalledAt"] == B(10)


def test_zurueck_auf_wartet_loescht_merker():
    Nebenwirkungen()
    daten = laden(t1=termin(status="in-progress", calledAt=B(10), lastCalledAt=B(10), notifiedCalledAt=B(10)))
    tt.termin_aendern(Db(daten), "t1", {"status": "scheduled"}, jetzt=B(10, 5))
    assert "notifiedCalledAt" not in daten["appointments"]["t1"]


def test_fertig_gibt_den_rest_frei():
    n = Nebenwirkungen()
    daten = laden(t1=termin())
    tt.termin_aendern(Db(daten), "t1", {"status": "completed"}, jetzt=B(10, 20))
    g = daten["appointments"]["t1"]
    assert g["completedAt"] == B(10, 20) and g["calledAt"] == B(10, 20)
    assert daten["schedules"][f"kim_{DAY}"]["slots"]["t1"] == {"start": B(10), "end": B(10, 20)}
    assert ("laden1", "kim") in n.frueher


def test_verschieben_mit_nachricht_an_den_kunden():
    n = Nebenwirkungen()
    daten = laden(t1=termin())
    morgen = TAG + timedelta(days=1)
    tt.termin_aendern(Db(daten), "t1", {"startTime": B(14, tag=morgen), "endTime": B(14, 30, tag=morgen), "staffId": "ali"},
                      kunde_benachrichtigen=True, jetzt=B(8))
    g = daten["appointments"]["t1"]
    assert g["customerNotice"] == "moved" and g["customerNoticePreviousStart"] == B(10) and g["customerNoticeAt"] == B(8)
    assert "t1" not in daten["schedules"][f"kim_{DAY}"]["slots"]
    assert daten["schedules"][f"ali_{morgen.isoformat()}"]["slots"]["t1"] == {"start": B(14, tag=morgen), "end": B(14, 30, tag=morgen)}
    assert daten["public_appointments"]["t1"]["shopDay"] == f"laden1_{morgen.isoformat()}"
    # beide Tage erfahren es, Benachrichtigung geweckt, beide Personen für „Früher dran“
    assert {f"tag:laden1_{DAY}", f"tag:laden1_{morgen.isoformat()}", "termin:t1"} <= set(n.kanaele)
    assert n.geweckt and {("laden1", "kim"), ("laden1", "ali")} <= set(n.frueher)
    # zweimal verschieben: eine Nachricht mit der ursprünglichen Zeit als „vorher“
    tt.termin_aendern(Db(daten), "t1", {"startTime": B(15, tag=morgen), "endTime": B(15, 30, tag=morgen)}, kunde_benachrichtigen=True, jetzt=B(8))
    assert daten["appointments"]["t1"]["customerNoticePreviousStart"] == B(10)


def test_verschieben_auf_belegten_platz_aendert_nichts():
    Nebenwirkungen()
    daten = laden(t1=termin(), t2=termin(startTime=B(11), endTime=B(11, 30)))
    vorher = {k: dict(v) for k, v in daten["appointments"].items()}
    try:
        tt.termin_aendern(Db(daten), "t1", {"startTime": B(11, 15), "endTime": B(11, 45)}, kunde_benachrichtigen=True, jetzt=B(8))
    except PlatzWeg as e:
        assert e.window.start == B(11)
    else:
        raise AssertionError("auf belegten Platz verschoben")
    assert daten["appointments"] == vorher and "public_appointments" not in daten


def test_absagen_gibt_frei_und_meldet_dem_kunden():
    n = Nebenwirkungen()
    daten = laden(t1=termin())
    tt.termin_aendern(Db(daten), "t1", {"status": "cancelled", "noShow": True}, kunde_benachrichtigen=True, jetzt=B(8))
    g = daten["appointments"]["t1"]
    assert g["status"] == "cancelled" and g["noShow"] is True and g["customerNotice"] == "cancelled"
    assert "t1" not in daten["schedules"][f"kim_{DAY}"]["slots"] and ("laden1", "kim") in n.frueher


def test_vergangene_tage_ohne_nachricht_und_ohne_ladenwechsel():
    Nebenwirkungen()
    gestern = TAG - timedelta(days=10)
    daten = laden(t1=termin(startTime=B(10, tag=gestern), endTime=B(10, 30, tag=gestern)))
    tt.termin_aendern(Db(daten), "t1", {"status": "cancelled", "shopId": "laden2"}, kunde_benachrichtigen=True)
    g = daten["appointments"]["t1"]
    assert "customerNotice" not in g and g["shopId"] == "laden1"


def test_aendern_prueft_person_und_zeit():
    Nebenwirkungen()
    for kaputt in ({"staffId": "fremd"}, {"endTime": B(9)}, {"status": "weg"}, {"startTime": "morgen"}):
        try:
            tt.termin_aendern(Db(laden(t1=termin())), "t1", kaputt)
        except tt.TerminFehler as e:
            assert e.status == 400
        else:
            raise AssertionError(f"angenommen: {kaputt}")
    try:
        tt.termin_aendern(Db(laden()), "gibtsnicht", {"status": "completed"})
    except tt.TerminFehler as e:
        assert e.status == 404


def test_wieder_aufnehmen_prueft_den_platz():
    Nebenwirkungen()
    daten = laden(t1=termin(status="cancelled"), t2=termin())
    try:
        tt.termin_aendern(Db(daten), "t1", {"status": "scheduled"})
    except PlatzWeg:
        pass
    else:
        raise AssertionError("abgesagten Termin auf belegten Platz zurückgeholt")


# --- Schnittstelle -------------------------------------------------------------------------------------------------


def client(daten, uid):
    import app.apis.firebase_utils as fu
    import app.apis.team_termine as api
    from databutton_app.mw.auth_mw import get_authorized_user

    Nebenwirkungen()
    db = Db(daten)
    store.db = lambda: db
    fu.get_firestore_db = lambda: db
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=f"{uid}@example.com", email_verified=True)
    return TestClient(app)


def test_schnittstelle_lesen_nur_fuer_den_laden():
    daten = laden(t1=termin(), t2=termin(startTime=B(10, tag=TAG + timedelta(days=8)), endTime=B(10, 30, tag=TAG + timedelta(days=8))))
    von, bis = live.json_wert(B(0))["__zeit"], live.json_wert(B(0) + timedelta(days=1))["__zeit"]
    for uid in ("chefin", "kim-konto"):
        r = client(daten, uid).get(f"/routes/team/termine?shopId=laden1&von={von}&bis={bis}")
        assert r.status_code == 200 and [t["id"] for t in r.json()["termine"]] == ["t1"], r.text
        assert r.json()["termine"][0]["customerName"] == "Robin" and r.json()["kanaele"] == ["laden:laden1"]
        assert r.json()["termine"][0]["startTime"] == live.json_wert(B(10))
    assert client(daten, "fremd").get(f"/routes/team/termine?shopId=laden1&von={von}&bis={bis}").status_code == 403
    c = client(daten, "chefin")
    assert c.get(f"/routes/team/termine?shopId=laden1&von={bis}&bis={von}").status_code == 400
    zu_lang = live.json_wert(B(0) + timedelta(days=60))["__zeit"]
    assert c.get(f"/routes/team/termine?shopId=laden1&von={von}&bis={zu_lang}").status_code == 400
    assert c.get("/routes/team/termine/t1").json()["termin"]["id"] == "t1"
    assert client(daten, "fremd").get("/routes/team/termine/t1").status_code == 403


def test_schnittstelle_anlegen_und_aendern():
    daten = laden(alt=termin())
    c = client(daten, "chefin")
    neu = live.json_wert(termin(startTime=B(12), endTime=B(12, 30)))
    r = c.post("/routes/team/termine", json={"termin": neu})
    assert r.status_code == 200, r.text
    tid = r.json()["termin"]["id"]
    assert daten["appointments"][tid]["startTime"] == B(12)
    r = c.post(f"/routes/team/termine/{tid}", json={"aenderung": {"status": "in-progress"}})
    assert r.status_code == 200 and r.json()["termin"]["status"] == "in-progress" and "__zeit" in r.json()["termin"]["calledAt"]
    # Konflikt: Text wie im Browser, übersetzt nach Accept-Language
    belegt = live.json_wert(termin(startTime=B(10, 15), endTime=B(10, 45)))
    r = c.post("/routes/team/termine", json={"termin": belegt})
    assert r.status_code == 409 and r.json()["detail"] == "Da ist schon ein Termin (10:00–10:30).", r.text


def test_schnittstelle_fremder_laden_und_kaputte_zeit():
    daten = laden(t1=termin())
    c = client(daten, "fremd")
    assert c.post("/routes/team/termine", json={"termin": live.json_wert(termin())}).status_code == 403
    assert c.post("/routes/team/termine/t1", json={"aenderung": {"status": "completed"}}).status_code == 403
    c = client(daten, "chefin")
    assert c.post("/routes/team/termine/t1", json={"aenderung": {"startTime": {"__zeit": "gestern"}}}).status_code == 400
    assert c.post("/routes/team/termine/gibtsnicht", json={"aenderung": {}}).status_code == 404


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
