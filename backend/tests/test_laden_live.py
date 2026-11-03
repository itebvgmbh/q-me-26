"""
Tests für app/apis/laden_live: Wartende je Laden für die Ladenkarten. Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_laden_live.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.apis.laden_live as live  # noqa: E402
import app.seo as seo  # noqa: E402

gezaehlt = []


def _client(laeden=("a1", "b2"), fehler=False):
    gezaehlt.clear()

    def sichtbar():
        if fehler:
            raise RuntimeError("Firestore weg")
        return set(laeden)

    def waiting(shop_id, now=None):
        gezaehlt.append(shop_id)
        return {"a1": 3, "b2": 0}.get(shop_id, 7)

    live.sichtbare_laeden = sichtbar
    seo.waiting_now = waiting
    app = FastAPI()
    app.include_router(live.router, prefix="/routes")
    return TestClient(app)


def test_zahlen_je_laden():
    r = _client().get("/routes/laden-live?ids=a1,b2")
    assert r.status_code == 200
    assert r.json() == {"warten": {"a1": 3, "b2": 0}}
    assert "max-age=60" in r.headers["cache-control"]


def test_unbekannte_und_gesperrte_ohne_abfrage():
    # gesperrte Läden fehlen in sichtbare_laeden, erfundene IDs auch: dafür keine Abfrage
    r = _client(laeden=("a1",)).get("/routes/laden-live?ids=a1,b2,erfunden")
    assert r.json() == {"warten": {"a1": 3}}
    assert gezaehlt == ["a1"]


def test_ungueltige_ids_doppelte_und_zu_viele():
    c = _client(laeden=[f"x{i}" for i in range(100)])
    r = c.get("/routes/laden-live?ids=../shops,a b,a1,a1")
    assert r.json() == {"warten": {}}
    viele = ",".join(f"x{i}" for i in range(100))
    assert len(c.get(f"/routes/laden-live?ids={viele}").json()["warten"]) == live.MAX_IDS


def test_ohne_ids_und_bei_fehler():
    c = _client()
    assert c.get("/routes/laden-live").status_code == 422
    assert c.get("/routes/laden-live?ids=").json() == {"warten": {}}
    assert _client(fehler=True).get("/routes/laden-live?ids=a1").json() == {"warten": {}}


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test in tests:
        test()
        print("OK  ", test.__name__)
    print(f"{len(tests)} Tests bestanden")
