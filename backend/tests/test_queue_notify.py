"""
Tests für app/libs/queue_notify.py: Wer bekommt wann "Gleich dran", "Du bist dran" oder eine Erinnerung?
Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_queue_notify.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.libs.queue_notify import Planned, message_for, needs_reminder, plan_queue_notifications  # noqa: E402

NOW = datetime(2026, 10, 19, 10, 0, tzinfo=timezone.utc)


def appt(id, start_min, status="scheduled", staff="robin", duration=20, **extra):
    start = NOW + timedelta(minutes=start_min)
    return {"id": id, "shopId": "laden", "staffId": staff, "status": status, "startTime": start,
            "endTime": start + timedelta(minutes=duration), **extra}


def test_aufgerufen_bekommt_du_bist_dran():
    assert plan_queue_notifications([appt("a", -5, status="in-progress")], NOW) == [Planned("a", "called")]


def test_aufgerufen_nur_einmal():
    assert plan_queue_notifications([appt("a", -5, status="in-progress", notifiedCalledAt=NOW)], NOW) == []


def test_naechster_in_der_schlange_bekommt_gleich_dran():
    plan = plan_queue_notifications([appt("a", -5, status="in-progress", notifiedCalledAt=NOW), appt("b", 15), appt("c", 35)], NOW)
    assert Planned("b", "soon", ahead=0) in plan
    assert all(p.appointment_id != "c" for p in plan)


def test_startzeit_nah_bekommt_gleich_dran_auch_mit_wartenden_davor():
    plan = plan_queue_notifications([appt("b", 2), appt("c", 8)], NOW)
    assert Planned("c", "soon", ahead=1) in plan


def test_termin_am_nachmittag_ist_morgens_nicht_gleich():
    assert plan_queue_notifications([appt("spaet", 300)], NOW) == []


def test_andere_person_ist_eigene_schlange():
    plan = plan_queue_notifications([appt("b", 20, staff="robin"), appt("x", 20, staff="kim")], NOW)
    assert {p.appointment_id for p in plan} == {"b", "x"}


def test_verpasste_nummer_zaehlt_nicht_mehr():
    # Ende vorbei, nie aufgerufen: fällt aus der Schlange wie am Tresen
    plan = plan_queue_notifications([appt("alt", -40, duration=20), appt("b", 30)], NOW)
    assert plan == [Planned("b", "soon", ahead=0)]


def test_erinnerung_zwei_stunden_vorher():
    a = {"type": "booked", "status": "scheduled", "startTime": NOW + timedelta(minutes=100), "createdAt": NOW - timedelta(days=2)}
    assert needs_reminder(a, NOW)


def test_keine_erinnerung_bei_kurzfristiger_buchung():
    a = {"type": "booked", "status": "scheduled", "startTime": NOW + timedelta(minutes=100), "createdAt": NOW - timedelta(minutes=30)}
    assert not needs_reminder(a, NOW)


def test_keine_erinnerung_fuer_wartenummer_oder_doppelt():
    base = {"status": "scheduled", "startTime": NOW + timedelta(minutes=60), "createdAt": NOW - timedelta(days=1)}
    assert not needs_reminder({**base, "type": "queue"}, NOW)
    assert not needs_reminder({**base, "type": "booked", "reminderSentAt": NOW}, NOW)


def test_texte():
    assert message_for("soon", "Barber Ali", ahead=2) == ("Gleich bist du dran", "Barber Ali: Nur noch 2 vor dir. Mach dich auf den Weg.")
    assert message_for("called", "")[1] == "Dein Laden ruft dich auf. Komm jetzt rein."


# --- Durchlauf mit nachgebauter Datenbank ---------------------------------------------------

import operator  # noqa: E402

from app.libs import notify_worker  # noqa: E402

OPS = {"==": operator.eq, ">=": operator.ge, "<": operator.lt, "in": lambda a, b: a in b}


class FakeDoc:
    def __init__(self, store, coll, doc_id):
        self.store, self.coll, self.id = store, coll, doc_id

    @property
    def reference(self):
        return self

    @property
    def exists(self):
        return self.id in self.store.setdefault(self.coll, {})

    def get(self):
        return self

    def to_dict(self):
        return dict(self.store[self.coll][self.id])

    def set(self, data):
        self.store.setdefault(self.coll, {})[self.id] = dict(data)

    def update(self, data):
        self.store[self.coll][self.id].update(data)

    def delete(self):
        self.store.setdefault(self.coll, {}).pop(self.id, None)


class FakeQuery:
    def __init__(self, store, coll, filters=()):
        self.store, self.coll, self.filters = store, coll, list(filters)

    def where(self, field, op, value):
        return FakeQuery(self.store, self.coll, self.filters + [(field, OPS[op], value)])

    def limit(self, _n):
        return self

    def stream(self):
        for doc_id, data in list(self.store.setdefault(self.coll, {}).items()):
            if all(data.get(f) is not None and fn(data.get(f), v) for f, fn, v in self.filters):
                yield FakeDoc(self.store, self.coll, doc_id)

    def document(self, doc_id):
        return FakeDoc(self.store, self.coll, doc_id)


class FakeDb:
    def __init__(self, store):
        self.store = store

    def collection(self, name):
        return FakeQuery(self.store, name)


def test_durchlauf_schickt_push_und_merkt_sich_das():
    sent = []
    notify_worker.push_configured = lambda: True
    notify_worker.mail_configured = lambda: False
    notify_worker.send_push = lambda sub, title, body, url, tag: sent.append((sub["endpoint"], title, url))
    store = {
        "shops": {"laden": {"name": "Barber Ali"}},
        "appointments": {
            "dran": appt("dran", -5, status="in-progress"),
            "naechste": appt("naechste", 15),
            "ohne_kanal": appt("ohne_kanal", 15, staff="kim"),
        },
        "push_subscriptions": {
            "s1": {"appointmentId": "dran", "endpoint": "https://push/1", "p256dh": "k", "auth": "a"},
            "s2": {"appointmentId": "naechste", "endpoint": "https://push/2", "p256dh": "k", "auth": "a"},
        },
    }
    result = notify_worker.run_once(FakeDb(store), now=NOW)
    assert ("https://push/1", "Du bist dran", "/nummer/dran") in sent
    assert ("https://push/2", "Gleich bist du dran", "/nummer/naechste") in sent
    assert store["appointments"]["dran"]["notifiedCalledAt"] == NOW
    assert store["appointments"]["naechste"]["notifiedSoonAt"] == NOW
    # Ohne Anmeldung nichts merken – wer sich später anmeldet, bekommt die Nachricht noch
    assert "notifiedSoonAt" not in store["appointments"]["ohne_kanal"]
    assert result["gesendet"] == 2
    # Zweiter Durchlauf schickt nichts doppelt
    sent.clear()
    notify_worker.run_once(FakeDb(store), now=NOW)
    assert sent == []


def test_abbestellte_anmeldung_wird_geloescht():
    def gone(*_a):
        raise notify_worker.SubscriptionGone()
    notify_worker.push_configured = lambda: True
    notify_worker.mail_configured = lambda: False
    notify_worker.send_push = gone
    store = {
        "shops": {},
        "appointments": {"dran": appt("dran", -5, status="in-progress")},
        "push_subscriptions": {"s1": {"appointmentId": "dran", "endpoint": "https://push/1", "p256dh": "k", "auth": "a"}},
    }
    notify_worker.run_once(FakeDb(store), now=NOW)
    assert store["push_subscriptions"] == {}


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
