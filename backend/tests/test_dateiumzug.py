"""
Tests für den Umzug der Bilder aus Firebase Storage (deploy/dateiumzug.py, requirements/eigene-datenbank.md Stufe 5).
Ohne Firebase und ohne Datenbank lauffähig:

    cd backend && .venv/bin/python tests/test_dateiumzug.py
"""
import os
import sys
import tempfile
from types import SimpleNamespace

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(os.path.dirname(BACKEND), "deploy"))

import dateiumzug as umzug  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
LOGO = "https://firebasestorage.googleapis.com/v0/b/qmedata-7c79e.firebasestorage.app/o/shop-logos%2Fladen1%2Flogo.png?alt=media&token=abc"
FOTO = "https://firebasestorage.googleapis.com/v0/b/qmedata-7c79e.firebasestorage.app/o/staff-profile-images%2Fladen1%2Fkim.jpg?alt=media&token=def"
WEG = "https://firebasestorage.googleapis.com/v0/b/qmedata-7c79e.firebasestorage.app/o/shop-logos%2Fladen2%2Fweg.png?alt=media"


class Db:
    def __init__(self, baum):
        self.baum, self.geschrieben = baum, []

    def collection(self, name):
        db = self

        class Col:
            def stream(self):
                return [SimpleNamespace(id=i, to_dict=lambda d=d: d) for i, d in db.baum.get(name, {}).items()]

            def document(self, doc_id):
                return SimpleNamespace(set=lambda daten: (db.baum[name].__setitem__(doc_id, daten), db.geschrieben.append(doc_id)))

        return Col()


def test_laden_aus_dem_pfad():
    assert umzug.laden_aus(LOGO) == "laden1"
    assert umzug.laden_aus(FOTO) == "laden1"
    assert umzug.laden_aus("https://firebasestorage.googleapis.com/v0/b/x/o/andere%2Fladen1%2Fa.png") is None
    assert umzug.laden_aus("https://dranzeit.de/routes/live/dateien/laden1/a.png") is None


def test_holt_einmal_ersetzt_ueberall_und_ist_wiederholbar():
    with tempfile.TemporaryDirectory() as ordner:
        os.environ["QME_DATEIEN_DIR"] = ordner
        os.environ["PUBLIC_URL"] = "https://dranzeit.de"
        db = Db({
            "shops": {"laden1": {"name": "Salon", "logoUrl": LOGO}, "laden2": {"logoUrl": WEG}},
            "staff": {"kim": {"profileImageUrl": FOTO, "extra": {"bilder": [LOGO, "andere"]}}},
            "services": {"s1": {"name": "Schnitt"}},
        })
        geholt = []

        def holen(adresse):
            geholt.append(adresse)
            if adresse == WEG:
                raise RuntimeError("404")
            return PNG

        assert umzug.umziehen(db, ["shops", "staff", "services"], probe=True, holen=holen) == {
            "dokumente": 3, "adressen": 3, "geholt": 0, "fehler": []}
        assert geholt == [] and db.geschrieben == []

        ergebnis = umzug.umziehen(db, ["shops", "staff", "services"], holen=holen)
        assert ergebnis["geholt"] == 2 and len(ergebnis["fehler"]) == 1 and "laden2" in ergebnis["fehler"][0]
        assert sorted(geholt) == sorted([LOGO, FOTO, WEG])  # LOGO nur einmal, obwohl zweimal verwendet
        logo = db.baum["shops"]["laden1"]["logoUrl"]
        assert logo.startswith("https://dranzeit.de/routes/live/dateien/laden1/") and logo.endswith(".png")
        assert db.baum["staff"]["kim"]["extra"]["bilder"] == [logo, "andere"]
        assert db.baum["staff"]["kim"]["profileImageUrl"].startswith("https://dranzeit.de/routes/live/dateien/laden1/")
        assert db.baum["shops"]["laden2"]["logoUrl"] == WEG  # nicht geholt: bleibt
        assert db.baum["shops"]["laden1"]["name"] == "Salon"
        assert sorted(db.geschrieben) == ["kim", "laden1"]
        name = logo.rsplit("/", 1)[1]
        assert open(os.path.join(ordner, "laden1", name), "rb").read() == PNG

        geholt.clear()
        db.geschrieben.clear()
        zweiter = umzug.umziehen(db, ["shops", "staff", "services"], holen=lambda a: PNG)
        assert zweiter["adressen"] == 1 and zweiter["geholt"] == 1  # nur das fehlende noch einmal
        assert db.geschrieben == ["laden2"]


def test_alter_pfad_ohne_laden_nimmt_den_laden_des_dokuments():
    alt = "https://firebasestorage.googleapis.com/v0/b/qmedata-7c79e.firebasestorage.app/o/undefined%2F1743456930137_logo.png?alt=media&token=x"
    with tempfile.TemporaryDirectory() as ordner:
        os.environ["QME_DATEIEN_DIR"] = ordner
        os.environ["PUBLIC_URL"] = "https://dranzeit.de"
        db = Db({"shops": {"laden9": {"logoUrl": alt}}, "staff": {"kim": {"shopId": "laden9", "profileImageUrl": alt.replace("logo", "kim")}},
                 "verzeichnis": {"v1": {"bild": alt.replace("logo", "v")}}})
        ergebnis = umzug.umziehen(db, ["shops", "staff", "verzeichnis"], holen=lambda a: PNG)
        assert ergebnis["geholt"] == 2 and len(ergebnis["fehler"]) == 1, ergebnis
        assert db.baum["shops"]["laden9"]["logoUrl"].startswith("https://dranzeit.de/routes/live/dateien/laden9/")
        assert db.baum["staff"]["kim"]["profileImageUrl"].startswith("https://dranzeit.de/routes/live/dateien/laden9/")
        assert db.baum["verzeichnis"]["v1"]["bild"].startswith("https://firebasestorage")  # kein Laden: bleibt


def test_kein_bild_wird_nicht_uebernommen():
    with tempfile.TemporaryDirectory() as ordner:
        os.environ["QME_DATEIEN_DIR"] = ordner
        db = Db({"shops": {"laden1": {"logoUrl": LOGO}}})
        ergebnis = umzug.umziehen(db, ["shops"], holen=lambda a: b"<html>nein</html>")
        assert ergebnis["geholt"] == 0 and len(ergebnis["fehler"]) == 1
        assert db.baum["shops"]["laden1"]["logoUrl"] == LOGO


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
