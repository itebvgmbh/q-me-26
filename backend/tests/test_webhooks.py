"""
Tests für die Webhooks der Termin-API (app/libs/webhooks.py, Endpunkte /webhooks in app/schnittstelle): anlegen nur für
öffentliche https-Adressen, Ereignisse aus jeder Terminänderung, Signatur, Wiederholen, Aufräumen beim Widerrufen.
Nachgebaute Datenbank wie tests/test_termin_api.py, ohne Netz:

    cd backend && .venv/bin/python tests/test_webhooks.py
"""
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_termin_api import ZUKUNFT, buchen, fehler, kunde, setup  # noqa: E402
from test_telefon import TAG, at  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.libs import api_schluessel as ak  # noqa: E402
from app.libs import webhooks as wh  # noqa: E402

ADRESSEN = {"hooks.example.com": ["93.184.216.34"], "intern.example.com": ["10.0.0.5"], "gemischt.example.com": ["93.184.216.34", "127.0.0.1"]}
wh.adressen = lambda host: ADRESSEN.get(host, [])
URL = "https://hooks.example.com/dranzeit"


class Empfaenger:
    """Ersetzt das Senden: merkt sich jede Zustellung und antwortet mit status"""

    def __init__(self, status=200):
        self.status, self.post = status, []

    def __call__(self, url, kopf, body):
        self.post.append((url, kopf, body))
        if isinstance(self.status, int):
            return self.status, None if 200 <= self.status < 300 else f"HTTP {self.status}"
        return None, self.status


def mit_webhook(**extra):
    client, db, store, rec = setup()
    r = client.post("/webhooks", json={"url": URL, **extra})
    assert r.status_code == 201, r.text
    return client, db, store, r.json()


def jetzt():
    return datetime.now(timezone.utc)


def offene(store):
    return {i: z for i, z in store.get(wh.ZUSTELLUNGEN, {}).items() if z["status"] == "offen"}


def verarbeite(db, store, *ids):
    return wh.verarbeiten(db, [(i, dict(store["appointments"][i])) for i in ids], jetzt())


# --- Anlegen ----------------------------------------------------------------------------------------------------------

def test_anlegen_zeigt_das_geheimnis_einmal():
    client, _, store, neu = mit_webhook()
    assert neu["url"] == URL and neu["geheimnis"].startswith("whsec_") and set(neu["ereignisse"]) == set(wh.EREIGNISSE)
    (eintrag,) = store[wh.SAMMLUNG].values()
    assert eintrag["shopId"] == "laden" and eintrag["schluesselId"] and eintrag["geheimnis"] == neu["geheimnis"]
    liste = client.get("/webhooks").json()
    assert [w["id"] for w in liste] == [neu["id"]] and "geheimnis" not in liste[0]
    nur = client.post("/webhooks", json={"url": URL + "/2", "ereignisse": ["termin.abgesagt"]}).json()
    assert nur["ereignisse"] == ["termin.abgesagt"]
    assert client.post("/webhooks", json={"url": URL, "ereignisse": ["termin.explodiert"]}).status_code == 422


def test_nur_oeffentliche_https_adressen():
    client, _, store, _ = setup()
    for url in ("http://hooks.example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/x",
                "https://192.168.1.10/x", "https://[::1]/x", "https://intern.example.com/x", "https://gemischt.example.com/x",
                "https://gibtsnicht.example.com/x", "https://nutzer:pw@hooks.example.com/x", "ftp://hooks.example.com"):
        fehler(client.post("/webhooks", json={"url": url}), 400, "url_ungueltig")
    assert not store.get(wh.SAMMLUNG)


def test_hoechstens_fuenf_je_laden_und_loeschen():
    client, _, store, _ = setup()
    ids = [client.post("/webhooks", json={"url": f"{URL}/{i}"}).json()["id"] for i in range(wh.MAX_JE_LADEN)]
    fehler(client.post("/webhooks", json={"url": URL}), 400, "zu_viele_webhooks")
    assert client.delete(f"/webhooks/{ids[0]}").status_code == 204
    assert ids[0] not in store[wh.SAMMLUNG] and len(client.get("/webhooks").json()) == wh.MAX_JE_LADEN - 1
    fehler(client.delete(f"/webhooks/{ids[0]}"), 404, "webhook_unbekannt")


def test_fremder_laden_sieht_keine_webhooks():
    client, db, store, neu = mit_webhook()
    store[wh.SAMMLUNG]["fremd"] = {"shopId": "laden2", "url": URL, "ereignisse": list(wh.EREIGNISSE), "geheimnis": "whsec_x",
                                   "schluesselId": "x", "createdAt": jetzt()}
    assert [w["id"] for w in client.get("/webhooks").json()] == [neu["id"]]
    fehler(client.delete("/webhooks/fremd"), 404, "webhook_unbekannt")
    fehler(client.post("/webhooks/fremd/test"), 404, "webhook_unbekannt")
    fehler(client.get("/webhooks/fremd/zustellungen"), 404, "webhook_unbekannt")


# --- Ereignisse -------------------------------------------------------------------------------------------------------

def test_neuer_termin_wird_gemeldet_mit_dem_termin_wie_in_der_api():
    client, db, store, neu = mit_webhook()
    tid = buchen(client, person_id="robin", kunde_id=kunde(client)).json()["id"]
    assert verarbeite(db, store, tid) == 1
    (z,) = offene(store).values()
    body = json.loads(z["body"])
    assert body["typ"] == "termin.angelegt" and body["laden_id"] == "laden" and body["id"].startswith("evt_")
    assert body["termin"] == client.get(f"/termine/{tid}").json(), "gleiche Felder wie GET /termine/{id}"
    assert z["webhookId"] == neu["id"] and z["typ"] == "termin.angelegt"
    assert verarbeite(db, store, tid) == 0, "unverändert: nichts doppelt"


def test_verschoben_abgesagt_geaendert_und_unwichtiges():
    client, db, store, _ = mit_webhook()
    tid = buchen(client, person_id="robin").json()["id"]
    verarbeite(db, store, tid)
    store[wh.ZUSTELLUNGEN].clear()
    store["appointments"][tid]["notifiedSoonAt"] = jetzt()  # interner Merker
    store["appointments"][tid]["reminderSentAt"] = jetzt()
    assert verarbeite(db, store, tid) == 0
    client.post(f"/termine/{tid}/verschieben", json={"start": at("14:00").isoformat(), "person_id": "kim"})
    assert verarbeite(db, store, tid) == 1
    (z,) = offene(store).values()
    body = json.loads(z["body"])
    assert body["typ"] == "termin.verschoben" and body["termin"]["person_id"] == "kim"
    assert datetime.fromisoformat(body["vorher"]["start"]) == at("10:30") and body["vorher"]["person_id"] == "robin"
    store[wh.ZUSTELLUNGEN].clear()
    store["appointments"][tid]["status"] = "in-progress"  # am Tresen aufgerufen
    assert verarbeite(db, store, tid) == 1 and json.loads(next(iter(offene(store).values()))["body"])["typ"] == "termin.geaendert"
    store[wh.ZUSTELLUNGEN].clear()
    store["appointments"][tid]["status"] = "scheduled"
    verarbeite(db, store, tid)
    store[wh.ZUSTELLUNGEN].clear()
    client.post(f"/termine/{tid}/absagen", json={})
    assert verarbeite(db, store, tid) == 1
    assert json.loads(next(iter(offene(store).values()))["body"])["typ"] == "termin.abgesagt"


def test_termine_von_vor_dem_webhook_nur_merken():
    client, db, store, _ = setup()
    tid = buchen(client, person_id="robin").json()["id"]
    store["appointments"][tid]["createdAt"] = jetzt() - timedelta(days=2)
    client.post("/webhooks", json={"url": URL})
    assert verarbeite(db, store, tid) == 0 and not offene(store), "Bestand löst kein termin.angelegt aus"
    client.post(f"/termine/{tid}/verschieben", json={"start": at("12:00").isoformat()})
    assert verarbeite(db, store, tid) == 1 and json.loads(next(iter(offene(store).values()))["body"])["typ"] == "termin.verschoben"


def test_nur_abonnierte_ereignisse_und_nur_der_eigene_laden():
    client, db, store, _ = setup()
    client.post("/webhooks", json={"url": URL, "ereignisse": ["termin.abgesagt"]})
    tid = buchen(client, person_id="robin").json()["id"]
    assert verarbeite(db, store, tid) == 0
    store["appointments"]["fremd"] = {**store["appointments"][tid], "shopId": "laden2", "createdAt": jetzt()}
    assert verarbeite(db, store, "fremd") == 0
    client.post(f"/termine/{tid}/absagen", json={})
    assert verarbeite(db, store, tid) == 1


# --- Zustellen --------------------------------------------------------------------------------------------------------

def test_zustellen_signiert():
    client, db, store, neu = mit_webhook()
    tid = buchen(client, person_id="robin").json()["id"]
    verarbeite(db, store, tid)
    empf = Empfaenger(200)
    assert wh.zustellen(db, jetzt(), senden=empf) == 1
    url, kopf, body = empf.post[0]
    assert url == URL and kopf["Content-Type"] == "application/json" and kopf["Dranzeit-Ereignis"] == "termin.angelegt"
    t, v1 = (teil.split("=", 1)[1] for teil in kopf["Dranzeit-Signatur"].split(","))
    erwartet = hmac.new(neu["geheimnis"].encode(), f"{t}.{body}".encode(), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(v1, erwartet), "Signatur prüfbar mit dem Geheimnis"
    assert abs(int(t) - jetzt().timestamp()) < 60
    (z,) = store[wh.ZUSTELLUNGEN].values()
    assert z["status"] == "zugestellt" and z["versuche"] == 1 and z["letzterStatus"] == 200
    assert wh.zustellen(db, jetzt(), senden=empf) == 0, "nichts doppelt"


def test_wiederholen_und_aufgeben():
    client, db, store, _ = mit_webhook()
    tid = buchen(client, person_id="robin").json()["id"]
    verarbeite(db, store, tid)
    empf = Empfaenger(500)
    t0 = jetzt()
    wh.zustellen(db, t0, senden=empf)
    (z,) = store[wh.ZUSTELLUNGEN].values()
    assert z["status"] == "offen" and z["versuche"] == 1 and z["letzterFehler"] == "HTTP 500"
    assert z["naechsterVersuch"] == t0 + timedelta(minutes=wh.WIEDERHOLEN_MINUTEN[0])
    assert wh.zustellen(db, t0 + timedelta(seconds=30), senden=empf) == 0, "erst nach der Pause"
    z["versuche"] = len(wh.WIEDERHOLEN_MINUTEN)
    z["naechsterVersuch"] = t0
    wh.zustellen(db, t0 + timedelta(seconds=1), senden=Empfaenger("Timeout"))
    assert z["status"] == "fehlgeschlagen" and z["letzterFehler"] == "Timeout"


def test_widerrufener_schluessel_nimmt_seine_webhooks_mit():
    client, db, store, _ = mit_webhook()
    tid = buchen(client, person_id="robin").json()["id"]
    verarbeite(db, store, tid)
    schluessel_id = next(iter(store["api_schluessel"]))
    ak.widerrufen(db, "laden", schluessel_id)
    assert not store[wh.SAMMLUNG], "Webhooks des Schlüssels weg"
    empf = Empfaenger(200)
    wh.zustellen(db, jetzt(), senden=empf)
    assert not empf.post and next(iter(store[wh.ZUSTELLUNGEN].values()))["status"] == "verworfen"


def test_ohne_tarif_wird_nichts_verschickt():
    client, db, store, _ = mit_webhook()
    tid = buchen(client, person_id="robin").json()["id"]
    verarbeite(db, store, tid)
    store["shops"]["laden"]["trialEndsAt"] = jetzt() - timedelta(days=1)
    empf = Empfaenger(200)
    wh.zustellen(db, jetzt(), senden=empf)
    assert not empf.post and next(iter(store[wh.ZUSTELLUNGEN].values()))["status"] == "verworfen"


def test_senden_prueft_die_adresse_noch_einmal():
    """DNS kann sich nach dem Anlegen ändern: nie an eine interne Adresse schicken"""
    import requests

    def nie(*a, **k):
        raise AssertionError("an eine interne Adresse geschickt")

    vorher = requests.post
    requests.post = nie
    try:
        status, grund = wh.senden("https://intern.example.com/x", {}, "{}")
        assert status is None and grund
    finally:
        requests.post = vorher


def test_ping_und_zustellungen_ansehen():
    client, db, store, neu = mit_webhook()
    empf = Empfaenger(204)
    wh.SENDEN = empf
    try:
        r = client.post(f"/webhooks/{neu['id']}/test")
    finally:
        wh.SENDEN = wh.senden
    assert r.status_code == 200 and r.json() == {"ok": True, "status": 204, "fehler": None}, r.text
    assert json.loads(empf.post[0][2])["typ"] == "ping"
    tid = buchen(client, person_id="robin").json()["id"]
    verarbeite(db, store, tid)
    wh.zustellen(db, jetzt(), senden=Empfaenger(500))
    (z,) = client.get(f"/webhooks/{neu['id']}/zustellungen").json()
    assert z["typ"] == "termin.angelegt" and z["status"] == "offen" and z["versuche"] == 1 and z["letzter_fehler"] == "HTTP 500"
    assert z["naechster_versuch"] and "body" not in z


def test_aufraeumen_nach_einer_woche():
    client, db, store, _ = mit_webhook()
    tid = buchen(client, person_id="robin").json()["id"]
    verarbeite(db, store, tid)
    wh.zustellen(db, jetzt(), senden=Empfaenger(200))
    assert wh.aufraeumen(db, jetzt()) == 0
    assert wh.aufraeumen(db, jetzt() + timedelta(days=wh.AUFHEBEN_TAGE + 1)) >= 1
    assert not store[wh.ZUSTELLUNGEN]


# --- Inhaber sieht die Webhooks -----------------------------------------------------------------------------------------

def test_inhaber_sieht_und_entfernt_webhooks():
    from test_termin_api import inhaber_client

    _, _, store, neu = mit_webhook()
    c = inhaber_client(store, "chefin")
    stand = c.get("/routes/team/laeden/laden/api-schluessel").json()
    assert [(w["id"], w["url"]) for w in stand["webhooks"]] == [(neu["id"], URL)] and "geheimnis" not in str(stand)
    assert c.post(f"/routes/team/laeden/laden/webhooks/{neu['id']}/entfernen").status_code == 200
    assert not store[wh.SAMMLUNG]
    store["staff"]["robin"]["userId"] = "robin-konto"
    assert inhaber_client(store, "robin-konto").get("/routes/team/laeden/laden/api-schluessel").status_code == 403


def test_beschreibung_nennt_webhooks():
    schema = TestClient(__import__("app.schnittstelle", fromlist=["app"]).app).get("/openapi.json").json()
    assert {"/webhooks", "/webhooks/{webhook_id}", "/webhooks/{webhook_id}/test", "/webhooks/{webhook_id}/zustellungen"} <= set(schema["paths"])
    text = schema["info"]["description"]
    assert "## Webhooks" in text and "Dranzeit-Signatur" in text and "Webhooks**, also" not in text


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
