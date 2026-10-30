"""
Tests für app/libs/queue_notify.py: Wer bekommt wann "Gleich dran", "Du bist dran" oder eine Erinnerung? Dazu die
Nachrichten an das Team (app/libs/team_notify.py) und der Durchlauf des Benachrichtigungsdienstes.
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



# --- Push an die App (iPhone/iPad, app/libs/fcm.py) ------------------------------------------------

from app.libs import fcm  # noqa: E402


def _nur_app_kanal(sent):
    """Server ohne VAPID-Schlüssel, aber mit Firebase: nur die App bekommt Push."""
    notify_worker.push_configured = lambda: False
    notify_worker.fcm_configured = lambda: True
    notify_worker.mail_configured = lambda: False
    notify_worker.send_push = lambda *a: sent.append(("web",) + a)
    notify_worker.send_app_push = lambda token, title, body, url, tag: sent.append((token, title, url, tag))


def test_durchlauf_schickt_an_die_app():
    sent = []
    _nur_app_kanal(sent)
    try:
        store = {
            "shops": {"laden": {"name": "Barber Ali"}},
            "appointments": {"dran": appt("dran", -5, status="in-progress"), "naechste": appt("naechste", 15)},
            "push_subscriptions": {
                "a1": {"appointmentId": "dran", "token": "fcm-token-iphone-1234567890", "platform": "ios"},
                "a2": {"appointmentId": "naechste", "token": "fcm-token-ipad-1234567890", "platform": "ios", "language": "en"},
                # Browser-Anmeldung, aber auf diesem Server kein Web-Push: nicht versuchen
                "w1": {"appointmentId": "dran", "endpoint": "https://push/1", "p256dh": "k", "auth": "a"},
            },
        }
        result = notify_worker.run_once(FakeDb(store), now=NOW)
        assert ("fcm-token-iphone-1234567890", "Du bist dran", "/nummer/dran", "called-dran") in sent
        assert ("fcm-token-ipad-1234567890", en.TEXTE["Gleich bist du dran"], "/nummer/naechste", "soon-naechste") in sent
        assert all(s[0] != "web" for s in sent)
        assert result["gesendet"] == 2
        assert store["appointments"]["dran"]["notifiedCalledAt"] == NOW
        sent.clear()
        notify_worker.run_once(FakeDb(store), now=NOW)
        assert sent == []
    finally:
        notify_worker.fcm_configured = lambda: False


def test_app_und_browser_zusammen():
    sent = []
    _nur_app_kanal(sent)
    notify_worker.push_configured = lambda: True
    try:
        store = {
            "shops": {"laden": {"name": "Barber Ali"}},
            "appointments": {"dran": appt("dran", -5, status="in-progress")},
            "push_subscriptions": {
                "a1": {"appointmentId": "dran", "token": "fcm-token-iphone-1234567890", "platform": "ios"},
                "w1": {"appointmentId": "dran", "endpoint": "https://push/1", "p256dh": "k", "auth": "a"},
            },
        }
        notify_worker.run_once(FakeDb(store), now=NOW)
        assert {s[0] for s in sent} == {"fcm-token-iphone-1234567890", "web"}
    finally:
        notify_worker.fcm_configured = lambda: False


def test_geloeschte_app_wird_abgemeldet():
    def gone(*_a):
        raise fcm.TokenGone()
    _nur_app_kanal([])
    notify_worker.send_app_push = gone
    try:
        store = {
            "shops": {},
            "appointments": {"dran": appt("dran", -5, status="in-progress")},
            "push_subscriptions": {"a1": {"appointmentId": "dran", "token": "fcm-token-iphone-1234567890", "platform": "ios"}},
        }
        notify_worker.run_once(FakeDb(store), now=NOW)
        assert store["push_subscriptions"] == {}
    finally:
        notify_worker.fcm_configured = lambda: False


def test_app_nachricht_wie_web_push():
    message = fcm.build_message("fcm-token-iphone-1234567890", "Du bist dran", "Barber Ali ruft dich auf.", "/nummer/dran", "called-dran")
    assert message.token == "fcm-token-iphone-1234567890"
    assert message.notification.title == "Du bist dran"
    # url öffnet die Nummer beim Antippen, tag ersetzt die ältere Nachricht zur selben Nummer
    assert message.data == {"url": "/nummer/dran", "tag": "called-dran"}
    assert message.apns.headers["apns-collapse-id"] == "called-dran"
    assert message.apns.headers["apns-priority"] == "10"
    assert message.apns.payload.aps.sound == "default"
    assert message.android.collapse_key == "called-dran"


def test_ohne_dienstkonto_kein_app_kanal():
    alt = {k: os.environ.pop(k, None) for k in ("FIREBASE_SERVICE_ACCOUNT_KEY", "FIREBASE_SERVICE_ACCOUNT_KEY_FILE")}
    try:
        assert fcm.fcm_configured() is False
        os.environ["FIREBASE_SERVICE_ACCOUNT_KEY_FILE"] = "/etc/q-me-firebase.json"
        assert fcm.fcm_configured() is True
    finally:
        os.environ.pop("FIREBASE_SERVICE_ACCOUNT_KEY_FILE", None)
        os.environ.update({k: v for k, v in alt.items() if v is not None})


# --- Nachrichten an das Team (app/libs/team_notify.py) ---------------------------------------------

from app.libs.team_notify import digest_message, event_of, notice_fields, plan_team_messages, quiet, team_message, wants  # noqa: E402

# 23:30 und 8:05 deutscher Zeit (Oktober, Sommerzeit)
NIGHT = datetime(2026, 10, 19, 21, 30, tzinfo=timezone.utc)
MORNING = datetime(2026, 10, 20, 6, 5, tzinfo=timezone.utc)
TODAY = NOW.replace(hour=0, minute=0)


def team_sub(doc_id, uid, staff=None, shop="laden", **extra):
    return {"doc_id": doc_id, "uid": uid, "shopId": shop, "staffId": staff, "endpoint": f"https://push/{doc_id}", "p256dh": "k",
            "auth": "a", **extra}


def test_team_merker_je_ereignis_nur_einmal():
    new = notice_fields({}, "new", NOW)
    assert new == {"teamNotice": "new", "teamNoticeAt": NOW, "teamNewAt": NOW}
    assert notice_fields(new, "new", NOW) is None  # zweimal melden geht nicht
    # Schon gemeldet, dann abgesagt: Absage kommt
    sent = {**new, "teamNotice": None}
    assert notice_fields(sent, "cancelled", NOW)["teamNotice"] == "cancelled"
    # Noch nicht gemeldet (Nachtruhe), schon wieder abgesagt: keine Nachricht, auch keine Absage
    assert notice_fields(new, "cancelled", NOW) == {"teamNotice": None, "teamNoticeAt": None, "teamCancelledAt": NOW}
    assert notice_fields({"teamCancelledAt": NOW}, "cancelled", NOW) is None


def test_team_ereignis_nur_wenn_es_noch_stimmt():
    assert event_of(appt("a", 30, type="queue", teamNotice="new"), TODAY) == "nummer"
    assert event_of(appt("a", 30, type="booked", teamNotice="new"), TODAY) == "buchung"
    assert event_of(appt("a", 30, status="cancelled", teamNotice="cancelled"), TODAY) == "absage"
    # Neue Buchung, die der Laden inzwischen selbst abgesagt hat
    assert event_of(appt("a", 30, status="cancelled", teamNotice="new"), TODAY) is None
    assert event_of(appt("a", -24 * 60, teamNotice="new"), TODAY) is None  # gestern
    assert event_of(appt("a", 30), TODAY) is None


def test_team_inhaber_alles_person_nur_eigenes():
    owner, robin, kim = team_sub("o", "inhaber"), team_sub("r", "konto-robin", "robin"), team_sub("k", "konto-kim", "kim")
    staff_uids = {"robin": "konto-robin", "kim": "konto-kim"}
    termin = appt("a", 30, staff="robin")
    assert wants(owner, termin, "buchung", "inhaber", staff_uids)
    assert wants(robin, termin, "buchung", "inhaber", staff_uids)
    assert not wants(kim, termin, "buchung", "inhaber", staff_uids)
    # Robin ist nicht mehr im Team (oder ein anderes Konto steht jetzt an der Person)
    assert not wants(robin, termin, "buchung", "inhaber", {"kim": "konto-kim"})
    assert not wants(robin, termin, "buchung", "inhaber", {"robin": "anderes-konto"})
    # Ereignis abgewählt, anderer Laden
    assert not wants({**robin, "events": {"buchung": False}}, termin, "buchung", "inhaber", staff_uids)
    assert wants({**robin, "events": {"buchung": False}}, termin, "absage", "inhaber", staff_uids)
    assert not wants({**owner, "shopId": "anderer"}, termin, "buchung", "inhaber", staff_uids)


def test_team_plan_sammelt_je_geraet():
    pending = [appt("b", 90, teamNotice="new", teamNoticeAt=NOW, type="booked"),
               appt("a", 30, teamNotice="new", teamNoticeAt=NOW - timedelta(minutes=5), type="queue"),
               appt("c", 60, staff="kim", status="cancelled", teamNotice="cancelled", teamNoticeAt=NOW)]
    subs = [team_sub("o", "inhaber"), team_sub("r", "konto-robin", "robin")]
    plan = {sub["doc_id"]: [(a["id"], e) for a, e in items] for sub, items in plan_team_messages(pending, subs, "inhaber", {"robin": "konto-robin"}, TODAY)}
    assert plan == {"o": [("a", "nummer"), ("b", "buchung"), ("c", "absage")], "r": [("a", "nummer"), ("b", "buchung")]}


def test_team_nachtruhe():
    assert quiet(NIGHT) and quiet(MORNING - timedelta(minutes=10)) and not quiet(MORNING) and not quiet(NOW)
    assert quiet(datetime(2026, 10, 19, 19, 0, tzinfo=timezone.utc))  # 21 Uhr


def test_team_texte():
    at = lambda h, m, day=19: datetime(2026, 10, day, h, m, tzinfo=timezone.utc)  # noqa: E731 – 10:00 UTC = 12:00 Uhr
    nummer = {"id": "a", "type": "queue", "referenceCode": "A12", "startTime": at(12, 30)}
    assert team_message(nummer, "nummer", "de", at(10, 0), "Herrenschnitt") == ("Neue Nummer A12", "Herrenschnitt, heute gegen 14:30")
    buchung = {"id": "b", "type": "booked", "startTime": at(13, 0, 22), "source": "telefon"}
    assert team_message(buchung, "buchung", "de", at(10, 0), "Bart", "Anna") == (
        "Neue Buchung", "Bart, am Do 22.10. um 15:00 bei Anna (per Telefon)")
    assert team_message(nummer, "absage", "de", at(10, 0)) == ("Nummer A12 zurückgegeben", "Heute gegen 14:30")
    assert team_message({**buchung, "source": None}, "absage", "de", at(10, 0), "Bart")[0] == "Termin abgesagt"
    title, body = team_message(buchung, "buchung", "en", at(10, 0), "Beard", "Anna")
    assert title == "New booking" and body == "Beard, on Thu 22/10 at 15:00 with Anna (by phone)"
    title, body = team_message(nummer, "nummer", "tr", at(10, 0), "Saç kesimi")
    assert title == "Yeni numara A12" and "14:30" in body and tr.TEXTE["heute"] in body
    title, body = team_message(nummer, "absage", "ar", at(10, 0))
    assert "A12" in title and "14:30" in body and ar.TEXTE["heute"] in body


def test_team_sammelnachricht():
    assert digest_message(["buchung", "nummer", "buchung", "absage"], "de", "Barber Ali") == (
        "Neu bei Barber Ali", "1 neue Nummer, 2 neue Buchungen, 1 Absage")
    assert digest_message(["absage", "absage"], "en", "") == ("New at Dranzeit", "2 cancellations")
    assert digest_message(["buchung", "buchung"], "ar", "Barber Ali")[1] == ar.TEXTE["{n} neue Buchungen"]["two"]
    assert digest_message(["nummer"] * 3, "tr", "X")[1] == "3 yeni numara"


def _team_store(**appointments):
    return {
        "shops": {"laden": {"name": "Barber Ali", "owner": "inhaber"}},  # im Probemonat: Tarif Team
        "staff": {
            "robin": {"shopId": "laden", "name": "Robin", "userId": "konto-robin"},
            "kim": {"shopId": "laden", "name": "Kim", "userId": "konto-kim"},
        },
        "services": {"schnitt": {"name": "Herrenschnitt"}},
        "appointments": appointments,
        "team_push_subscriptions": {
            "o": {**team_sub("o", "inhaber"), "language": "de"},
            "r": {**team_sub("r", "konto-robin", "robin"), "language": "en"},
            "k": team_sub("k", "konto-kim", "kim"),
        },
    }


def _team_channel(sent):
    notify_worker.push_configured = lambda: True
    notify_worker.fcm_configured = lambda: False
    notify_worker.mail_configured = lambda: False
    notify_worker.send_push = lambda sub, title, body, url, tag: sent.append((sub["endpoint"], title, body, url, tag))


def test_durchlauf_selbst_gezogene_nummer_an_inhaber_und_person():
    sent = []
    _team_channel(sent)
    nummer = appt("a", 30, type="queue", referenceCode="A12", serviceId="schnitt", teamNotice="new", teamNoticeAt=NOW)
    store = _team_store(a=nummer)
    result = notify_worker.run_once(FakeDb(store), now=NOW)
    assert result["team"] == 2
    by_device = {endpoint: (title, body, url, tag) for endpoint, title, body, url, tag in sent}
    assert by_device["https://push/o"] == ("Neue Nummer A12", "Herrenschnitt, heute gegen 12:30 bei Robin", "/shop-dashboard", "team-a")
    assert by_device["https://push/r"] == ("New number A12", "Herrenschnitt, today around 12:30", "/employee-dashboard?staffId=robin", "team-a")
    assert "https://push/k" not in by_device  # Kim ist nicht gebucht
    assert store["appointments"]["a"]["teamNotice"] is None and store["appointments"]["a"]["teamNoticeSentAt"] == NOW
    sent.clear()
    notify_worker.run_once(FakeDb(store), now=NOW)
    assert sent == []


def test_durchlauf_team_nachts_still_morgens_gesammelt():
    sent = []
    _team_channel(sent)
    night_start = lambda minutes: NIGHT + timedelta(hours=10, minutes=minutes)  # noqa: E731 – morgen Vormittag
    store = _team_store(
        a={**appt("a", 0, type="booked", teamNotice="new", teamNoticeAt=NIGHT), "startTime": night_start(0)},
        b={**appt("b", 0, type="booked", teamNotice="new", teamNoticeAt=NIGHT), "startTime": night_start(60)},
        c={**appt("c", 0, status="cancelled", teamNotice="cancelled", teamNoticeAt=NIGHT), "startTime": night_start(120)},
    )
    assert notify_worker.run_once(FakeDb(store), now=NIGHT)["team"] == 0
    assert sent == [] and store["appointments"]["a"]["teamNotice"] == "new"  # bleibt liegen
    notify_worker.run_once(FakeDb(store), now=MORNING)
    by_device = {endpoint: (title, body, tag) for endpoint, title, body, _url, tag in sent}
    assert by_device["https://push/o"] == ("Neu bei Barber Ali", "2 neue Buchungen, 1 Absage", "team-laden")
    assert by_device["https://push/r"] == ("New at Barber Ali", "2 new bookings, 1 cancellation", "team-laden")
    assert len(sent) == 2
    assert all(a["teamNotice"] is None for a in store["appointments"].values())


def test_durchlauf_team_ohne_tarif_oder_vom_tresen_nichts():
    sent = []
    _team_channel(sent)
    store = _team_store(a=appt("a", 30, type="queue", teamNotice="new", teamNoticeAt=NOW), b=appt("b", 40, type="queue"))
    store["shops"]["laden"]["trialEndsAt"] = NOW - timedelta(days=1)  # Gratis-Tarif
    notify_worker.run_once(FakeDb(store), now=NOW)
    assert sent == []
    # Merker trotzdem weg – sonst käme die Nachricht Tage später, wenn der Laden bucht
    assert store["appointments"]["a"]["teamNotice"] is None and "teamNoticeSentAt" not in store["appointments"]["a"]


def test_durchlauf_team_an_die_app_und_abbestellt():
    sent = []
    _nur_app_kanal(sent)
    gone = []

    def push(token, title, body, url, tag):
        if token == "fcm-token-alt-1234567890":
            gone.append(token)
            raise fcm.TokenGone()
        sent.append((token, title, url, tag))

    notify_worker.send_app_push = push
    try:
        store = _team_store(a=appt("a", 30, type="queue", teamNotice="new", teamNoticeAt=NOW))
        store["team_push_subscriptions"] = {
            "o": {"uid": "inhaber", "shopId": "laden", "token": "fcm-token-iphone-1234567890", "platform": "ios"},
            "alt": {"uid": "inhaber", "shopId": "laden", "token": "fcm-token-alt-1234567890", "platform": "ios"},
            "w": team_sub("w", "inhaber"),  # Browser, aber auf diesem Server kein Web-Push
        }
        notify_worker.run_once(FakeDb(store), now=NOW)
        assert [s[0] for s in sent] == ["fcm-token-iphone-1234567890"] and gone == ["fcm-token-alt-1234567890"]
        assert set(store["team_push_subscriptions"]) == {"o", "w"}  # abbestellte App abgemeldet
    finally:
        notify_worker.fcm_configured = lambda: False


def test_alte_team_geraete_fallen_raus():
    store = {"team_push_subscriptions": {"neu": {"updatedAt": NOW - timedelta(days=3)}, "alt": {"updatedAt": NOW - timedelta(days=200)}}}
    assert notify_worker.cleanup_team_subscriptions(FakeDb(store), now=NOW) == 1
    assert set(store["team_push_subscriptions"]) == {"neu"}


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
