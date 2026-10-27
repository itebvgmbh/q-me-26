"""
Tests für app/libs/queue_notify.py: Wer bekommt wann "Gleich dran", "Du bist dran" oder eine Erinnerung?
Ohne Firebase lauffähig:

    cd backend && .venv/bin/python tests/test_queue_notify.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.i18n import ar, en, tr  # noqa: E402
from app.libs.queue_notify import (  # noqa: E402
    Planned,
    message_for,
    needs_reminder,
    notice_kind,
    plan_queue_notifications,
    project_lane,
    recalled_to_reset,
)

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


def test_ueberfaellige_nummer_bleibt_in_der_schlange():
    # Ende vorbei, nie aufgerufen: wartet weiter, bis der Tresen aufruft oder absagt (wie am Tresen).
    # Vorher fiel "alt" heraus und "b" bekam "Du bist als Nächstes dran", obwohl "alt" noch vor ihm stand.
    plan = plan_queue_notifications([appt("alt", -40, duration=20, notifiedSoonAt=NOW), appt("b", 30)], NOW)
    assert plan == []
    plan = plan_queue_notifications([appt("alt", -40, duration=20, notifiedSoonAt=NOW), appt("b", 5)], NOW)
    assert plan == [Planned("b", "soon", ahead=1)]


def test_verzug_verschiebt_gleich_dran():
    # Anna ist seit 09:40 dran (30 Min.), es ist 10:00 und sie braucht noch 10 Minuten.
    # b war für 10:05 geplant, c für 10:35 – bei Verzug kommt c erst gegen 10:40 dran.
    lane = [
        appt("dran", -20, status="in-progress", duration=30, notifiedCalledAt=NOW, lastCalledAt=NOW - timedelta(minutes=20)),
        appt("b", 5, duration=30, notifiedSoonAt=NOW),
        appt("c", 35, duration=30),
    ]
    projection = project_lane(lane, NOW)
    assert projection["b"][0] == NOW + timedelta(minutes=10)
    assert projection["c"][0] == NOW + timedelta(minutes=40)
    # c: 40 Minuten bis zum voraussichtlichen Beginn, einer vor ihm -> noch kein "gleich dran"
    assert plan_queue_notifications(lane, NOW) == []
    later = NOW + timedelta(minutes=31)  # Anna fertig um 10:10, b seit 10:10 dran -> c gegen 10:40
    lane = [
        appt("dran", -20, status="completed", duration=30, completedAt=NOW + timedelta(minutes=10)),
        appt("b", 5, status="in-progress", duration=30, notifiedCalledAt=later, lastCalledAt=NOW + timedelta(minutes=10)),
        appt("c", 35, duration=30),
    ]
    assert plan_queue_notifications(lane, later) == [Planned("c", "soon", ahead=0)]


def test_ohne_aufrufe_gelten_die_geplanten_zeiten():
    # Laden hakt nichts ab: kein Verzug ausrechnen, sonst schöben alte Einträge alle nach hinten
    lane = [appt("alt", -120, duration=30), appt("b", 20, duration=30)]
    assert project_lane(lane, NOW)["b"][0] == NOW + timedelta(minutes=20)


def test_nie_frueher_als_angekuendigt():
    lane = [appt("dran", -25, status="completed", duration=30, completedAt=NOW - timedelta(minutes=20)), appt("b", 30, duration=30)]
    assert project_lane(lane, NOW)["b"][0] == NOW + timedelta(minutes=30)


def test_zurueck_auf_wartet_meldet_den_naechsten_aufruf_wieder():
    zurueck = appt("a", -5, notifiedCalledAt=NOW - timedelta(minutes=3))
    assert recalled_to_reset([zurueck, appt("b", 10)]) == ["a"]
    assert recalled_to_reset([appt("dran", -5, status="in-progress", notifiedCalledAt=NOW)]) == []


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
    at = lambda h, m, day=19: datetime(2026, 10, day, h, m)  # noqa: E731
    assert message_for("cancelled", "Barber Ali", now=at(9, 0), start=at(14, 0), queue=True)[1] == "Barber Ali hat deine Nummer heute um 14:00 abgesagt."
    assert message_for("moved", "Barber Ali", now=at(9, 0), start=at(15, 30, 20), previous=at(14, 0), staff="Anna") == (
        "Neue Uhrzeit",
        "Barber Ali hat deinen Termin verschoben: jetzt morgen um 15:30 bei Anna (vorher heute um 14:00).",
    )
    assert message_for("offer", "Barber Ali", now=at(9, 0), start=at(10, 30), original=at(11, 15), hold_until=at(9, 15))[1] == (
        "Barber Ali: Heute um 10:30 ist ein Platz frei (statt 11:15). Bis 09:15 nur für dich – unter „Meine Termine“ annehmen."
    )


def test_mitteilung_nur_wenn_sinnvoll():
    today = NOW.replace(hour=0, minute=0)
    assert notice_kind(appt("a", 60, status="cancelled", customerNotice="cancelled"), NOW, today) == "cancelled"
    assert notice_kind(appt("a", -24 * 60, status="cancelled", customerNotice="cancelled"), NOW, today) is None  # gestern
    moved = appt("a", 60, customerNotice="moved")
    assert notice_kind({**moved, "customerNoticePreviousStart": moved["startTime"] - timedelta(hours=1)}, NOW, today) == "moved"
    assert notice_kind({**moved, "customerNoticePreviousStart": moved["startTime"]}, NOW, today) is None  # zurückgeschoben
    assert notice_kind(appt("a", 60, customerNotice=None), NOW, today) is None


def test_nachrichten_auf_tuerkisch_und_arabisch():
    at = lambda h, m, day=19: datetime(2026, 10, day, h, m)  # noqa: E731
    title, body = message_for("called", "Barber Ali", sprache="tr")
    assert title == tr.TEXTE["Du bist dran"] and "Barber Ali" in body and body != "Barber Ali ruft dich auf. Komm jetzt rein."
    _, body = message_for("moved", "Barber Ali", sprache="tr", now=at(9, 0), start=at(15, 30, 22), previous=at(14, 0), staff="Anna")
    assert "15:30" in body and "Anna" in body and "14:00" in body and tr.TEXTE["Do"] in body  # 22.10.2026 ist ein Donnerstag
    _, body = message_for("offer", "", sprache="ar", now=at(9, 0), start=at(10, 30), hold_until=at(9, 15))
    assert ar.TEXTE["Dein Laden"] in body and "10:30" in body and "09:15" in body and "Platz" not in body
    # Ohne Sprache wie bisher
    assert message_for("called", "Barber Ali") == ("Du bist dran", "Barber Ali ruft dich auf. Komm jetzt rein.")


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


def test_durchlauf_absage_und_verschiebung_durch_den_laden():
    sent, mails = [], []
    notify_worker.push_configured = lambda: True
    notify_worker.mail_configured = lambda: True
    notify_worker.send_push = lambda sub, title, body, url, tag: sent.append((sub["endpoint"], title, body))
    notify_worker.send_mail = lambda to, subject, html_body, text_body: mails.append((to, subject))
    store = {
        "shops": {"laden": {"name": "Barber Ali", "trialEndsAt": NOW + timedelta(days=5)}},
        "staff": {"robin": {"name": "Robin"}},
        "users": {"kundin": {"email": "kundin@example.com"}},
        "appointments": {
            "weg": appt("weg", 120, status="cancelled", type="queue", customerNotice="cancelled"),
            "neu": appt("neu", 24 * 60 + 90, type="booked", customerId="kundin", customerNotice="moved",
                        customerNoticePreviousStart=NOW + timedelta(minutes=120)),
            "laufkunde": appt("laufkunde", 60, status="cancelled", customerId="walk-in", customerNotice="cancelled"),
        },
        "push_subscriptions": {"s1": {"appointmentId": "weg", "endpoint": "https://push/1", "p256dh": "k", "auth": "a"}},
    }
    result = notify_worker.run_once(FakeDb(store), now=NOW)
    # NOW ist 10:00 UTC = 12:00 deutscher Zeit
    assert ("https://push/1", "Abgesagt", "Barber Ali hat deine Nummer heute um 14:00 abgesagt.") in sent
    assert ("kundin@example.com", "Neue Uhrzeit") in mails
    assert result["mitteilungen"] == 2
    # Merker sind weg, auch beim Laufkunden ohne Kanal – nichts kommt doppelt
    assert all(a.get("customerNotice") is None for a in store["appointments"].values())
    sent.clear()
    mails.clear()
    notify_worker.run_once(FakeDb(store), now=NOW)
    assert sent == [] and mails == []


def test_durchlauf_frueher_dran_angebot_per_mail():
    mails = []
    notify_worker.push_configured = lambda: False
    notify_worker.mail_configured = lambda: True
    notify_worker.send_mail = lambda to, subject, html_body, text_body: mails.append((to, subject, text_body))
    store = {
        "shops": {"laden": {"name": "Barber Ali", "trialEndsAt": NOW + timedelta(days=5)}},
        "users": {"kundin": {"email": "kundin@example.com"}},
        "appointments": {"spaet": appt("spaet", 180, type="booked", customerId="kundin")},
        "earlier_slot_notifications": {
            "o1": {"appointmentId": "spaet", "shopId": "laden", "status": "offered", "isAccepted": False, "offerNotice": "pending",
                   "earlierStartTime": (NOW + timedelta(minutes=45)).astimezone(notify_worker.BERLIN).replace(tzinfo=None).isoformat(),
                   "expiresAt": NOW + timedelta(minutes=15)},
        },
    }
    result = notify_worker.run_once(FakeDb(store), now=NOW)
    assert result["angebote"] == 1
    assert mails[0][0] == "kundin@example.com" and mails[0][1] == "Früher dran?"
    assert "/my-bookings" in mails[0][2] and "Heute um 12:45 ist ein Platz frei (statt 15:00). Bis 12:15 nur für dich" in mails[0][2]
    assert store["earlier_slot_notifications"]["o1"]["offerNotice"] is None
    mails.clear()
    notify_worker.run_once(FakeDb(store), now=NOW)
    assert mails == []


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


def test_durchlauf_schickt_in_der_sprache_der_anmeldung_und_des_termins():
    sent, mails = [], []
    notify_worker.push_configured = lambda: True
    notify_worker.mail_configured = lambda: True
    notify_worker.send_push = lambda sub, title, body, url, tag: sent.append((sub["endpoint"], title))
    notify_worker.send_mail = lambda to, subject, html_body, text_body: mails.append((to, subject, html_body))
    store = {
        "shops": {"laden": {"name": "Barber Ali"}},
        "users": {"kundin": {"email": "kundin@example.com", "language": "en"}},
        "appointments": {
            "dran": {**appt("dran", -5, status="in-progress"), "language": "tr", "notifyEmail": "ali@example.com"},
            "konto": {**appt("konto", -5, staff="kim", status="in-progress"), "customerId": "kundin", "notifyEmail": "kundin@example.com"},
        },
        "push_subscriptions": {
            "s1": {"appointmentId": "dran", "endpoint": "https://push/1", "p256dh": "k", "auth": "a", "language": "ar"},
            "s2": {"appointmentId": "dran", "endpoint": "https://push/2", "p256dh": "k", "auth": "a"},
        },
    }
    notify_worker.run_once(FakeDb(store), now=NOW, extras=False)
    assert ("https://push/1", ar.TEXTE["Du bist dran"]) in sent  # Sprache der Anmeldung
    assert ("https://push/2", tr.TEXTE["Du bist dran"]) in sent  # alte Anmeldung ohne Sprache: die am Termin
    by_mail = {to: (subject, html) for to, subject, html in mails}
    assert by_mail["ali@example.com"][0] == tr.TEXTE["Du bist dran"] and tr.TEXTE["Nummer ansehen"] in by_mail["ali@example.com"][1]
    assert by_mail["kundin@example.com"][0] == en.TEXTE["Du bist dran"]  # Termin ohne Sprache: die des Kontos


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
