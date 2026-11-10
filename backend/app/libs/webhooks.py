"""
Webhooks der Termin-API (requirements/termin-api.md, Endpunkte /webhooks in app/schnittstelle): Dranzeit meldet dem
Programm eines Ladens jede Änderung an seinen Terminen, egal wer sie gemacht hat (online, Tresen, Kalender, Telefon,
„Früher dran“, API).

- **Mitbekommen:** Ein Listener auf die Termine der Läden mit Webhook (ab gestern, `start_webhooks`). Jede Änderung
  wird mit dem zuletzt gemeldeten Stand verglichen (Sammlung STAND, nur die Felder in RELEVANT). Der Stand liegt in der
  Datenbank, also gehen nach einem Neustart keine Änderungen verloren. Interne Merker (Erinnerung verschickt …) lösen
  nichts aus. Termine von vor dem ersten Webhook des Ladens merkt er sich nur, ohne termin.angelegt.
- **Zustellen:** Je Ereignis und Webhook eine Zustellung (Sammlung ZUSTELLUNGEN), signiert mit dem Geheimnis des
  Webhooks (HMAC-SHA256 über "<Zeitstempel>.<Body>", Kopfzeile Dranzeit-Signatur). Geht sie nicht durch (kein 2xx),
  neuer Versuch nach WIEDERHOLEN_MINUTEN, danach „fehlgeschlagen“. Nach AUFHEBEN_TAGEN weg.
- **Adressen:** nur https und nur öffentliche Adressen, beim Anlegen und vor jedem Senden geprüft (nie an den eigenen
  Server oder ins interne Netz). Keine Weiterleitungen.
- Ein Webhook gehört zu dem Schlüssel, mit dem er angelegt wurde: Widerrufen nimmt ihn mit (app/libs/api_schluessel.py).
  Ohne Tarif oder bei gesperrtem Laden wird nichts verschickt.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import secrets
import socket
import threading
import time as uhr
from datetime import datetime, time, timedelta, timezone
from typing import Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from app.libs.plans import has_feature, is_suspended
from app.libs.schedule import BERLIN, aware

SAMMLUNG = "api_webhooks"
STAND = "api_webhook_stand"
ZUSTELLUNGEN = "api_webhook_zustellungen"
EREIGNISSE = ("termin.angelegt", "termin.verschoben", "termin.abgesagt", "termin.geaendert")
MAX_JE_LADEN = 5
WIEDERHOLEN_MINUTEN = (1, 5, 15, 60, 180, 360, 720)  # Pausen nach dem 1., 2., … Versuch; zusammen gut 22 Stunden
AUFHEBEN_TAGE = 7
STAND_TAGE = 3  # Stand eines Termins so lange nach seinem Beginn aufheben
# Was ein Ereignis auslöst: die Felder, aus denen die API den Termin macht
RELEVANT = ("status", "type", "serviceId", "staffId", "customerId", "customerName", "startTime", "endTime",
            "referenceCode", "price", "checkEarlierOptions")
ZEITLIMIT = (5, 10)  # Sekunden: Verbindung, Antwort


class WebhookFehler(Exception):
    def __init__(self, status: int, code: str, meldung: str):
        super().__init__(meldung)
        self.status, self.code, self.meldung = status, code, meldung


def _iso(wert) -> Optional[str]:
    return aware(wert).astimezone(BERLIN).isoformat() if isinstance(wert, datetime) else None


def _utc(wert) -> Optional[str]:
    return aware(wert).astimezone(timezone.utc).isoformat() if isinstance(wert, datetime) else wert


# --- Adressen ---------------------------------------------------------------------------------------------------------

def adressen(host: str) -> List[str]:
    """IP-Adressen zu einem Namen (leer, wenn er sich nicht auflösen lässt)"""
    try:
        return sorted({info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
    except (socket.gaierror, UnicodeError, OSError):
        return []


def url_pruefen(url: str) -> str:
    """Nur https, ohne Benutzer und Passwort, und jede Adresse des Namens im öffentlichen Internet – sonst WebhookFehler"""
    url = str(url or "").strip()
    try:
        teile = urlsplit(url)
        host = teile.hostname
        teile.port  # wirft bei kaputtem Port
        sauber = teile.scheme == "https" and not teile.username and not teile.password
    except ValueError:
        host, sauber = None, False
    if len(url) > 500 or not host or not sauber:
        raise WebhookFehler(400, "url_ungueltig", "Bitte eine https-Adresse ohne Benutzername und Passwort angeben.")
    try:
        ips = [str(ipaddress.ip_address(host))]
    except ValueError:
        ips = adressen(host)
    if not ips:
        raise WebhookFehler(400, "url_ungueltig", "Diese Adresse lässt sich nicht auflösen.")
    if not all(ipaddress.ip_address(ip).is_global for ip in ips):
        raise WebhookFehler(400, "url_ungueltig", "Webhooks gehen nur an Adressen im öffentlichen Internet.")
    return url


# --- Webhooks anlegen und verwalten -------------------------------------------------------------------------------------

def oeffentlich(webhook_id: str, w: dict) -> dict:
    """Für die API: nie das Geheimnis"""
    return {"id": webhook_id, "url": w.get("url", ""), "ereignisse": list(w.get("ereignisse") or EREIGNISSE),
            "angelegt": _iso(w.get("createdAt"))}


def fuer_den_inhaber(webhook_id: str, w: dict) -> dict:
    return {"id": webhook_id, "url": w.get("url", ""), "ereignisse": list(w.get("ereignisse") or EREIGNISSE),
            "angelegt": w.get("createdAt")}


def alle(db) -> List[Tuple[str, dict]]:
    return [(d.id, d.to_dict() or {}) for d in db.collection(SAMMLUNG).stream()]


def des_ladens(db, shop_id: str) -> List[Tuple[str, dict]]:
    eigene = [(d.id, d.to_dict() or {}) for d in db.collection(SAMMLUNG).where("shopId", "==", shop_id).stream()]
    return sorted(eigene, key=lambda e: _utc(e[1].get("createdAt")) or "")


def anlegen(db, shop_id: str, schluessel_id: str, url: str, ereignisse: Optional[List[str]], jetzt: datetime) -> Tuple[dict, str]:
    """Neuer Webhook: (für die API, Geheimnis im Klartext – nur dieses eine Mal)"""
    if len(des_ladens(db, shop_id)) >= MAX_JE_LADEN:
        raise WebhookFehler(400, "zu_viele_webhooks", f"Höchstens {MAX_JE_LADEN} Webhooks je Laden. Lösche erst einen alten.")
    url = url_pruefen(url)
    geheimnis = "whsec_" + secrets.token_urlsafe(32)
    webhook_id = "wh_" + secrets.token_hex(8)
    eintrag = {"shopId": shop_id, "schluesselId": schluessel_id, "url": url,
               "ereignisse": [e for e in EREIGNISSE if e in (ereignisse or EREIGNISSE)], "geheimnis": geheimnis, "createdAt": jetzt}
    db.collection(SAMMLUNG).document(webhook_id).set(eintrag)
    bescheid()
    return oeffentlich(webhook_id, eintrag), geheimnis


def eigener(db, shop_id: str, webhook_id: str) -> dict:
    snap = db.collection(SAMMLUNG).document(webhook_id).get()
    w = (snap.to_dict() or {}) if snap.exists else {}
    if w.get("shopId") != shop_id:
        raise WebhookFehler(404, "webhook_unbekannt", "Diesen Webhook gibt es hier nicht.")
    return w


def loeschen(db, shop_id: str, webhook_id: str) -> None:
    eigener(db, shop_id, webhook_id)
    db.collection(SAMMLUNG).document(webhook_id).delete()
    bescheid()


def fuer_schluessel_loeschen(db, schluessel_id: str) -> int:
    """Beim Widerrufen eines Schlüssels: seine Webhooks gehen mit"""
    weg = [d.id for d in db.collection(SAMMLUNG).where("schluesselId", "==", schluessel_id).stream()]
    for webhook_id in weg:
        db.collection(SAMMLUNG).document(webhook_id).delete()
    if weg:
        bescheid()
    return len(weg)


# --- Ereignisse aus Terminänderungen ----------------------------------------------------------------------------------

def projektion(appt: dict) -> dict:
    return {k: _utc(appt.get(k)) for k in RELEVANT}


def ereignis(stand: Optional[dict], appt: dict, seit: datetime) -> Optional[str]:
    """Was die Änderung von stand (zuletzt gemeldet, None: noch nie) zu appt ist – None: nichts zu melden"""
    neu = projektion(appt)
    if stand is None:
        angelegt = appt.get("createdAt")
        return "termin.angelegt" if isinstance(angelegt, datetime) and aware(angelegt) >= seit else None
    if stand == neu:
        return None
    if neu["status"] == "cancelled" and stand.get("status") != "cancelled":
        return "termin.abgesagt"
    zeit_oder_person = any(stand.get(k) != neu[k] for k in ("startTime", "endTime", "staffId"))
    if zeit_oder_person and neu["status"] != "cancelled":
        return "termin.verschoben"
    return "termin.geaendert"


def _nutzlast(db, shop_id: str, termin_id: str, appt: dict, typ: str, stand: Optional[dict], jetzt: datetime, cache: dict) -> dict:
    from app import schnittstelle as api

    body = {"id": "evt_" + secrets.token_hex(12), "typ": typ, "zeit": _iso(jetzt), "laden_id": shop_id,
            "termin": api.termin_fuer_ereignis(db, shop_id, termin_id, appt, cache)}
    if stand is not None:
        def zeit(text):
            return _iso(datetime.fromisoformat(text)) if isinstance(text, str) else None

        body["vorher"] = {"start": zeit(stand.get("startTime")), "ende": zeit(stand.get("endTime")),
                          "person_id": stand.get("staffId"), "status": api.STATUS.get(stand.get("status"), stand.get("status"))}
    return body


def verarbeiten(db, termine: List[Tuple[str, dict]], jetzt: datetime) -> int:
    """Geänderte Termine mit dem gemeldeten Stand vergleichen und Zustellungen anlegen. Gibt deren Zahl zurück."""
    haken: Dict[str, List[Tuple[str, dict]]] = {}
    for webhook_id, w in alle(db):
        haken.setdefault(w.get("shopId"), []).append((webhook_id, w))
    if not haken:
        return 0
    angelegt, cache = 0, {}
    for termin_id, appt in termine:
        shop_id = appt.get("shopId")
        liste = haken.get(shop_id)
        if not liste:
            continue
        ref = db.collection(STAND).document(termin_id)
        snap = ref.get()
        stand = (snap.to_dict() or {}).get("projektion") if snap.exists else None
        neu = projektion(appt)
        if stand == neu:
            continue
        seit = min((aware(w["createdAt"]) for _, w in liste if isinstance(w.get("createdAt"), datetime)), default=jetzt)
        typ = ereignis(stand, appt, seit)
        ref.set({"shopId": shop_id, "startTime": appt.get("startTime"), "projektion": neu, "updatedAt": jetzt})
        if typ is None:
            continue
        nutzlast = _nutzlast(db, shop_id, termin_id, appt, typ, stand, jetzt, cache)
        body = json.dumps(nutzlast, ensure_ascii=False, separators=(",", ":"))
        for webhook_id, w in liste:
            if typ in (w.get("ereignisse") or EREIGNISSE):
                db.collection(ZUSTELLUNGEN).document().set({
                    "webhookId": webhook_id, "shopId": shop_id, "terminId": termin_id, "ereignisId": nutzlast["id"],
                    "typ": typ, "body": body, "status": "offen", "versuche": 0, "naechsterVersuch": jetzt, "createdAt": jetzt})
                angelegt += 1
    return angelegt


# --- Senden -----------------------------------------------------------------------------------------------------------

def signatur(geheimnis: str, zeitstempel: int, body: str) -> str:
    return hmac.new(geheimnis.encode(), f"{zeitstempel}.{body}".encode(), hashlib.sha256).hexdigest()


def _kopf(w: dict, typ: str, zustellung_id: str, body: str, jetzt: datetime) -> dict:
    t = int(jetzt.timestamp())
    return {"Content-Type": "application/json", "User-Agent": "Dranzeit-Webhooks/1.0", "Dranzeit-Ereignis": typ,
            "Dranzeit-Zustellung": zustellung_id, "Dranzeit-Signatur": f"t={t},v1={signatur(w.get('geheimnis', ''), t, body)}"}


def senden(url: str, kopf: dict, body: str) -> Tuple[Optional[int], Optional[str]]:
    """(HTTP-Status, Grund bei Fehler). Prüft die Adresse vor jedem Senden noch einmal (DNS kann sich ändern)."""
    try:
        url_pruefen(url)
    except WebhookFehler as e:
        return None, e.meldung
    import requests

    try:
        antwort = requests.post(url, data=body.encode("utf-8"), headers=kopf, timeout=ZEITLIMIT, allow_redirects=False)
    except requests.RequestException as e:
        return None, type(e).__name__
    status = antwort.status_code
    return status, None if 200 <= status < 300 else f"HTTP {status}"


SENDEN: Callable = senden  # in Tests ersetzbar


def zustellen(db, jetzt: datetime, senden: Optional[Callable] = None) -> int:
    """Fällige Zustellungen schicken. Gibt die Zahl der erfolgreichen zurück."""
    schicke = senden or SENDEN
    offen = [(d.id, d.to_dict() or {}) for d in db.collection(ZUSTELLUNGEN).where("status", "==", "offen").stream()]
    faellig = sorted(((i, z) for i, z in offen if isinstance(z.get("naechsterVersuch"), datetime) and aware(z["naechsterVersuch"]) <= jetzt),
                     key=lambda e: _utc(e[1].get("createdAt")) or "")
    webhooks, laeden, erfolgreich = {}, {}, 0
    for zustellung_id, z in faellig:
        ref = db.collection(ZUSTELLUNGEN).document(zustellung_id)
        if z["webhookId"] not in webhooks:
            snap = db.collection(SAMMLUNG).document(z["webhookId"]).get()
            webhooks[z["webhookId"]] = (snap.to_dict() or {}) if snap.exists else None
        w = webhooks[z["webhookId"]]
        if not w or w.get("shopId") != z.get("shopId"):
            ref.update({"status": "verworfen", "letzterFehler": "Webhook gelöscht"})
            continue
        if z["shopId"] not in laeden:
            snap = db.collection("shops").document(z["shopId"]).get()
            laeden[z["shopId"]] = (snap.to_dict() or {}) if snap.exists else None
        shop = laeden[z["shopId"]]
        if not shop or is_suspended(shop) or not has_feature(shop, "api"):
            ref.update({"status": "verworfen", "letzterFehler": "Laden ohne Tarif für die Schnittstelle oder gesperrt"})
            continue
        status, grund = schicke(w["url"], _kopf(w, z["typ"], zustellung_id, z["body"], jetzt), z["body"])
        versuche = int(z.get("versuche") or 0) + 1
        aenderung = {"versuche": versuche, "letzterStatus": status, "letzterFehler": grund, "letzterVersuch": jetzt}
        if status is not None and 200 <= status < 300:
            aenderung.update(status="zugestellt", zugestelltAm=jetzt)
            erfolgreich += 1
        elif versuche > len(WIEDERHOLEN_MINUTEN):
            aenderung["status"] = "fehlgeschlagen"
        else:
            aenderung["naechsterVersuch"] = jetzt + timedelta(minutes=WIEDERHOLEN_MINUTEN[versuche - 1])
        ref.update(aenderung)
    return erfolgreich


def testen(db, shop_id: str, webhook_id: str, jetzt: datetime) -> dict:
    """Ein ping sofort, ohne Wiederholung – zum Ausprobieren der eigenen Gegenstelle"""
    w = eigener(db, shop_id, webhook_id)
    body = json.dumps({"id": "evt_" + secrets.token_hex(12), "typ": "ping", "zeit": _iso(jetzt), "laden_id": shop_id},
                      ensure_ascii=False, separators=(",", ":"))
    status, grund = SENDEN(w["url"], _kopf(w, "ping", "ping_" + secrets.token_hex(6), body, jetzt), body)
    return {"ok": status is not None and 200 <= status < 300, "status": status, "fehler": grund}


def zustellungen(db, shop_id: str, webhook_id: str, anzahl: int = 50) -> List[dict]:
    eigener(db, shop_id, webhook_id)
    liste = [(d.id, d.to_dict() or {}) for d in db.collection(ZUSTELLUNGEN).where("webhookId", "==", webhook_id).stream()]
    liste.sort(key=lambda e: _utc(e[1].get("createdAt")) or "", reverse=True)
    return [{"id": i, "ereignis_id": z.get("ereignisId"), "typ": z.get("typ"), "termin_id": z.get("terminId"),
             "status": z.get("status"), "versuche": int(z.get("versuche") or 0), "letzter_status": z.get("letzterStatus"),
             "letzter_fehler": z.get("letzterFehler"), "angelegt": _iso(z.get("createdAt")),
             "naechster_versuch": _iso(z.get("naechsterVersuch")) if z.get("status") == "offen" else None,
             "zugestellt": _iso(z.get("zugestelltAm"))}
            for i, z in liste[:anzahl]]


def aufraeumen(db, jetzt: datetime) -> int:
    """Erledigte Zustellungen nach AUFHEBEN_TAGEN, Stände vergangener Termine nach STAND_TAGEN löschen"""
    grenze, stand_grenze, weg = jetzt - timedelta(days=AUFHEBEN_TAGE), jetzt - timedelta(days=STAND_TAGE), 0
    for d in db.collection(ZUSTELLUNGEN).stream():
        z = d.to_dict() or {}
        if z.get("status") != "offen" and isinstance(z.get("createdAt"), datetime) and aware(z["createdAt"]) < grenze:
            db.collection(ZUSTELLUNGEN).document(d.id).delete()
            weg += 1
    for d in db.collection(STAND).stream():
        start = (d.to_dict() or {}).get("startTime")
        if not isinstance(start, datetime) or aware(start) < stand_grenze:
            db.collection(STAND).document(d.id).delete()
            weg += 1
    return weg


# --- Im Hintergrund ---------------------------------------------------------------------------------------------------

_neu = threading.Event()       # Webhooks geändert oder Termine gemeldet: Beobachter wach machen
_wecker = threading.Event()    # neue Zustellungen: Zusteller wach machen
_lock = threading.Lock()
_gemeldet: Dict[str, dict] = {}
_gestartet = False


def bescheid() -> None:
    _neu.set()


def _bei_aenderung(_docs, aenderungen, _lesezeit) -> None:
    with _lock:
        for a in aenderungen:
            if getattr(a.type, "name", str(a.type)) != "REMOVED":
                _gemeldet[a.document.id] = a.document.to_dict() or {}
    _neu.set()


def _beobachten() -> None:
    """Listener auf die Termine der Läden mit Webhook, ab gestern; neu bei geänderten Läden und um Mitternacht"""
    from app import store

    db, watch, schluessel = store.db(), None, None
    while True:
        arbeit = {}
        try:
            laeden = tuple(sorted({w.get("shopId") for _, w in alle(db) if w.get("shopId")}))
            tag = datetime.now(BERLIN).date()
            if (laeden, tag) != schluessel:
                if watch is not None:
                    watch.unsubscribe()
                    watch = None
                if laeden:
                    seit = datetime.combine(tag - timedelta(days=1), time(), tzinfo=BERLIN).astimezone(timezone.utc)
                    abfrage = db.collection("appointments").where("shopId", "in", list(laeden)).where("startTime", ">=", seit)
                    watch = abfrage.on_snapshot(_bei_aenderung)
                schluessel = (laeden, tag)
            with _lock:
                arbeit = dict(_gemeldet)
                _gemeldet.clear()
            if arbeit and verarbeiten(db, list(arbeit.items()), datetime.now(timezone.utc)):
                _wecker.set()
        except Exception as e:  # nie aufhören; was fehlt, holt der Vergleich mit dem Stand beim nächsten Mal nach
            print(f"Webhooks: Termine nicht verarbeitet: {e}")
            with _lock:
                for termin_id, appt in arbeit.items():
                    _gemeldet.setdefault(termin_id, appt)
            uhr.sleep(5)
        _neu.wait(60)
        _neu.clear()


def _zustellen_schleife() -> None:
    from app import store

    db, aufgeraeumt = store.db(), 0.0
    while True:
        _wecker.wait(30)
        _wecker.clear()
        try:
            jetzt = datetime.now(timezone.utc)
            zustellen(db, jetzt)
            if uhr.monotonic() - aufgeraeumt > 3600:
                aufraeumen(db, jetzt)
                aufgeraeumt = uhr.monotonic()
        except Exception as e:
            print(f"Webhooks: Zustellung unterbrochen: {e}")


def start_webhooks() -> bool:
    global _gestartet
    if _gestartet:
        return False
    _gestartet = True
    threading.Thread(target=_beobachten, name="webhooks-beobachten", daemon=True).start()
    threading.Thread(target=_zustellen_schleife, name="webhooks-zustellen", daemon=True).start()
    return True
