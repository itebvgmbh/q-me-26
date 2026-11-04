"""
Öffentliche Live-Daten für Nummernseite und Wartezimmer-Bildschirm (requirements/eigene-datenbank.md, Stufe 2).
Ohne Anmeldung, wie bisher die öffentlichen Kurzfassungen in Firestore. Die Seiten lesen nicht mehr selbst aus
Firestore, sondern hier:

    GET /live/nummer/{termin_id}        Nummer mit Schlange bei derselben Person, Laden, Leistung, Person
    GET /live/bildschirm/{shop_id}?tag  Laden, aktive Personen, Termine des Tages (Standard: heute, deutsche Zeit)
    GET /live/ereignisse?kanal=…        Server-Sent Events: „aenderung“, sobald sich in einem Kanal etwas tut

Ausgegeben wird nur, was öffentlich ist: Termine nur als Kurzfassung (public_appointments, ohne Namen und Kontakte),
vom Laden nur Anzeige- und Tariffelder, von Personen und Leistungen nur der Name. Zeitpunkte kommen als
{"__zeit": "…Z"} (app/libs/live.py, frontend/src/utils/live.ts). Jede Antwort nennt ihre Kanäle; die Seite hört auf
sie und lädt bei „aenderung“ neu.
"""

import asyncio
import json
import re
import time
from datetime import date

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from app import seo, store
from app.libs import live

router = APIRouter()

ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
TAG = re.compile(r"^\d{4}-\d{2}-\d{2}$")
KANAL = re.compile(r"^(termin:[A-Za-z0-9_-]{1,64}|tag:[A-Za-z0-9_-]{1,64}_\d{4}-\d{2}-\d{2}|laden:[A-Za-z0-9_-]{1,64})$")
MAX_KANAELE = 4
# Nach so vielen Sekunden schließt das Backend die Verbindung; der Browser baut sie von selbst neu auf
VERBINDUNG_SEKUNDEN = 600
PING_SEKUNDEN = 20

# Was Nummernseite und Bildschirm vom Laden brauchen: Anzeige, Adresse (Kalendereintrag) und Tarif (utils/plans.ts)
LADEN_FELDER = ("name", "logoUrl", "street", "postalCode", "city", "address", "plan", "trialEndsAt", "founder", "grant", "createdAt")
ABO_FELDER = ("plan", "interval", "status", "cancelAtPeriodEnd", "currentPeriodEnd")


def _keine_ablage(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def laden_oeffentlich(shop_id: str, daten: dict) -> dict:
    laden = {"id": shop_id, **{k: daten[k] for k in LADEN_FELDER if k in daten}}
    if isinstance(daten.get("billing"), dict):
        laden["billing"] = {k: daten["billing"][k] for k in ABO_FELDER if k in daten["billing"]}
    if daten.get("suspended"):
        gesperrt = daten["suspended"]
        laden["suspended"] = {"at": gesperrt.get("at")} if isinstance(gesperrt, dict) else True
    return laden


def kurzfassung(snap) -> dict:
    return {"id": snap.id, **(snap.to_dict() or {})}


def _name(db, sammlung: str, doc_id) -> dict | None:
    """Name einer Leistung oder Person; eine Minute zwischengespeichert, viele Nummernseiten fragen dasselbe"""
    if not doc_id or not ID.match(str(doc_id)):
        return None

    def laden():
        snap = db.collection(sammlung).document(doc_id).get()
        name = (snap.to_dict() or {}).get("name") if snap.exists else None
        return {"name": name} if name else None

    return seo._cached(f"live:{sammlung}:{doc_id}", laden)


def _laden(db, shop_id, zwischenspeichern: bool) -> dict | None:
    if not shop_id or not ID.match(str(shop_id)):
        return None

    def laden():
        snap = db.collection("shops").document(shop_id).get()
        return laden_oeffentlich(shop_id, snap.to_dict() or {}) if snap.exists else None

    return seo._cached(f"live:shop:{shop_id}", laden) if zwischenspeichern else laden()


@router.get("/live/nummer/{termin_id}")
def nummer(termin_id: str, response: Response) -> dict:
    _keine_ablage(response)
    if not ID.match(termin_id):
        raise HTTPException(status_code=404, detail="Diese Nummer gibt es nicht.")
    db = store.db()
    snap = db.collection(live.PUBLIC).document(termin_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Diese Nummer gibt es nicht.")
    termin = kurzfassung(snap)
    spur = []
    if termin.get("staffDay"):
        abfrage = db.collection(live.PUBLIC).where(filter=store.FieldFilter("staffDay", "==", termin["staffDay"]))
        spur = [kurzfassung(d) for d in abfrage.stream()]
    kanaele = [f"termin:{termin_id}"] + ([f"tag:{termin['shopDay']}"] if termin.get("shopDay") else [])
    return live.json_wert({
        "termin": termin,
        "spur": spur,
        "laden": _laden(db, termin.get("shopId"), zwischenspeichern=True),
        "leistung": _name(db, "services", termin.get("serviceId")),
        "person": _name(db, "staff", termin.get("staffId")),
        "kanaele": kanaele,
    })


@router.get("/live/bildschirm/{shop_id}")
def bildschirm(shop_id: str, response: Response, tag: str | None = None) -> dict:
    _keine_ablage(response)
    if not ID.match(shop_id):
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht.")
    if tag is None:
        tag = live.heute().isoformat()
    elif not TAG.match(tag):
        raise HTTPException(status_code=400, detail="Tag als JJJJ-MM-TT")
    else:
        try:
            date.fromisoformat(tag)
        except ValueError:
            raise HTTPException(status_code=400, detail="Tag als JJJJ-MM-TT")
    db = store.db()
    laden = _laden(db, shop_id, zwischenspeichern=False)
    if laden is None:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht.")
    personen = []
    for d in db.collection("staff").where(filter=store.FieldFilter("shopId", "==", shop_id)).stream():
        p = d.to_dict() or {}
        if p.get("isActive") is not False:
            personen.append({"id": d.id, "name": p.get("name", "")})
    shop_day = f"{shop_id}_{tag}"
    termine = [kurzfassung(d) for d in db.collection(live.PUBLIC).where(filter=store.FieldFilter("shopDay", "==", shop_day)).stream()]
    return live.json_wert({"laden": laden, "personen": personen, "termine": termine, "tag": tag, "kanaele": [f"tag:{shop_day}"]})


def _ereignis(name: str, daten: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(daten)}\n\n"


@router.get("/live/ereignisse")
async def ereignisse(request: Request, kanal: list[str] = Query(default=[])) -> StreamingResponse:
    kanaele = list(dict.fromkeys(k for k in kanal if KANAL.match(k)))[:MAX_KANAELE]
    if not kanaele:
        raise HTTPException(status_code=400, detail="Kein gültiger Kanal")
    # anmelden startet beim ersten Zuhörer den Firestore-Listener; das blockiert kurz, also nicht in der Schleife
    zuhoerer = await asyncio.to_thread(live.verteiler.anmelden, kanaele, asyncio.get_running_loop())

    async def strom():
        try:
            # retry: so schnell baut der Browser nach einem Abbruch neu auf; bereit: die Seite lädt einmal nach,
            # falls zwischen ihrem Laden und dieser Verbindung etwas passiert ist
            yield f"retry: 3000\n\n{_ereignis('bereit', {'kanaele': kanaele})}"
            ende = time.monotonic() + VERBINDUNG_SEKUNDEN
            while time.monotonic() < ende:
                if await request.is_disconnected():
                    return
                try:
                    k = await asyncio.wait_for(zuhoerer.schlange.get(), timeout=PING_SEKUNDEN)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield _ereignis("aenderung", {"kanal": k})
        finally:
            live.verteiler.abmelden(zuhoerer)

    return StreamingResponse(
        strom(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


# --- Personen und Leistungen eines Ladens, öffentlich (Buchen, Nummer ziehen, Ladenseite; Stufe 2, Bereich 4) ---------
# Ohne Konto-ID, Einladung und Kontaktdaten (app/libs/team_laden.person_oeffentlich). Inhaber und Team lesen über
# /team/laden/{id}/personen (app/apis/team_laden).


@router.get("/live/laden/{shop_id}/personen")
def laden_personen(shop_id: str, response: Response) -> dict:
    from app.libs import team_laden as tl

    _keine_ablage(response)
    if not ID.match(shop_id):
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht.")
    personen = [tl.person_oeffentlich(pid, d) for pid, d in tl.personen_des_ladens(store.db(), shop_id)]
    return live.json_wert({"personen": personen})


@router.get("/live/laden/{shop_id}/leistungen")
def laden_leistungen(shop_id: str, response: Response) -> dict:
    from app.libs import team_laden as tl

    _keine_ablage(response)
    if not ID.match(shop_id):
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht.")
    return live.json_wert({"leistungen": tl.leistungen_des_ladens(store.db(), shop_id)})


@router.get("/live/leistung/{service_id}")
def eine_leistung(service_id: str, response: Response) -> dict:
    from app.libs import team_laden as tl

    _keine_ablage(response)
    gefunden = tl.leistung(store.db(), service_id) if ID.match(service_id) else None
    if gefunden is None:
        raise HTTPException(status_code=404, detail="Diese Leistung gibt es nicht mehr.")
    return live.json_wert({"leistung": gefunden})


@router.get("/live/person/{staff_id}/pausen")
def person_pausen(staff_id: str, response: Response) -> dict:
    """Einzelne und feste Pausen einer Person, öffentlich (freie Plätze; Stufe 2, Bereich 5, app/libs/pausen.py)"""
    from app.libs import pausen

    _keine_ablage(response)
    if not ID.match(staff_id):
        raise HTTPException(status_code=404, detail="Diese Person gibt es nicht mehr.")
    return live.json_wert(pausen.pausen_der_person(store.db(), staff_id))


# --- Läden, Personen, belegte Zeiten, Bilder: öffentlich (Läden finden, Buchen, Nummer ziehen; Stufe 2) -----------------


@router.get("/live/laeden")
def alle_laeden(response: Response) -> dict:
    """Alle Läden in der öffentlichen Fassung (Läden finden, Karte); ohne Inhaber und Startklar-Merker"""
    from app.libs import laeden as ld

    _keine_ablage(response)
    return live.json_wert({"laeden": ld.alle_laeden(store.db())})


@router.get("/live/laden/{shop_id}")
def ein_laden(shop_id: str, response: Response) -> dict:
    from app.libs import laeden as ld

    _keine_ablage(response)
    daten = ld.laden_roh(store.db(), shop_id) if ID.match(shop_id) else None
    if daten is None:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht.")
    return live.json_wert({"laden": ld.laden_oeffentlich(shop_id, daten)})


@router.get("/live/laden/{shop_id}/monat")
def laden_monat(shop_id: str, response: Response) -> dict:
    """Gratis-Tarif: Ist die Grenze an Kunden in diesem Monat erreicht? Dann gibt es online keine Nummern mehr
    (Nummer ziehen zeigt den Hinweis gleich; das Backend lehnt sonst beim Ziehen ab, app/libs/online_platz.py).
    Nur ja oder nein, keine Zahl."""
    from datetime import datetime

    from app.libs import laeden as ld
    from app.libs.online_platz import MonatVoll, monatsgrenze
    from app.libs.schedule import BERLIN

    _keine_ablage(response)
    db = store.db()
    daten = ld.laden_roh(db, shop_id) if ID.match(shop_id) else None
    if daten is None:
        raise HTTPException(status_code=404, detail="Diesen Laden gibt es nicht.")
    try:
        monatsgrenze(db, shop_id, daten, datetime.now(BERLIN))
    except MonatVoll:
        return {"voll": True}
    return {"voll": False}


@router.get("/live/person/{staff_id}")
def eine_person(staff_id: str, response: Response) -> dict:
    from app.libs import team_laden as tl

    _keine_ablage(response)
    snap = store.db().collection(tl.STAFF).document(staff_id).get() if ID.match(staff_id) else None
    if snap is None or not snap.exists:
        raise HTTPException(status_code=404, detail="Diese Person gibt es nicht mehr.")
    return live.json_wert({"person": tl.person_oeffentlich(staff_id, snap.to_dict() or {})})


@router.get("/live/person/{staff_id}/belegt")
def person_belegt(staff_id: str, von: str, bis: str, response: Response) -> dict:
    """Kurzfassungen der Termine einer Person an den Tagen in [von, bis) (freie Plätze, booking-rules.ts). Höchstens
    62 Tage; je 30 Tage eine Abfrage wie bisher im Browser (publicOfStaffBetween)."""
    from datetime import timedelta

    from app.libs.schedule import BERLIN

    _keine_ablage(response)
    if not ID.match(staff_id):
        raise HTTPException(status_code=404, detail="Diese Person gibt es nicht mehr.")
    try:
        anfang, ende = live.aus_json({"__zeit": von}), live.aus_json({"__zeit": bis})
    except ValueError:
        raise HTTPException(status_code=400, detail="Tag als JJJJ-MM-TT")
    if not (anfang < ende <= anfang + timedelta(days=62)):
        raise HTTPException(status_code=400, detail="Tag als JJJJ-MM-TT")
    tage, tag = [], anfang.astimezone(BERLIN).date()
    letzter = (ende - timedelta(microseconds=1)).astimezone(BERLIN).date()
    while tag <= letzter:
        tage.append(f"{staff_id}_{tag.isoformat()}")
        tag += timedelta(days=1)
    termine = []
    for i in range(0, len(tage), 30):
        abfrage = store.db().collection(live.PUBLIC).where(filter=store.FieldFilter("staffDay", "in", tage[i:i + 30]))
        termine.extend(kurzfassung(d) for d in abfrage.stream())
    return live.json_wert({"termine": termine})


@router.get("/live/dateien/{shop_id}/{name}")
def datei(shop_id: str, name: str):
    """Logos und Fotos (app/libs/laeden.bild_speichern); Name zufällig, daher ein Jahr zwischenspeicherbar"""
    from fastapi.responses import FileResponse

    from app.libs import laeden as ld

    pfad = ld.bild_pfad(shop_id, name) if ID.match(shop_id) else None
    if pfad is None:
        raise HTTPException(status_code=404, detail="Diese Datei gibt es nicht.")
    art = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}[name.rsplit(".", 1)[1]]
    return FileResponse(pfad, media_type=art, headers={"Cache-Control": "public, max-age=31536000, immutable"})
