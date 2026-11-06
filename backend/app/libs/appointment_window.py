"""Termine eines Zeitraums im Speicher, aktuell gehalten von einem Firestore-Listener.

Der Benachrichtigungsdienst (app/libs/notify_worker.py) braucht alle 30 Sekunden die heutigen Termine aller
Läden. Neu gelesen kostete das bei 30 Terminen am Tag schon 86 400 Lesevorgänge am Tag – mehr als das
Gratis-Kontingent von Firestore (50 000). Ein Listener liest den Zeitraum einmal und danach nur, was sich
ändert. Beginnt ein neuer Tag, startet er für den neuen Zeitraum neu.

between() liefert None, solange der Listener nicht bereit ist, den Zeitraum nicht abdeckt oder eine eigene
Änderung (wrote()) noch nicht gesehen hat – dann liest der Aufrufer selbst. So kann ein Merker wie
notifiedSoonAt nicht veraltet sein und eine Nachricht doppelt auslösen.
"""

import threading
import time
from datetime import datetime, timedelta, timezone

# So lange wartet between() auf den Listener, wenn eine eigene Änderung noch nicht angekommen ist
CATCH_UP_SECONDS = 2.0
# Kommt zu einer eigenen Änderung gar kein neuer Stand (etwa weil sich nichts geändert hat), gilt sie danach als gesehen
WRITE_SETTLE_SECONDS = 10.0
# Neustart eines abgebrochenen Listeners höchstens so oft
RESTART_SECONDS = 60.0


def _utc(value) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    seconds = getattr(value, "seconds", None)
    if seconds is not None:
        return datetime.fromtimestamp(seconds + getattr(value, "nanos", 0) / 1e9, timezone.utc)
    return None


def _unsubscribe(watch) -> None:
    # Nie unter self._cond aufrufen: close() wartet auf den Listener-Thread, der vielleicht gerade _on_snapshot will
    if watch is not None:
        try:
            watch.unsubscribe()
        except Exception:
            pass


class AppointmentWindow:
    def __init__(self, length: timedelta):
        self.length = length
        self._cond = threading.Condition()
        self._db = None
        self._watch = None
        self._generation = 0
        self._start: datetime | None = None
        self._docs: dict[str, dict] | None = None  # None = noch kein Stand vom Listener
        self._read_time: datetime | None = None
        self._last_write: datetime | None = None
        self._last_attempt = float("-inf")

    def enable(self, db) -> None:
        """Ab jetzt mit Listener (nur im laufenden Dienst, nicht in Tests oder Einmal-Aufrufen)."""
        self._db = db

    def wrote(self) -> None:
        """Eigene Änderung an einem Termin im Zeitraum: erst wieder liefern, wenn der Listener sie gesehen hat."""
        with self._cond:
            self._last_write = datetime.now(timezone.utc)

    def between(self, start: datetime, end: datetime) -> list[dict] | None:
        """Kopien der Termine mit Beginn in [start, end), oder None, wenn der Aufrufer selbst lesen muss."""
        if self._db is None:
            return None
        with self._cond:
            covers = self._start is not None and self._start <= start and end <= self._start + self.length
            if covers and self._alive():
                if not self._cond.wait_for(self._caught_up, timeout=CATCH_UP_SECONDS):
                    return None
                return [
                    dict(data)
                    for data in self._docs.values()
                    if (begin := _utc(data.get("startTime"))) is not None and start <= begin < end
                ]
            # Neuer Tag: sofort neu starten; abgebrochener Listener: nicht bei jedem Durchlauf neu verbinden
            if covers and time.monotonic() - self._last_attempt < RESTART_SECONDS:
                return None
            self._last_attempt = time.monotonic()
            old_watch = self._watch
            self._generation += 1
            generation = self._generation
            self._watch, self._docs, self._read_time, self._start = None, None, None, start
        _unsubscribe(old_watch)
        query = self._db.collection("appointments").where("startTime", ">=", start).where("startTime", "<", start + self.length)
        try:
            watch = query.on_snapshot(lambda docs, changes, read_time: self._on_snapshot(generation, docs, read_time))
        except Exception as e:
            print(f"Termin-Listener nicht gestartet, lese selbst: {e}")
            return None
        with self._cond:
            if generation == self._generation:
                self._watch = watch
                watch = None
        _unsubscribe(watch)  # inzwischen überholt
        return None

    def stop(self) -> None:
        with self._cond:
            old_watch, self._watch, self._docs, self._db = self._watch, None, None, None
            self._generation += 1
        _unsubscribe(old_watch)

    def _alive(self) -> bool:
        return self._watch is not None and not getattr(self._watch, "_closed", False)

    def _caught_up(self) -> bool:
        if self._docs is None:
            return False
        if self._last_write is None or (self._read_time is not None and self._read_time >= self._last_write):
            return True
        return datetime.now(timezone.utc) - self._last_write > timedelta(seconds=WRITE_SETTLE_SECONDS)

    def _on_snapshot(self, generation: int, docs, read_time) -> None:
        # docs ist jeweils der vollständige Stand des Zeitraums
        snapshot = {}
        for doc in docs:
            data = doc.to_dict() or {}
            data["id"] = doc.id
            snapshot[doc.id] = data
        with self._cond:
            if generation != self._generation:
                return  # Nachzügler eines beendeten Listeners
            self._docs = snapshot
            self._read_time = _utc(read_time) or datetime.now(timezone.utc)
            self._cond.notify_all()
