"""
Tests für app/libs/laden_loeschen.py: Inhaber löscht einen eigenen Laden. Ohne Datenbank lauffähig (nachgebildet wie
in test_privacy.py):

    cd backend && uv run python tests/test_laden_loeschen.py
"""
import json
import os
import sys
import tempfile
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import NOW, FakeDb, days_ago  # noqa: E402

TMP = tempfile.mkdtemp()
os.environ["QME_BETREIBER_DIR"] = os.path.join(TMP, "betreiber")
os.environ["QME_DATEIEN_DIR"] = os.path.join(TMP, "dateien")

from app.libs import laden_loeschen as ll  # noqa: E402
from app.libs.konten import ITEBV_SHOP  # noqa: E402

INHABER = SimpleNamespace(sub="inhaber", email="inhaber@salon.de")


def data():
    return {
        "users": {"inhaber": {"role": "shopOwner", "email": "inhaber@salon.de"}, "kim": {"role": "employee"}},
        "shops": {
            "salon": {"name": "Salon Sonne", "owner": "inhaber", "createdAt": days_ago(40), "founder": True},
            "zweiter": {"name": "Salon Mond", "owner": "inhaber", "createdAt": days_ago(10)},
            ITEBV_SHOP: {"name": "ITEBV GmbH", "owner": "inhaber", "createdAt": days_ago(300)},
        },
        "services": {"s1": {"shopId": "salon"}, "s2": {"shopId": "salon"}, "s3": {"shopId": "zweiter"}},
        "staff": {
            "st1": {"shopId": "salon", "userId": "inhaber", "isActive": True},
            "st2": {"shopId": "salon", "userId": "kim", "isActive": True},
            "st3": {"shopId": "salon", "userId": "", "isActive": False},
            "st4": {"shopId": "zweiter", "userId": "inhaber", "isActive": True},
        },
        "customers": {"c1": {"shopId": "salon", "name": "Eva"}},
        "appointments": {
            "a1": {"shopId": "salon", "customerId": "walk-in", "status": "scheduled", "startTime": NOW + timedelta(days=2)},
            "a2": {"shopId": "salon", "customerId": "walk-in", "status": "completed", "startTime": days_ago(3)},
            "a3": {"shopId": "salon", "customerId": "walk-in", "status": "cancelled", "startTime": NOW + timedelta(days=1)},
            "a4": {"shopId": "zweiter", "customerId": "walk-in", "status": "scheduled", "startTime": NOW + timedelta(days=1)},
        },
        "meta": {"gruender": {"count": 5}},
    }


def test_vorschau_zaehlt_und_aendert_nichts():
    store = data()
    vorher = json.dumps(store, default=str, sort_keys=True)
    v = ll.vorschau(FakeDb(store), "salon", NOW)
    assert v["name"] == "Salon Sonne" and v["bestaetigung"] == "Salon Sonne"
    assert v["hindernis"] is None and v["gruender"] is True and v["aboEndet"] is None
    assert v["anzahl"] == {"kommende": 1, "termine": 3, "team": 2, "leistungen": 2, "kunden": 1}
    assert json.dumps({k: x for k, x in store.items() if x}, default=str, sort_keys=True) == vorher


def test_laufendes_abo_haelt_auf_gekuendigtes_nicht():
    store = data()
    store["shops"]["salon"]["billing"] = {"status": "active", "plan": "laden"}
    assert "Abo" in ll.vorschau(FakeDb(store), "salon", NOW)["hindernis"]
    try:
        ll.loeschen(FakeDb(store), INHABER, "salon", "Salon Sonne", NOW)
        raise AssertionError("hätte nicht löschen dürfen")
    except ll.LoeschFehler as e:
        assert e.status == 409
    assert "salon" in store["shops"]

    ende = NOW + timedelta(days=12)
    store["shops"]["salon"]["billing"] = {"status": "active", "plan": "laden", "cancelAtPeriodEnd": True, "currentPeriodEnd": ende}
    v = ll.vorschau(FakeDb(store), "salon", NOW)
    assert v["hindernis"] is None and v["aboEndet"] == ende.isoformat()

    store["shops"]["salon"]["billing"] = {"status": "past_due", "plan": "laden", "cancelAtPeriodEnd": True}
    assert "Zahlung" in ll.vorschau(FakeDb(store), "salon", NOW)["hindernis"]


def test_abo_in_der_sandbox_haelt_nicht_auf():
    store = data()
    store["shops"]["salon"]["billing"] = {"status": "active", "plan": "laden"}
    store.setdefault("shops/salon/privat", {})
    db = FakeDb(store)
    db.collection("shops").document("salon").collection("privat").document("stripe_test").set({"aktiv": True})
    assert ll.vorschau(db, "salon", NOW)["hindernis"] is None


def test_telefon_assistent_und_itebv_halten_auf():
    store = data()
    store["telefon_laeden"] = {"salon": {"shopId": "salon", "zusatz": {"status": "active"}}}
    assert "Telefon-Assistent" in ll.vorschau(FakeDb(store), "salon", NOW)["hindernis"]
    store["telefon_laeden"]["salon"]["zusatz"]["cancelAtPeriodEnd"] = True  # gekündigt: läuft aus, hält nicht auf
    assert ll.vorschau(FakeDb(store), "salon", NOW)["hindernis"] is None
    assert ll.loeschen(FakeDb(store), INHABER, "salon", "Salon Sonne", NOW)["geloescht"]
    assert ll.vorschau(FakeDb(store), ITEBV_SHOP, NOW)["hindernis"]


def test_falscher_name_loescht_nichts():
    store = data()
    try:
        ll.loeschen(FakeDb(store), INHABER, "salon", "Salon", NOW)
        raise AssertionError("hätte nicht löschen dürfen")
    except ll.LoeschFehler as e:
        assert e.status == 400 and "Salon Sonne" in str(e.text)
    assert "salon" in store["shops"] and "s1" in store["services"]


def test_loeschen_mit_sicherung_protokoll_und_bildern():
    store = data()
    bilder = Path(os.environ["QME_DATEIEN_DIR"]) / "salon"
    bilder.mkdir(parents=True, exist_ok=True)
    (bilder / ("a" * 32 + ".png")).write_bytes(b"\x89PNG\r\n\x1a\n")
    ergebnis = ll.loeschen(FakeDb(store), INHABER, "salon", "  salon sonne ", NOW)  # Groß/klein und Leerzeichen egal
    assert ergebnis == {"geloescht": True, "reste": 0}
    assert "salon" not in store["shops"] and "zweiter" in store["shops"]
    assert set(store["services"]) == {"s3"} and set(store["staff"]) == {"st4"} and set(store["appointments"]) == {"a4"}
    assert store["customers"] == {} and "salon" in store["deleted_shops"]
    assert store["users"]["inhaber"]["role"] == "shopOwner" and "kim" in store["users"]  # Konten bleiben
    assert store["meta"]["gruender"]["count"] == 4  # Gründerplatz wieder frei
    assert not bilder.exists()
    betreiber = Path(os.environ["QME_BETREIBER_DIR"])
    sicherungen = list((betreiber / "sicherungen").glob("*.json"))
    assert sicherungen and "shops/salon" in json.loads(sicherungen[-1].read_text(encoding="utf-8"))["dokumente"]
    zeile = json.loads((betreiber / "protokoll.jsonl").read_text(encoding="utf-8").strip().splitlines()[-1])
    assert zeile["action"] == "Laden gelöscht (vom Inhaber)" and zeile["by"] == "inhaber@salon.de"
    assert zeile["target"]["shopIds"] == ["salon"]


def test_zweimal_loeschen_meldet_weg():
    store = data()
    ll.loeschen(FakeDb(store), INHABER, "zweiter", "Salon Mond", NOW)
    try:
        ll.loeschen(FakeDb(store), INHABER, "zweiter", "Salon Mond", NOW)
        raise AssertionError("zweites Löschen")
    except ll.LoeschFehler as e:
        assert e.status == 404


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} Tests bestanden")
