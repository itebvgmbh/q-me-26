"""
Tests für die Kundenkartei (app/libs/kartei.py, Endpunkte in app/apis/team_laden): Kennzahlen, Verlauf mit Preis,
Notizen, Zuordnen am Tresen (kundeId), Zuordnen über die Handynummer beim Buchen ohne Konto (app/apis/nummer) und
Löschen samt zugeordneter Termine (app/libs/privacy.py). Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_kartei.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import store  # noqa: E402
from app.libs import kartei, laeden  # noqa: E402
from app.libs import telefon_kunden as tk  # noqa: E402

import test_team_termine as tt  # noqa: E402

UTC = timezone.utc
JETZT = datetime(2026, 11, 12, 12, 0, tzinfo=UTC)
T = lambda tage, h=10: (JETZT + timedelta(days=tage)).replace(hour=h, minute=0)  # noqa: E731


def _update(self, daten):
    """Wie Firestore update(): Feld-Pfade mit Punkten, DELETE_FIELD entfernt"""
    doc = self._docs().get(self.id)
    assert doc is not None, "update() auf fehlendes Dokument"
    for feld, wert in daten.items():
        teile = feld.split(".")
        ziel = doc
        for teil in teile[:-1]:
            if not isinstance(ziel.get(teil), dict):
                ziel[teil] = {}
            ziel = ziel[teil]
        if wert is store.DELETE_FIELD:
            ziel.pop(teile[-1], None)
        else:
            ziel[teile[-1]] = wert


def _loeschen(self):
    self._docs().pop(self.id, None)


tt.Ref.update = _update
tt.Ref.delete = _loeschen
tt.Query.limit = lambda self, n: self


def termin(tage, status="completed", **extra):
    return {"shopId": "laden1", "staffId": "kim", "serviceId": "schnitt", "type": "booked", "status": status,
            "startTime": T(tage), "endTime": T(tage) + timedelta(minutes=30), "customerName": "Robin", **extra}


def daten(**termine):
    return {
        "shops": {
            "laden1": {"name": "Salon", "owner": "chefin", "plan": "solo", "billing": {"plan": "solo", "status": "active"}},
            "laden2": {"name": "Anderer", "owner": "fremd"},
            "gratis": {"name": "Klein", "owner": "chefin", "plan": "gratis", "createdAt": JETZT - timedelta(days=400),
                       "trialEndsAt": datetime.now(UTC) - timedelta(days=1)},
        },
        "staff": {
            "kim": {"shopId": "laden1", "name": "Kim", "userId": "kim-konto", "isActive": True},
            "ali": {"shopId": "laden1", "name": "Ali", "isActive": True},
        },
        "services": {
            "schnitt": {"shopId": "laden1", "name": "Schnitt", "price": 25},
            "farbe": {"shopId": "laden1", "name": "Farbe", "price": 60},
        },
        "customers": {
            "robin": {"shopId": "laden1", "name": "Robin", "email": "", "phone": "0170 1234567", "isActive": False,
                      "createdAt": JETZT - timedelta(days=300), "updatedAt": JETZT - timedelta(days=300),
                      "notiz": "mag es kurz", "besuchsnotizen": {"a1": {"text": "6/0 + 6 % 30 Min.", "geaendert": JETZT}},
                      "activationTokenHash": "geheim"},
            "kara": {"shopId": "laden1", "name": "Kara", "email": "kara@example.com", "userId": "kara-konto", "isActive": True,
                     "createdAt": JETZT - timedelta(days=30)},
            "fremd": {"shopId": "laden2", "name": "Fremd", "email": ""},
        },
        "appointments": dict(termine),
    }


# --- Kennzahlen ---------------------------------------------------------------------------------------------------


def test_kennzahlen_besuche_umsatz_abstand_und_vorlieben():
    termine = [
        termin(5, status="scheduled"),                                   # kommt noch
        termin(-1, status="scheduled"),                                  # vorbei, nicht abgehakt: zählt als Besuch
        termin(-30, serviceId="farbe", price=55),                        # Preis am Termin gilt
        termin(-61, staffId="ali"),                                      # ohne Preis: Listenpreis 25
        termin(-10, status="cancelled"),
        termin(-20, status="cancelled", noShow=True),
    ]
    z = kartei.kennzahlen(termine, {"schnitt": 25, "farbe": 60}, {"schnitt": "Schnitt", "farbe": "Farbe"},
                          {"kim": "Kim", "ali": "Ali"}, JETZT)
    assert z["besuche"] == 3 and z["umsatz"] == 25 + 55 + 25, z
    assert z["abgesagt"] == 1 and z["nichtGekommen"] == 1
    assert z["zuletzt"] == T(-1) and z["erster"] == T(-61) and z["naechster"] == T(5)
    assert z["abstandTage"] == 30
    assert z["lieblingsLeistung"] == "Schnitt" and z["lieblingsPerson"] == "Kim"


def test_kennzahlen_ohne_besuche():
    z = kartei.kennzahlen([], {}, {}, {}, JETZT)
    assert z["besuche"] == 0 and z["umsatz"] == 0 and z["zuletzt"] is None and z["abstandTage"] is None
    assert z["lieblingsLeistung"] == ""


# --- Liste und Kundenseite ----------------------------------------------------------------------------------------


def test_liste_ordnet_ueber_eintrag_konto_und_kundeId_zu():
    db = tt.Db(daten(
        a1=termin(-40, customerId="robin"),                      # vom Laden für Robin eingetragen
        a2=termin(-10, customerId="kara-konto"),                 # Kara mit Konto
        a3=termin(-5, isAnonymous=True, kundeId="robin"),        # Nummer ohne Konto, zugeordnet
        a4=termin(-3, customerId="robin", kundeId="kara"),       # am Tresen zu Kara umgehängt
        a5=termin(-2, customerId="walk-in"),                     # Laufkunde ohne Zuordnung
        a6=termin(-2, customerId="robin", shopId="laden2"),      # anderer Laden
    ))
    kunden = {k["id"]: k for k in kartei.liste(db, "laden1", True, JETZT)}
    assert set(kunden) == {"robin", "kara"}
    assert kunden["robin"]["kennzahlen"]["besuche"] == 2 and kunden["robin"]["kennzahlen"]["umsatz"] == 50
    assert kunden["kara"]["kennzahlen"]["besuche"] == 2
    # Notizen und Geheimes bleiben draußen, nur ein Merker
    assert kunden["robin"]["hatNotiz"] is True and not kunden["kara"]["hatNotiz"]
    for privat in ("notiz", "besuchsnotizen", "activationTokenHash"):
        assert privat not in kunden["robin"], privat
    # Ohne Kartei im Tarif: nur die Liste
    ohne = kartei.liste(db, "laden1", False, JETZT)
    assert all("kennzahlen" not in k and "notiz" not in k for k in ohne)


def test_termine_von_nimmt_zugeordnete_und_laesst_umgehaengte_weg():
    db = tt.Db(daten(a1=termin(-40, customerId="robin"), a3=termin(-5, kundeId="robin"), a4=termin(-3, customerId="robin", kundeId="kara")))
    robin = db.daten["customers"]["robin"]
    assert [tid for tid, _ in tk.termine_von(db, "laden1", "robin", robin)] == ["a3", "a1"]
    kara = db.daten["customers"]["kara"]
    assert [tid for tid, _ in tk.termine_von(db, "laden1", "kara", kara)] == ["a4"]


def test_karte_mit_und_ohne_kartei():
    db = tt.Db(daten(a1=termin(-40, customerId="robin"), a3=termin(-5, kundeId="robin", status="scheduled")))
    k = kartei.karte(db, "laden1", "robin", True, JETZT)
    assert k["kunde"]["notiz"] == "mag es kurz" and "activationTokenHash" not in k["kunde"]
    assert [t["id"] for t in k["termine"]] == ["a3", "a1"]
    a1 = k["termine"][1]
    assert a1["notiz"] == "6/0 + 6 % 30 Min." and a1["preis"] == 25 and a1["leistung"] == "Schnitt" and a1["person"] == "Kim"
    assert k["termine"][0]["zugeordnet"] is True and a1["zugeordnet"] is False
    assert k["kennzahlen"]["besuche"] == 2
    ohne = kartei.karte(db, "laden1", "robin", False, JETZT)
    assert "kennzahlen" not in ohne and "notiz" not in ohne["kunde"] and "notiz" not in ohne["termine"][1]
    try:
        kartei.karte(db, "laden1", "fremd", True, JETZT)
        raise AssertionError("fremder Eintrag")
    except kartei.KarteiFehler as e:
        assert e.status == 404


# --- Ändern und Notizen -------------------------------------------------------------------------------------------


def _fehler(fn, status):
    try:
        fn()
    except kartei.KarteiFehler as e:
        assert e.status == status, (e.status, e.text)
        return e.text
    raise AssertionError("kein Fehler")


def test_aendern_kontakt_und_notiz():
    db = tt.Db(daten())
    vorher = db.daten["customers"]["robin"]["updatedAt"]
    kartei.aendern(db, "laden1", "robin", {"notiz": "  Kaffee schwarz  "}, True, JETZT)
    robin = db.daten["customers"]["robin"]
    assert robin["notiz"] == "Kaffee schwarz" and robin["notizGeaendert"] == JETZT
    assert robin["updatedAt"] == vorher, "Notizen verlängern die Löschfrist nicht"
    kartei.aendern(db, "laden1", "robin", {"name": " Robin   Rot ", "phone": "+49 170 7654321", "email": "Robin@Example.com"}, True, JETZT)
    assert robin["name"] == "Robin Rot" and robin["phone"] == "+49 170 7654321" and robin["email"] == "robin@example.com"
    assert robin["updatedAt"] == JETZT
    _fehler(lambda: kartei.aendern(db, "laden1", "robin", {"name": " "}, True, JETZT), 400)
    _fehler(lambda: kartei.aendern(db, "laden1", "robin", {"phone": "abc"}, True, JETZT), 400)
    _fehler(lambda: kartei.aendern(db, "laden1", "robin", {"email": "ohne-at"}, True, JETZT), 400)
    _fehler(lambda: kartei.aendern(db, "laden1", "robin", {"userId": "x"}, True, JETZT), 400)
    _fehler(lambda: kartei.aendern(db, "laden1", "robin", {"notiz": "x" * 2001}, True, JETZT), 400)
    _fehler(lambda: kartei.aendern(db, "laden1", "kara", {"email": "neu@example.com"}, True, JETZT), 400)
    _fehler(lambda: kartei.aendern(db, "laden1", "robin", {"notiz": "x"}, False, JETZT), 403)
    _fehler(lambda: kartei.aendern(db, "laden1", "fremd", {"name": "x"}, True, JETZT), 404)


def test_besuchsnotiz_nur_fuer_eigene_termine():
    db = tt.Db(daten(a1=termin(-40, customerId="robin"), a2=termin(-10, customerId="kara-konto")))
    kartei.besuchsnotiz(db, "laden1", "robin", "a1", " Blond 9/1 ", JETZT)
    assert db.daten["customers"]["robin"]["besuchsnotizen"]["a1"] == {"text": "Blond 9/1", "geaendert": JETZT}
    _fehler(lambda: kartei.besuchsnotiz(db, "laden1", "robin", "a2", "x", JETZT), 404)
    kartei.besuchsnotiz(db, "laden1", "robin", "a1", "", JETZT)
    assert "a1" not in db.daten["customers"]["robin"]["besuchsnotizen"]


def test_kundenliste_und_anlegen_ohne_notizen():
    eintrag = laeden.kunde_fuers_team("robin", daten()["customers"]["robin"])
    assert "notiz" not in eintrag and "besuchsnotizen" not in eintrag and "activationTokenHash" not in eintrag
    db = tt.Db(daten())
    neu = laeden.kunde_anlegen(db, {"shopId": "laden1", "name": "Neu", "email": "", "notiz": "vom Browser", "besuchsnotizen": {}})
    assert "notiz" not in db.daten["customers"][neu["id"]]


# --- Zuordnen -----------------------------------------------------------------------------------------------------


def test_zuordnen_am_tresen_nur_eintraege_des_ladens():
    from app.libs import team_termine

    db = tt.Db(daten())
    team_termine._pruefen(db, "laden1", {"kundeId": "robin"})
    team_termine._pruefen(db, "laden1", {"kundeId": ""})  # lösen
    for falsch in ("fremd", "gibtsnicht", "../x", 5):
        try:
            team_termine._pruefen(db, "laden1", {"kundeId": falsch})
            raise AssertionError(falsch)
        except team_termine.TerminFehler as e:
            assert e.status == 400


def test_buchung_ohne_konto_per_handynummer():
    import app.apis.nummer as nummer

    db = tt.Db(daten())
    ohne_konto = {"isAnonymous": True, "customerName": "Robin", "customerPhone": "0170/1234567"}
    # Nummer gibt es schon: dieser Eintrag, nichts Neues
    assert nummer._karteieintrag(db, "laden1", ohne_konto) == ({"kundeId": "robin"}, None)
    # Neue Nummer mit Namen: neuer Eintrag „online“, gespeichert erst nach dem Termin
    felder, neu = nummer._karteieintrag(db, "laden1", {**ohne_konto, "customerName": "Sam", "customerPhone": "0151 2223334"})
    assert felder == {"kundeId": neu["id"]} and neu["source"] == "online" and neu["phone"] == "+491512223334" and neu["name"] == "Sam"
    assert neu["id"] not in db.daten["customers"]
    nummer._eintrag_speichern(db, {"id": "t1", "shopId": "laden1"}, neu)
    assert db.daten["customers"][neu["id"]]["shopId"] == "laden1"
    # Ohne Namen kein neuer Eintrag; ohne Nummer, mit Konto oder unlesbar: nichts
    assert nummer._karteieintrag(db, "laden1", {**ohne_konto, "customerName": "Unbekannter Kunde", "customerPhone": "0160 9998887"}) == ({}, None)
    assert nummer._karteieintrag(db, "laden1", {"isAnonymous": True, "customerName": "X"}) == ({}, None)
    assert nummer._karteieintrag(db, "laden1", {"isAnonymous": False, "customerId": "kara-konto", "customerPhone": "0170 1234567"}) == ({}, None)
    assert nummer._karteieintrag(db, "laden1", {**ohne_konto, "customerPhone": "abc"}) == ({}, None)


# --- Löschen ------------------------------------------------------------------------------------------------------


def test_loeschen_nimmt_zugeordnete_termine_mit():
    from app.libs import privacy
    import app.libs.public_appointments as pa

    pa.write_public = lambda *a, **k: None
    db = tt.Db(daten(
        a1=termin(-40, customerId="robin"),
        a3=termin(-5, isAnonymous=True, kundeId="robin", customerPhone="0170 1234567"),
        a4=termin(3, status="scheduled", isAnonymous=True, kundeId="robin"),
        a5=termin(-5, customerId="kara-konto", kundeId="kara"),
    ))
    db.daten["telefon_anrufliste"] = {}
    ref = db.collection("customers").document("robin")
    ergebnis = privacy.forget_customer(db, ref, db.daten["customers"]["robin"], JETZT)
    assert "robin" not in db.daten["customers"]
    a3, a4 = db.daten["appointments"]["a3"], db.daten["appointments"]["a4"]
    assert a3["kundeId"] is None and a3["customerPhone"] is None and a3["customerName"] != "Robin"
    assert a4["status"] == "cancelled"
    assert ergebnis["cancelled"] == 1 and ergebnis["anonymized"] == 3
    # Kara hat ein Konto: ihr eigener Termin (mit Konto gebucht) bleibt unberührt
    privacy.forget_customer(db, db.collection("customers").document("kara"), db.daten["customers"]["kara"], JETZT)
    assert db.daten["appointments"]["a5"]["customerName"] == "Robin" and db.daten["appointments"]["a5"]["kundeId"] == "kara"


def test_zugeordneter_termin_haelt_den_eintrag():
    from app.libs import privacy

    alt = JETZT - timedelta(days=500)
    d = daten(a3=termin(-30, isAnonymous=True, kundeId="robin"))
    d["customers"]["robin"].update(createdAt=alt, updatedAt=alt)
    db = tt.Db(d)
    db.daten["telefon_anrufliste"] = {}
    privacy.delete_stale_customers(db, JETZT, accounts=lambda uids: set(uids))
    assert "robin" in db.daten["customers"] and "fremd" not in db.daten["customers"]  # fremd: nie ein Termin


# --- Endpunkte ----------------------------------------------------------------------------------------------------


def client(d, uid):
    import app.apis.firebase_utils as fu
    import app.apis.team_laden as api
    from databutton_app.mw.auth_mw import get_authorized_user

    db = tt.Db(d)
    store.db = lambda: db
    fu.get_firestore_db = lambda: db
    app = FastAPI()
    app.include_router(api.router, prefix="/routes")
    app.dependency_overrides[get_authorized_user] = lambda: SimpleNamespace(sub=uid, email=f"{uid}@example.com", email_verified=False)
    return TestClient(app), db


def test_endpunkte_rechte_tarif_und_notizen():
    d = daten(a1=termin(-40, customerId="robin"))
    d["customers"]["klein"] = {"shopId": "gratis", "name": "Klein", "email": ""}
    c, db = client(d, "chefin")
    r = c.get("/routes/team/laeden/laden1/kartei")
    assert r.status_code == 200 and r.json()["kartei"] is True, r.text
    robin = next(k for k in r.json()["kunden"] if k["id"] == "robin")
    assert robin["kennzahlen"]["besuche"] == 1 and "notiz" not in robin
    r = c.get("/routes/team/laeden/laden1/kartei/robin")
    assert r.json()["kunde"]["notiz"] == "mag es kurz"
    r = c.post("/routes/team/laeden/laden1/kartei/robin", json={"aenderung": {"notiz": "neu"}})
    assert r.status_code == 200 and r.json()["kunde"]["notiz"] == "neu", r.text
    r = c.post("/routes/team/laeden/laden1/kartei/robin/besuch/a1", json={"notiz": "Rezeptur"})
    assert r.status_code == 200 and r.json()["notiz"]["text"] == "Rezeptur", r.text
    assert c.post("/routes/team/laeden/laden1/kartei/fremd", json={"aenderung": {"name": "x"}}).status_code == 404
    # Gratis: Liste ohne Kennzahlen, keine Notizen
    r = c.get("/routes/team/laeden/gratis/kartei")
    assert r.json()["kartei"] is False and "kennzahlen" not in r.json()["kunden"][0]
    assert c.post("/routes/team/laeden/gratis/kartei/klein", json={"aenderung": {"notiz": "x"}}).status_code == 403
    assert c.post("/routes/team/laeden/gratis/kartei/klein", json={"aenderung": {"name": "Kleiner"}}).status_code == 200
    # Fremde kommen nicht dran
    c2, _ = client(d, "fremd")
    assert c2.get("/routes/team/laeden/laden1/kartei").status_code == 403
    assert c2.get("/routes/team/laeden/laden1/kartei/robin").status_code == 403


def test_tablet_am_tresen_kommt_nicht_an_die_kartei():
    from app.libs import geraete

    assert geraete.erlaubt("GET", "/routes/team/laeden/laden1/kunden")
    assert geraete.erlaubt("POST", "/routes/team/termine/a1")  # Kunde zuordnen
    assert not geraete.erlaubt("GET", "/routes/team/laeden/laden1/kartei")
    assert not geraete.erlaubt("GET", "/routes/team/laeden/laden1/kartei/robin")
    assert not geraete.erlaubt("POST", "/routes/team/laeden/laden1/kartei/robin/besuch/a1")


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
