"""
Tests für deploy/konten-aufraeumen.py: Liste der Konten und Läden, Löschen nur des Ausgewählten. Ohne Firebase
lauffähig (Datenbank und Konten nachgebildet wie in test_privacy.py):

    cd backend && .venv/bin/python tests/test_konten_aufraeumen.py
"""
import importlib.util
import json
import os
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import NOW, FakeDb, days_ago  # noqa: E402

PATH = Path(__file__).resolve().parents[2] / "deploy" / "konten-aufraeumen.py"
spec = importlib.util.spec_from_file_location("konten_aufraeumen", PATH)
ka = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ka)

ITEBV = ka.ITEBV_SHOP


def account(uid, email, created_days_ago):
    return {"uid": uid, "email": email, "emailVerified": False, "disabled": False, "created": days_ago(created_days_ago),
            "lastSignIn": days_ago(1), "providers": ["password"]}


ACCOUNTS = [
    account("stefan", "st@mes-beratung.de", 300),
    account("shopper", "shop@shop.de", 200),
    account("fixture", "q-me-test-1760000000@example.com", 10),
    account("last", "q-me-last-1760000000@example.com", 5),
    account("lastk1", "q-me-last-1760000000-k1@example.com", 5),
    account("mitarbeiter", "kim-1760000000@example.com", 3),
]


def data():
    return {
        "users": {
            "stefan": {"role": "shopOwner", "email": "st@mes-beratung.de"},
            "shopper": {"role": "shopOwner", "email": "shop@shop.de"},
            "fixture": {"role": "shopOwner"},
            "last": {"role": "shopOwner"},
            "lastk1": {"role": "customer", "displayName": "Kunde 1"},
            "mitarbeiter": {"role": "employee"},
            "geist": {"role": "customer", "email": "weg@example.com", "createdAt": days_ago(400)},
        },
        "shops": {
            ITEBV: {"name": "ITEBV GmbH", "owner": "stefan", "createdAt": days_ago(300)},
            "erer": {"name": "erer", "owner": "shopper", "createdAt": days_ago(150), "founder": True},
            "test": {"name": "Testladen (wird gleich gelöscht)", "owner": "fixture", "createdAt": days_ago(10)},
            "last": {"name": "Lasttest (wird gleich gelöscht)", "owner": "last", "createdAt": days_ago(5)},
            "abo": {"name": "Mit Abo", "owner": "verschwunden", "createdAt": days_ago(50), "billing": {"status": "active"}},
        },
        "services": {
            "s1": {"shopId": ITEBV}, "s2": {"shopId": ITEBV, "archived": True}, "s3": {"shopId": "erer"}, "s4": {"shopId": "last"},
        },
        "staff": {
            "st1": {"shopId": ITEBV, "userId": "mitarbeiter", "role": "staff", "isActive": True},
            "st2": {"shopId": "erer", "userId": "", "role": "staff"},
            "st3": {"shopId": "last", "userId": "", "role": "staff"},
            "st4": {"shopId": ITEBV, "userId": "verschwunden"},
        },
        "customers": {
            "c1": {"shopId": ITEBV, "userId": "lastk1", "email": "q-me-last-1760000000-k1@example.com"},
            "c2": {"shopId": "erer", "userId": ""},
        },
        "appointments": {
            "a1": {"shopId": ITEBV, "customerId": "lastk1", "customerName": "Kunde 1", "customerPhone": "0151",
                   "status": "scheduled", "startTime": NOW + timedelta(days=2)},
            "a2": {"shopId": ITEBV, "customerId": "lastk1", "customerName": "Kunde 1", "status": "completed", "startTime": days_ago(3)},
            "a3": {"shopId": "last", "customerId": "lastk1", "customerName": "Kunde 1", "status": "scheduled", "startTime": NOW + timedelta(days=1)},
            "a4": {"shopId": "erer", "customerId": "walk-in", "customerName": "Laufkunde", "status": "completed", "startTime": days_ago(20)},
            "a5": {"shopId": "geloescht", "customerId": "x", "status": "completed", "startTime": days_ago(20)},
        },
        "push_subscriptions": {"p1": {"appointmentId": "a1", "shopId": ITEBV}, "p2": {"appointmentId": "a3", "shopId": "last"}},
        "earlier_slot_notifications": {"o1": {"shopId": "last", "userId": "lastk1"}, "o2": {"shopId": ITEBV, "userId": "lastk1"}},
        "schedules": {"last_2026-10-21": {"shopId": "last"}},
        "shop_days": {"last_2026-10-21": {"shopId": "last"}},
        "meta": {"gruender": {"count": 3}},
    }


def view(store, admins=frozenset()):
    return ka.overview(FakeDb(store), ACCOUNTS, admin_emails=admins, now=NOW)


def by_email(ov):
    return {a["email"]: a for a in ov["accounts"]}


def numbers(ov):
    return {
        "stand": NOW.isoformat(),
        "konten": {a["nr"]: {"uid": a["uid"], "email": a["email"]} for a in ov["accounts"]},
        "laeden": {s["nr"]: {"id": s["id"], "name": s["name"]} for s in ov["shops"]},
    }


def plan(store, selection, admins=frozenset()):
    ov = view(store, admins)
    uids, shop_ids = ka.parse_selection(selection, numbers(ov))
    accounts = {a["uid"]: {**a, "auth": True} for a in ACCOUNTS}
    return ka.plan_deletion(FakeDb(store), uids, shop_ids, accounts, admin_emails=admins, now=NOW)


def snapshot(store):
    """Inhalt ohne leere Sammlungen (die legt FakeDb beim bloßen Abfragen an)"""
    return json.dumps({k: v for k, v in store.items() if v}, default=str, sort_keys=True)


def run(store, p):
    deleted = []
    result = ka.execute(FakeDb(store), p, deleted.append)
    return result, deleted


# --- Liste ----------------------------------------------------------------------------------------------------------


def test_liste_nummeriert_aelteste_zuerst_mit_profil_ohne_konto():
    ov = view(data())
    assert [a["email"] for a in ov["accounts"]][:3] == ["weg@example.com", "st@mes-beratung.de", "shop@shop.de"]
    assert [a["nr"] for a in ov["accounts"]] == [f"K{i}" for i in range(1, 8)]
    assert [s["name"] for s in ov["shops"]][0] == "ITEBV GmbH" and ov["shops"][0]["nr"] == "L1"
    assert "NUR PROFIL" in by_email(ov)["weg@example.com"]["markers"]


def test_kennzeichen_betreiber_itebv_und_testskripte():
    accounts = by_email(view(data(), admins={"st@mes-beratung.de"}))
    assert {"BETREIBER", "ITEBV"} <= set(accounts["st@mes-beratung.de"]["markers"])
    assert "ITEBV" in accounts["kim-1760000000@example.com"]["markers"]  # Team im ITEBV-Laden
    assert "E2E" in accounts["kim-1760000000@example.com"]["markers"]
    assert "FIXTURE" in accounts["q-me-test-1760000000@example.com"]["markers"]
    assert "LASTTEST" in accounts["q-me-last-1760000000-k1@example.com"]["markers"]
    assert accounts["shop@shop.de"]["markers"] == []


def test_liste_zaehlt_termine_laeden_team_kunden():
    ov = view(data())
    k1 = by_email(ov)["q-me-last-1760000000-k1@example.com"]
    assert (k1["appointments"], k1["upcoming"], k1["customers"]) == (3, 2, [ITEBV])
    shops = {s["id"]: s for s in ov["shops"]}
    assert (shops[ITEBV]["services"], shops[ITEBV]["staff"], shops[ITEBV]["appointments"]) == (1, 2, 2)
    assert "INHABER-KONTO FEHLT" in shops["abo"]["markers"] and "ABO active" in shops["abo"]["markers"]
    assert "GRÜNDER" in shops["erer"]["markers"] and "TESTLADEN" in shops["last"]["markers"]
    assert ov["orphans"] == {"staff": 1, "customers": 0, "appointmentsInMissingShops": 1}
    text = ka.format_overview(ov)
    assert "K1" in text and "L1" in text and "ITEBV GmbH" in text and "nichts geändert" in text


def test_liste_aendert_nichts_und_merkt_nummern():
    store = data()
    before = snapshot(store)
    ov = view(store)
    with tempfile.TemporaryDirectory() as tmp:
        path = ka.save_numbers(ov, Path(tmp))
        saved = json.loads(path.read_text(encoding="utf-8"))
        assert saved["konten"]["K2"] == {"uid": "stefan", "email": "st@mes-beratung.de"}
        assert ka.latest_list(Path(tmp)) == path
    assert snapshot(store) == before


# --- Auswahl --------------------------------------------------------------------------------------------------------


def test_auswahl_mit_bereichen_und_nur_aus_der_liste():
    saved = numbers(view(data()))
    uids, shops = ka.parse_selection("k4-K5, K7,L4", saved)
    assert uids == [saved["konten"][k]["uid"] for k in ("K4", "K5", "K7")] and shops == [saved["laeden"]["L4"]["id"]]
    for bad in ("K99", "X1", "K5-K3", ""):
        try:
            ka.parse_selection(bad, saved)
        except SystemExit:
            continue
        raise AssertionError(bad)


# --- Löschen --------------------------------------------------------------------------------------------------------


def test_inhaber_nur_mit_laden():
    p = plan(data(), _nr(data(), uids=["last"]))
    assert any("Inhaber von „Lasttest" in x for x in p["problems"])


def test_itebv_abo_und_betreiber_sind_geschuetzt():
    store = data()
    p = plan(store, _nr(store, uids=["stefan"], shops=[ITEBV]), admins={"st@mes-beratung.de"})
    assert any("ITEBV" in x for x in p["problems"]) and any("Betreiber" in x for x in p["problems"])
    p = plan(store, _nr(store, shops=["abo"]))
    assert any("laufendes Abo" in x for x in p["problems"])


def test_probelauf_aendert_nichts():
    store = data()
    before = snapshot(store)
    p = plan(store, _nr(store, uids=["last", "lastk1", "mitarbeiter", "geist"], shops=["last", "erer"]))
    assert p["problems"] == []  # erer geht ohne sein Konto, das bleibt
    text = ka.format_plan(p, {})
    assert "LÄDEN LÖSCHEN: 2" in text and "KONTEN LÖSCHEN" in text and "Zähler 3 → 2" in text
    assert snapshot(store) == before


def test_loeschen_wie_konto_loeschen_im_profil():
    store = data()
    p = plan(store, _nr(store, uids=["last", "lastk1", "mitarbeiter", "geist"], shops=["last"]))
    assert p["problems"] == []
    backup = ka.backup_data(p, "K…", "liste.json")
    assert "shops/last" in backup["dokumente"] and "appointments/a1" in backup["dokumente"] and "users/geist" in backup["dokumente"]
    assert backup["dokumente"]["appointments/a1"]["customerName"] == "Kunde 1"  # Zustand vorher
    assert {k["uid"] for k in backup["konten"]} == {"last", "lastk1", "mitarbeiter"}
    json.dumps(backup)  # muss sich speichern lassen

    result, deleted = run(store, p)
    assert sorted(deleted) == ["geist", "last", "lastk1", "mitarbeiter"]
    # Laden samt allem weg
    assert "last" not in store["shops"] and "s4" not in store["services"] and "st3" not in store["staff"]
    assert "a3" not in store["appointments"] and "p2" not in store["push_subscriptions"] and "o1" not in store["earlier_slot_notifications"]
    assert store["schedules"] == {} and store["shop_days"] == {}
    # Kunden-Konto: Termine im ITEBV-Laden ohne Namen, kommender abgesagt, verbundener Kunden-Eintrag und Angebot weg
    assert store["appointments"]["a1"]["customerName"] == "Gelöscht" and store["appointments"]["a1"]["status"] == "cancelled"
    assert store["appointments"]["a1"]["customerPhone"] is None and store["appointments"]["a2"]["status"] == "completed"
    assert "c1" not in store["customers"] and "o2" not in store["earlier_slot_notifications"] and "p1" not in store["push_subscriptions"]
    # Team im bleibenden Laden: nur gelöst
    assert store["staff"]["st1"]["userId"] == "" and store["staff"]["st1"]["shopId"] == ITEBV
    # Profile weg, Rest unberührt
    assert set(store["users"]) == {"stefan", "shopper", "fixture"}
    assert ITEBV in store["shops"] and "erer" in store["shops"] and "a4" in store["appointments"]
    assert result["shops"] == 1 and result["accounts"] == 4 and result["staffUnlinked"] == 1 and result["cancelled"] == 1
    assert ka.verify(FakeDb(store), p, lambda uid: False) == []


def test_gruenderplatz_wird_frei():
    store = data()
    p = plan(store, _nr(store, uids=["shopper"], shops=["erer"]))
    assert p["problems"] == []
    run(store, p)
    assert store["meta"]["gruender"]["count"] == 2
    assert "c2" not in store["customers"] and "a4" not in store["appointments"]


def test_nachpruefung_meldet_reste():
    store = data()
    p = plan(store, _nr(store, uids=["lastk1"]))
    assert ka.verify(FakeDb(store), p, lambda uid: True)  # nichts gelöscht → Reste


def _nr(store, uids=(), shops=()):
    """Nummern aus der Liste für diese IDs, wie Stefan sie nennen würde"""
    saved = numbers(view(store))
    k = {v["uid"]: n for n, v in saved["konten"].items()}
    l_ = {v["id"]: n for n, v in saved["laeden"].items()}
    return ",".join([k[u] for u in uids] + [l_[s] for s in shops])


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
