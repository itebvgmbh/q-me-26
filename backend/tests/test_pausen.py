"""
Tests für Pausen über das Backend (app/libs/pausen.py, app/apis/pausen, öffentlich in app/apis/live).
Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_pausen.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import store  # noqa: E402
from app.libs import live  # noqa: E402
from app.libs.schedule import BERLIN  # noqa: E402
import test_team_laden as _attrappe  # noqa: E402,F401  (Unter-Sammlungen und delete an der Attrappe)
from test_team_laden import BatchDb  # noqa: E402

UTC = timezone.utc
TAG = datetime(2026, 11, 10, tzinfo=BERLIN)
Z = lambda h, m=0: (TAG + timedelta(hours=h, minutes=m)).astimezone(UTC)  # noqa: E731


def laden():
    return {
        "shops": {"laden1": {"name": "Salon", "owner": "chefin"}, "laden2": {"name": "Anderer", "owner": "fremd"}},
        "staff": {"kim": {"shopId": "laden1", "name": "Kim", "userId": "kim-konto", "isActive": True},
                  "fremd": {"shopId": "laden2", "name": "Fremd", "isActive": True}},
        "breaks": {"b1": {"id": "b1", "shopId": "laden1", "staffId": "kim", "date": Z(0), "startTime": Z(12), "endTime": Z(12, 30)},
                   "alt": {"id": "alt", "shopId": "laden1", "staffId": "kim", "date": Z(0), "startTime": "15:00", "endTime": "15:30"}},
        "recurring-breaks": {"r1": {"shopId": "laden1", "staffId": "kim", "dayOfWeek": 1, "startTime": "12:00", "endTime": "13:00", "type": "lunch", "active": True}},
    }


geleert = []


def client(daten, uid):
    import app.apis.cache as cache
    import app.apis.firebase_utils as fu
    import app.apis.live as live_api
    import app.apis.pausen as api
    from databutton_app.mw.auth_mw import get_authorized_user

    db = BatchDb(daten)
    store.db = lambda: db
    fu.get_firestore_db = lambda: db
    cache.invalidate_shop_date_cache = lambda shop, tag, staff_id=None, verbose=True: geleert.append((shop, tag))
    cache.invalidate_shop_cache = lambda shop, verbose=True: geleert.append((shop, "alle"))
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    app.include_router(live_api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=f"{uid}@example.com", email_verified=False)
    return TestClient(app)


def test_pausen_oeffentlich_lesen():
    d = client(laden(), "niemand").get("/routes/live/person/kim/pausen").json()
    assert [p["id"] for p in d["einzeln"]] == ["alt", "b1"] and [p["id"] for p in d["fest"]] == ["r1"]
    b1 = next(p for p in d["einzeln"] if p["id"] == "b1")
    assert b1["startTime"] == live.json_wert(Z(12)) and next(p for p in d["einzeln"] if p["id"] == "alt")["startTime"] == "15:00"
    assert client(laden(), "niemand").get("/routes/live/person/niemand/pausen").json() == {"einzeln": [], "fest": []}


def test_einzelne_pause_nur_inhaber_und_eigene_person():
    daten = laden()
    geleert.clear()
    c = client(daten, "chefin")
    neu = live.json_wert({"shopId": "laden1", "staffId": "kim", "date": Z(0), "startTime": Z(9), "endTime": Z(9, 15), "type": "Kaffee", "id": "geklaut"})
    r = c.post("/routes/team/pausen", json={"pause": neu})
    assert r.status_code == 200, r.text
    pid = r.json()["pause"]["id"]
    assert pid != "geklaut" and daten["breaks"][pid]["id"] == pid and daten["breaks"][pid]["startTime"] == Z(9)
    assert ("laden1", "2026-11-10") in geleert
    # Ende vor Beginn, fremde Person, fremder Laden, nicht Inhaber
    assert c.post("/routes/team/pausen", json={"pause": {**neu, "endTime": live.json_wert(Z(8))}}).status_code == 400
    assert c.post("/routes/team/pausen", json={"pause": {**neu, "staffId": "fremd"}}).status_code == 400
    assert c.post("/routes/team/pausen", json={"pause": {**neu, "shopId": "laden2", "staffId": "fremd"}}).status_code == 403
    assert client(daten, "kim-konto").post("/routes/team/pausen", json={"pause": neu}).status_code == 403
    # ändern und löschen
    r = c.post(f"/routes/team/pausen/{pid}", json={"aenderung": {"endTime": live.json_wert(Z(9, 30)), "shopId": "laden2"}})
    assert r.status_code == 200 and daten["breaks"][pid]["endTime"] == Z(9, 30) and daten["breaks"][pid]["shopId"] == "laden1"
    assert c.post(f"/routes/team/pausen/{pid}", json={"aenderung": {"endTime": live.json_wert(Z(8))}}).status_code == 400
    # alter Eintrag mit Zeiten als Text: nur die Art ändern geht
    assert c.post("/routes/team/pausen/alt", json={"aenderung": {"type": "Termin"}}).status_code == 200
    assert client(daten, "kim-konto").post(f"/routes/team/pausen/{pid}/loeschen").status_code == 403
    assert c.post(f"/routes/team/pausen/{pid}/loeschen").json() == {"geloescht": pid} and pid not in daten["breaks"]
    assert c.post(f"/routes/team/pausen/{pid}/loeschen").status_code == 404


def test_feste_pause_wochentag_und_uhrzeit():
    daten = laden()
    geleert.clear()
    c = client(daten, "chefin")
    neu = {"shopId": "laden1", "staffId": "kim", "dayOfWeek": 3, "startTime": "10:00", "endTime": "10:15", "type": "coffee"}
    r = c.post("/routes/team/feste-pausen", json={"pause": neu})
    assert r.status_code == 200, r.text
    pid = r.json()["pause"]["id"]
    assert daten["recurring-breaks"][pid]["active"] is True and "id" not in daten["recurring-breaks"][pid]
    assert ("laden1", "alle") in geleert
    for kaputt in ({"dayOfWeek": 7}, {"dayOfWeek": "1"}, {"startTime": "25:00"}, {"endTime": "09:00"}, {"type": "Schlaf"}, {"active": "ja"}):
        assert c.post("/routes/team/feste-pausen", json={"pause": {**neu, **kaputt}}).status_code == 400, kaputt
    assert c.post(f"/routes/team/feste-pausen/{pid}", json={"aenderung": {"active": False}}).json()["pause"]["active"] is False
    assert c.post(f"/routes/team/feste-pausen/{pid}", json={"aenderung": {"endTime": "09:59"}}).status_code == 400
    assert client(daten, "fremd").post(f"/routes/team/feste-pausen/{pid}", json={"aenderung": {"active": True}}).status_code == 403
    assert c.post(f"/routes/team/feste-pausen/{pid}/loeschen").status_code == 200 and pid not in daten["recurring-breaks"]


def test_zwischenspeicher_fuer_den_ganzen_laden():
    """invalidate_shop_cache löscht alle Tage des Ladens, andere Läden bleiben"""
    import importlib

    import app.apis.cache as cache

    cache = importlib.reload(cache)
    namen = [f"{cache.PREFIX}{cache._short('laden1')}_2026-11-10_x", f"{cache.PREFIX}{cache._short('laden1')}_2026-11-11_y",
             f"{cache.PREFIX}{cache._short('laden2')}_2026-11-10_z"]
    geloescht = []
    cache.db = SimpleNamespace(storage=SimpleNamespace(json=SimpleNamespace(
        list=lambda: [SimpleNamespace(name=n) for n in namen], delete=geloescht.append)))
    cache._cleanup = lambda names: None
    assert cache.invalidate_shop_cache("laden1", verbose=False) == 2 and geloescht == namen[:2]


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
