"""Live-Ansichten ohne Firestore im Browser (requirements/eigene-datenbank.md, Stufe 2).

Nummernseite und Wartezimmer-Bildschirm holen ihre Daten über das Backend (app/apis/live), nicht direkt aus Firestore.
Damit sie sich trotzdem sofort aktualisieren, gibt es Kanäle:

- `termin:<Termin-ID>`: Die Kurzfassung dieses Termins hat sich geändert.
- `tag:<Laden>_<Tag>`: Ein Termin des Ladens an diesem Tag hat sich geändert (`shopDay`, Tag nach deutscher Zeit).
- `laden:<Laden>`: Irgendein Termin des Ladens hat sich geändert (Tresen, Kalender, Woche; app/apis/team_termine).

Schreibt das Backend selbst einen Termin (app/libs/team_termine.py), meldet es die Kanäle gleich danach selbst
(`termin_geaendert`). So kommen auch Änderungen an, die nur private Felder betreffen, etwa einen Namen.

Ein Listener auf `public_appointments` (von heute bis in `TAGE` Tagen) meldet jede Änderung an die betroffenen
Kanäle. Das gilt auch für Änderungen, die der Browser noch selbst schreibt, etwa am Tresen. Die Seiten hören per
Server-Sent Events zu (GET /routes/live/ereignisse) und laden danach über die normale Schnittstelle neu. Über den
Kanal gehen keine Daten, nur der Hinweis „hier hat sich etwas geändert“.

Was der Listener nicht sieht, holen die Seiten ohnehin jede Minute neu: Laden, Team und Termine nach `TAGE` Tagen.

Der Listener startet erst, wenn jemand zuhört. Ist eine Weile niemand mehr da, hört er wieder auf
(`RUHE_SEKUNDEN`). Um Mitternacht (deutsche Zeit) beginnt er neu, mit dem neuen Tag als Anfang.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone

from app import store
from app.libs.schedule import BERLIN

log = logging.getLogger(__name__)

PUBLIC = "public_appointments"
TAGE = 8
RUHE_SEKUNDEN = 300
PRUEF_SEKUNDEN = 60
# Je Zuhörer höchstens so viele Hinweise in der Warteschlange; mehr bringt nichts, die Seite lädt ohnehin alles neu
STAU = 8


# --- Werte für den Browser ---------------------------------------------------------------------------------------


def json_wert(wert):
    """Firestore-Werte als JSON. Zeitpunkte werden zu {"__zeit": "…Z"}, das Frontend macht daraus wieder einen
    Zeitpunkt mit toDate()/toMillis()/seconds (frontend/src/utils/live.ts)."""
    if isinstance(wert, datetime):
        if wert.tzinfo is None:
            wert = wert.replace(tzinfo=timezone.utc)
        return {"__zeit": wert.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")}
    if isinstance(wert, dict):
        return {str(k): json_wert(v) for k, v in wert.items()}
    if isinstance(wert, (list, tuple)):
        return [json_wert(v) for v in wert]
    if isinstance(wert, (str, int, float, bool)) or wert is None:
        return wert
    if hasattr(wert, "latitude") and hasattr(wert, "longitude"):  # GeoPoint
        return {"latitude": wert.latitude, "longitude": wert.longitude}
    if hasattr(wert, "path"):  # DocumentReference
        return wert.path
    return None


def aus_json(wert):
    """Gegenstück zu json_wert für Anfragen aus dem Browser: {"__zeit": "…"} wird wieder zum datetime (UTC)"""
    if isinstance(wert, dict):
        if set(wert) == {"__zeit"} and isinstance(wert["__zeit"], str):
            text = wert["__zeit"].strip()
            try:
                zeit = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
            except ValueError:
                raise ValueError(f"Kein Zeitpunkt: {text!r}")
            return zeit if zeit.tzinfo else zeit.replace(tzinfo=timezone.utc)
        return {str(k): aus_json(v) for k, v in wert.items()}
    if isinstance(wert, list):
        return [aus_json(v) for v in wert]
    return wert


def kanaele_fuer(termin: dict | None, termin_id: str) -> set[str]:
    """Alle Kanäle, die eine Änderung an diesem Termin betrifft"""
    kanaele = {f"termin:{termin_id}"}
    if termin and termin.get("shopId"):
        kanaele.add(f"laden:{termin['shopId']}")
        start = termin.get("startTime")
        if isinstance(start, datetime):
            tag = (start if start.tzinfo else start.replace(tzinfo=timezone.utc)).astimezone(BERLIN).date().isoformat()
            kanaele.add(f"tag:{termin['shopId']}_{tag}")
    return kanaele


def termin_geaendert(termin_id: str, *staende: dict | None) -> None:
    """Nach einem Schreibschritt des Backends: alle betroffenen Kanäle melden (vorher und nachher, z. B. anderer Tag)"""
    kanaele = set()
    for stand in staende:
        kanaele |= kanaele_fuer(stand, termin_id)
    for kanal in kanaele:
        verteiler.melden(kanal)


def heute(jetzt: datetime | None = None) -> date:
    return (jetzt or datetime.now(timezone.utc)).astimezone(BERLIN).date()


def tagesbeginn(tag: date) -> datetime:
    """Mitternacht deutscher Zeit an diesem Tag, als Zeitpunkt in UTC"""
    return datetime(tag.year, tag.month, tag.day, tzinfo=BERLIN).astimezone(timezone.utc)


# --- Zuhörer und Kanäle ------------------------------------------------------------------------------------------


class Zuhoerer:
    """Eine offene Seite: ihre Kanäle und eine Warteschlange in ihrer Ereignisschleife"""

    def __init__(self, kanaele: list[str], schleife: asyncio.AbstractEventLoop):
        self.kanaele = list(dict.fromkeys(kanaele))
        self.schleife = schleife
        self.schlange: asyncio.Queue[str] = asyncio.Queue(maxsize=STAU)

    def _anstossen(self, kanal: str) -> None:
        # Läuft in der Ereignisschleife; volle Schlange: es steht schon ein Hinweis an, die Seite lädt ohnehin neu
        try:
            self.schlange.put_nowait(kanal)
        except asyncio.QueueFull:
            pass

    def anstossen(self, kanal: str) -> None:
        """Aus jedem Thread aufrufbar (der Firestore-Listener ruft aus seinem eigenen)"""
        try:
            self.schleife.call_soon_threadsafe(self._anstossen, kanal)
        except RuntimeError:  # Schleife schon zu
            pass


class Verteiler:
    """Kanäle → Zuhörer. Der Wächter (Firestore-Listener) meldet hier, die Ereignis-Endpunkte hören hier zu."""

    def __init__(self, waechter_bauen=None):
        self._lock = threading.Lock()
        self._kanaele: dict[str, set[Zuhoerer]] = {}
        self._waechter_bauen = waechter_bauen if waechter_bauen is not None else lambda verteiler: Waechter(verteiler)
        self._waechter: Waechter | None = None

    def anmelden(self, kanaele: list[str], schleife: asyncio.AbstractEventLoop) -> Zuhoerer:
        zuhoerer = Zuhoerer(kanaele, schleife)
        with self._lock:
            for kanal in zuhoerer.kanaele:
                self._kanaele.setdefault(kanal, set()).add(zuhoerer)
            if self._waechter is None:
                self._waechter = self._waechter_bauen(self)
        try:
            self._waechter.sicherstellen()
        except Exception:  # ohne Firestore (Tests, Ausfall): Seiten laden trotzdem jede Minute neu
            log.exception("Live: Listener nicht gestartet")
        return zuhoerer

    def abmelden(self, zuhoerer: Zuhoerer) -> None:
        with self._lock:
            for kanal in zuhoerer.kanaele:
                menge = self._kanaele.get(kanal)
                if menge is not None:
                    menge.discard(zuhoerer)
                    if not menge:
                        del self._kanaele[kanal]

    def melden(self, kanal: str) -> int:
        """Allen Zuhörern des Kanals Bescheid geben; gibt zurück, wie vielen"""
        with self._lock:
            zuhoerer = list(self._kanaele.get(kanal, ()))
        for z in zuhoerer:
            z.anstossen(kanal)
        return len(zuhoerer)

    def anzahl(self) -> int:
        with self._lock:
            return len({z for menge in self._kanaele.values() for z in menge})


# --- Wächter: ein Firestore-Listener für alle --------------------------------------------------------------------


class Waechter:
    """Hört auf public_appointments von heute bis in TAGE Tagen und meldet Änderungen an den Verteiler."""

    def __init__(self, verteiler: Verteiler, db=None, uhr=time.monotonic):
        self._verteiler = verteiler
        self._db = db
        self._uhr = uhr
        self._lock = threading.Lock()
        self._watch = None
        self._tag: date | None = None
        self._tage: dict[str, str | None] = {}  # Termin-ID → zuletzt gesehener shopDay
        self._still_seit: float | None = None
        self._pruefer: threading.Thread | None = None

    def sicherstellen(self) -> None:
        with self._lock:
            self._still_seit = None
            if self._watch is None:
                self._starten()
            if self._pruefer is None or not self._pruefer.is_alive():
                self._pruefer = threading.Thread(target=self._pruefen_schleife, name="live-waechter", daemon=True)
                self._pruefer.start()

    def _starten(self) -> None:
        db = self._db or store.db()
        tag = heute()
        anfang = tagesbeginn(tag)
        abfrage = (
            db.collection(PUBLIC)
            .where(filter=store.FieldFilter("startTime", ">=", anfang))
            .where(filter=store.FieldFilter("startTime", "<", anfang + timedelta(days=TAGE)))
        )
        self._tage = {}
        self._tag = tag
        self._watch = abfrage.on_snapshot(self.bei_aenderung)
        log.info("Live: Listener ab %s für %d Tage", tag.isoformat(), TAGE)

    def _stoppen(self) -> None:
        watch, self._watch = self._watch, None
        if watch is not None:
            try:
                watch.unsubscribe()
            except Exception:
                log.exception("Live: Listener nicht sauber beendet")

    def bei_aenderung(self, docs, changes, read_time) -> None:
        """Firestore ruft das aus seinem eigenen Thread; zuerst mit allen Treffern, danach mit jeder Änderung."""
        try:
            for change in changes:
                snap = change.document
                daten = snap.to_dict() or {}
                neu = daten.get("shopDay")
                alt = self._tage.get(snap.id)
                if getattr(change.type, "name", "") == "REMOVED":
                    self._tage.pop(snap.id, None)
                else:
                    self._tage[snap.id] = neu
                self._verteiler.melden(f"termin:{snap.id}")
                for tag in {neu, alt} - {None, ""}:
                    self._verteiler.melden(f"tag:{tag}")
                if daten.get("shopId"):
                    self._verteiler.melden(f"laden:{daten['shopId']}")
        except Exception:  # nie den Listener-Thread sterben lassen
            log.exception("Live: Änderung nicht verteilt")

    def pruefen(self) -> None:
        """Einmal je Minute: neuer Tag → neu anfangen; lange niemand da → aufhören"""
        with self._lock:
            if self._watch is None:
                return
            if self._verteiler.anzahl() == 0:
                if self._still_seit is None:
                    self._still_seit = self._uhr()
                elif self._uhr() - self._still_seit >= RUHE_SEKUNDEN:
                    self._stoppen()
                    log.info("Live: niemand hört zu, Listener beendet")
                    return
            else:
                self._still_seit = None
            if heute() != self._tag:
                self._stoppen()
                self._starten()

    def _pruefen_schleife(self) -> None:
        while True:
            time.sleep(PRUEF_SEKUNDEN)
            try:
                self.pruefen()
            except Exception:
                log.exception("Live: Prüfung fehlgeschlagen")
            with self._lock:
                if self._watch is None:
                    self._pruefer = None
                    return


verteiler = Verteiler()
