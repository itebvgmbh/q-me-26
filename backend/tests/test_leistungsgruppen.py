"""
Leistungsgruppen für „Läden finden“ (app/libs/leistungsgruppen.py). Dieselben Fälle prüft das Frontend in
dev/suche.test.mjs (frontend/src/utils/leistungsgruppen.ts). Ohne Firebase und ohne pytest lauffähig:

    cd backend && .venv/bin/python tests/test_leistungsgruppen.py
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app.libs import leistungsgruppen as lg  # noqa: E402

FAELLE = json.loads((Path(__file__).resolve().parents[2] / "dev" / "leistungsgruppen-faelle.json").read_text(encoding="utf-8"))


def test_regeln_liegen_im_frontend_und_sind_lesbar():
    assert lg.DATEI.exists(), lg.DATEI
    assert {"herren", "damen", "kinder", "haarschnitt", "bart", "farbe"} <= set(lg.keys())


def test_zuordnung_per_stichwort():
    falsch = [(f["name"], f["gruppe"], lg.auto(f["name"], f.get("kategorie", ""), f.get("kontext", "")))
              for f in FAELLE["faelle"] if lg.auto(f["name"], f.get("kategorie", ""), f.get("kontext", "")) != f["gruppe"]]
    assert not falsch, falsch


def test_salons_im_verzeichnis():
    for f in FAELLE["salons"]:
        assert lg.salon_gruppen(f["namen"], f["kategorie"]) == f["gruppen"], f


def test_inhaber_legt_fest():
    assert lg.wirksam({"name": "Herrenhaarschnitt", "gruppe": "bart"}) == "bart"
    assert lg.wirksam({"name": "Herrenhaarschnitt", "gruppe": "keine"}) is None
    assert lg.wirksam({"name": "Herrenhaarschnitt", "gruppe": "quatsch"}) == "herren", "Unbekanntes zählt nicht"
    assert lg.wirksam({"name": "Trockenschnitt"}, "KaNa Barbers") == "herren"
    assert lg.wirksam({"name": "Trockenschnitt"}, "Haarwerk") == "haarschnitt"


def test_menge_und_gueltig():
    assert lg.menge("herren") == {"herren", "haarschnitt"} and lg.menge("kinder") == {"kinder"}
    assert {"herren", "damen", "kinder"} <= lg.menge("haarschnitt") and lg.menge("quatsch") == set()
    assert all(lg.gueltig(w) for w in (None, "", "keine", "bart"))
    assert not any(lg.gueltig(w) for w in ("Bart", "x", 3, ["bart"]))


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
