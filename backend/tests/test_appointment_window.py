"""
Tests für app/libs/appointment_window.py: Der Benachrichtigungsdienst nimmt die heutigen Termine vom Listener,
statt sie alle 30 Sekunden neu zu lesen – aber nie einen Stand, der die eigenen Merker noch nicht kennt.
Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_appointment_window.py
"""
import operator
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.libs.appointment_window as aw  # noqa: E402
from app.libs import notify_worker  # noqa: E402

START = datetime(2026, 10, 19, 0, 0, tzinfo=notify_worker.BERLIN)


class FakeSnap:
    def __init__(self, doc_id, data):
        self.id, self._data = doc_id, data

    def to_dict(self):
        return dict(self._data)


class FakeWatch:
    def __init__(self, callback):
        self.callback, self._closed = callback, False

    def unsubscribe(self):
        self._closed = True

    def push(self, docs: dict, read_time: datetime | None = None):
        self.callback([FakeSnap(k, v) for k, v in docs.items()], [], read_time or datetime.now(timezone.utc))


OPS = {"==": operator.eq, ">=": operator.ge, "<": operator.lt, "in": lambda a, b: a in b}


class FakeQuery:
    def __init__(self, db, coll, filters=()):
        self.db, self.coll, self.filters = db, coll, list(filters)

    def where(self, field, op, value):
        return FakeQuery(self.db, self.coll, self.filters + [(field, op, value)])

    def on_snapshot(self, callback):
        self.db.watches.append((self.filters, FakeWatch(callback)))
        return self.db.watches[-1][1]

    def stream(self):
        if self.coll == "appointments" and any(f == "startTime" for f, _, _ in self.filters):
            self.db.queries += 1  # die heutigen Termine gelesen
        for doc_id, data in list(self.db.store.setdefault(self.coll, {}).items()):
            if all(data.get(f) is not None and OPS[op](data[f], v) for f, op, v in self.filters):
                yield FakeSnap(doc_id, data)

    def document(self, doc_id):
        db, coll = self.db, self.coll

        class Ref:
            def update(self, fields):
                db.store[coll][doc_id].update(fields)

        return Ref()


class FakeDb:
    def __init__(self, appointments=None):
        self.store = {"appointments": appointments or {}}
        self.appointments = self.store["appointments"]
        self.watches, self.queries = [], 0

    def collection(self, name):
        return FakeQuery(self, name)


def appt(hhmm: str, day: datetime = START, **extra) -> dict:
    h, m = map(int, hhmm.split(":"))
    return {"shopId": "laden", "staffId": "robin", "status": "scheduled", "startTime": day.replace(hour=h, minute=m).astimezone(timezone.utc), **extra}


def test_ohne_listener_liest_der_aufrufer_selbst():
    window = aw.AppointmentWindow(timedelta(hours=28))
    assert window.between(START, START + timedelta(days=1)) is None


def test_listener_liefert_den_tag_und_kopien():
    db = FakeDb()
    window = aw.AppointmentWindow(timedelta(hours=28))
    window.enable(db)
    aw.CATCH_UP_SECONDS = 0.05
    assert window.between(START, START + timedelta(days=1)) is None  # startet den Listener
    filters, watch = db.watches[-1]
    assert [(f, op) for f, op, _ in filters] == [("startTime", ">="), ("startTime", "<")]
    assert window.between(START, START + timedelta(days=1)) is None  # noch kein Stand
    watch.push({"a": appt("10:00"), "b": appt("02:00", START + timedelta(days=1)), "c": appt("06:00", START + timedelta(days=1))})
    today = window.between(START, START + timedelta(days=1))
    assert [a["id"] for a in today] == ["a"], today
    tomorrow_early = window.between(START + timedelta(days=1), START + timedelta(days=1, hours=4))
    assert [a["id"] for a in tomorrow_early] == ["b"], tomorrow_early
    today[0]["status"] = "verändert"
    assert window.between(START, START + timedelta(days=1))[0]["status"] == "scheduled"


def test_eigener_merker_erst_wenn_der_listener_ihn_kennt():
    db = FakeDb()
    window = aw.AppointmentWindow(timedelta(hours=28))
    window.enable(db)
    aw.CATCH_UP_SECONDS = 0.05
    window.between(START, START + timedelta(days=1))
    _, watch = db.watches[-1]
    watch.push({"a": appt("10:00")}, read_time=datetime.now(timezone.utc) - timedelta(seconds=1))
    window.wrote()
    assert window.between(START, START + timedelta(days=1)) is None  # alter Stand: selbst lesen
    watch.push({"a": appt("10:00", notifiedSoonAt=1)})
    assert window.between(START, START + timedelta(days=1))[0]["notifiedSoonAt"] == 1


def test_neuer_tag_neuer_listener_und_abgebrochener_wird_ersetzt():
    db = FakeDb()
    window = aw.AppointmentWindow(timedelta(hours=28))
    window.enable(db)
    window.between(START, START + timedelta(days=1))
    _, first = db.watches[-1]
    first.push({"a": appt("10:00")})
    next_day = START + timedelta(days=1)
    assert window.between(next_day, next_day + timedelta(days=1)) is None
    assert first._closed and len(db.watches) == 2
    # Nachzügler des alten Listeners überschreibt den neuen Stand nicht
    first.push({"alt": appt("10:00")})
    _, second = db.watches[-1]
    second.push({"neu": appt("11:00", next_day)})
    assert [a["id"] for a in window.between(next_day, next_day + timedelta(days=1))] == ["neu"]
    # Abgebrochen: neu verbinden, aber nicht bei jedem Durchlauf
    second._closed = True
    aw.RESTART_SECONDS = 3600
    window._last_attempt = float("-inf")
    assert window.between(next_day, next_day + timedelta(days=1)) is None
    assert len(db.watches) == 3
    db.watches[-1][1]._closed = True
    window.between(next_day, next_day + timedelta(days=1))
    assert len(db.watches) == 3


def test_benachrichtigungsdienst_liest_nicht_mehr_bei_jedem_durchlauf():
    db = FakeDb({"a": appt("08:00", status="completed")})
    notify_worker.push_configured = lambda: True
    notify_worker.mail_configured = lambda: False
    notify_worker._window = aw.AppointmentWindow(timedelta(hours=28))
    now = START.replace(hour=9).astimezone(timezone.utc)
    notify_worker.run_once(db, now=now)  # ohne Listener: liest selbst
    assert db.queries == 1
    notify_worker._window.enable(db)
    notify_worker.run_once(db, now=now)  # startet den Listener, liest noch selbst
    assert db.queries == 2
    db.watches[-1][1].push(dict(db.appointments))
    for _ in range(5):
        notify_worker.run_once(db, now=now)
    assert db.queries == 2, db.queries


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
