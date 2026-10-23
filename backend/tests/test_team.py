"""
Tests für app/libs/team.py (Team-Vermerk shops/{shopId}/members/{uid} für die Firestore-Regeln) und fürs Aufräumen der
Vermerke beim Löschen (app/libs/konten.py). Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_team.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_privacy import NOW, FakeDb, days_ago  # noqa: E402

from app.libs import konten  # noqa: E402
from app.libs.team import sync_members, wanted_members  # noqa: E402


def laeden():
    return {
        "shops": {"a": {"name": "A", "owner": "chefin"}, "b": {"name": "B", "owner": "chef"}},
        "staff": {
            "s1": {"shopId": "a", "userId": "kim", "isActive": True},
            "s2": {"shopId": "a", "userId": "alt", "isActive": False},
            "s3": {"shopId": "b", "userId": ""},
            "s4": {"shopId": "b", "userId": "kim"},  # dieselbe Person in zwei Läden
        },
        "shops/a/members": {"alt": {"staffId": "s2"}, "weg": {"staffId": "gibtsnicht"}},
    }


def test_wer_einen_vermerk_braucht():
    assert wanted_members(laeden()["staff"]) == {"a": {"kim": "s1"}, "b": {"kim": "s4"}}


def test_abgleich_legt_an_und_raeumt_auf():
    store = laeden()
    result = sync_members(FakeDb(store), NOW)
    assert result == {"added": 2, "removed": 2}
    assert store["shops/a/members"] == {"kim": {"staffId": "s1", "at": NOW}}
    assert store["shops/b/members"] == {"kim": {"staffId": "s4", "at": NOW}}
    # zweiter Lauf ändert nichts
    assert sync_members(FakeDb(store), NOW) == {"added": 0, "removed": 0}


def test_loeschen_nimmt_vermerke_mit_und_sperrt_die_laden_id():
    store = laeden()
    store["shops"]["a"]["createdAt"] = days_ago(10)
    sync_members(FakeDb(store), NOW)
    db = FakeDb(store)
    plan = konten.plan_deletion(db, ["kim"], ["a"], {"kim": {"uid": "kim", "auth": True, "email": "kim@laden.de"}}, now=NOW)
    assert plan["problems"] == [] and len(plan["shops"][0]["members"]) == 1
    backup = konten.backup_data(plan, "test", "")
    assert "shops/a/members/kim" in backup["dokumente"]
    konten.execute(db, plan, lambda uid: None)
    assert store["shops/a/members"] == {}
    assert store["deleted_shops"]["a"]["owner"] == "chefin"
    # Kim bleibt Person in Laden b, nur ohne Konto – der Vermerk dort ist weg
    assert store["staff"]["s4"]["userId"] == "" and store["shops/b/members"] == {}
    assert konten.verify(db, plan, lambda uid: False) == []


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
