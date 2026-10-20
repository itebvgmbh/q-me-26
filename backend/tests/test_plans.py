"""
Tests für app/libs/plans.py: Welcher Tarif gilt? Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_plans.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.libs.plans import TARIFF_LAUNCH, effective_plan, has_feature  # noqa: E402

NOW = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)


def test_neuer_laden_in_der_testphase_hat_alles():
    shop = {"plan": "gratis", "trialEndsAt": NOW + timedelta(days=5)}
    assert effective_plan(shop, NOW) == "team"
    assert has_feature(shop, "bildschirm", NOW)


def test_nach_der_testphase_gratis():
    shop = {"plan": "gratis", "trialEndsAt": NOW - timedelta(days=1)}
    assert effective_plan(shop, NOW) == "gratis"
    assert not has_feature(shop, "benachrichtigung", NOW)


def test_bezahltes_abo_gilt():
    shop = {"trialEndsAt": NOW - timedelta(days=40), "billing": {"plan": "solo", "status": "active"}}
    assert effective_plan(shop, NOW) == "solo"
    assert has_feature(shop, "benachrichtigung", NOW)
    assert not has_feature(shop, "team", NOW)


def test_gekuendigtes_abo_faellt_auf_gratis():
    shop = {"trialEndsAt": NOW - timedelta(days=40), "billing": {"plan": "laden", "status": "canceled"}}
    assert effective_plan(shop, NOW) == "gratis"


def test_zahlung_offen_bleibt_vorerst_aktiv():
    shop = {"billing": {"plan": "laden", "status": "past_due"}, "trialEndsAt": NOW - timedelta(days=1)}
    assert effective_plan(shop, NOW) == "laden"


def test_alter_laden_ohne_felder_testet_ab_einfuehrung():
    shop = {"createdAt": datetime(2026, 5, 1, tzinfo=timezone.utc)}
    assert effective_plan(shop, TARIFF_LAUNCH + timedelta(days=29)) == "team"
    assert effective_plan(shop, TARIFF_LAUNCH + timedelta(days=31)) == "gratis"


def test_ohne_laden_gratis():
    assert effective_plan(None, NOW) == "gratis"


def test_freischaltung_gilt_bis_zum_enddatum():
    shop = {"trialEndsAt": NOW - timedelta(days=1), "grant": {"plan": "laden", "until": NOW + timedelta(days=10)}}
    assert effective_plan(shop, NOW) == "laden"
    assert effective_plan(shop, NOW + timedelta(days=11)) == "gratis"


def test_freischaltung_ohne_enddatum_oder_mit_unbekanntem_tarif_gilt_nicht():
    old = NOW - timedelta(days=1)
    assert effective_plan({"trialEndsAt": old, "grant": {"plan": "laden"}}, NOW) == "gratis"
    assert effective_plan({"trialEndsAt": old, "grant": {"plan": "gold", "until": NOW + timedelta(days=5)}}, NOW) == "gratis"


def test_hoeherer_tarif_von_abo_und_freischaltung_gilt():
    later = NOW + timedelta(days=30)
    solo_abo = {"billing": {"plan": "solo", "status": "active"}}
    assert effective_plan({**solo_abo, "grant": {"plan": "team", "until": later}}, NOW) == "team"
    assert effective_plan({"billing": {"plan": "team", "status": "active"}, "grant": {"plan": "solo", "until": later}}, NOW) == "team"


def test_in_der_testphase_bleibt_alles_offen():
    shop = {"trialEndsAt": NOW + timedelta(days=3), "grant": {"plan": "solo", "until": NOW + timedelta(days=60)}}
    assert effective_plan(shop, NOW) == "team"
    assert effective_plan(shop, NOW + timedelta(days=4)) == "solo"


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
