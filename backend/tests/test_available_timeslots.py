"""
Tests für die freien Zeiten (app/apis/available_timeslots), ihren Zwischenspeicher (app/apis/cache) und wie
"Früher dran" (app/apis/check_slots) sie liest: Eine Berechnung liest nur die Termine ihres Zeitraums, nicht
den ganzen Verlauf. Ohne Firebase und ohne pytest lauffähig:

    cd backend && TZ=Europe/Berlin .venv/bin/python tests/test_available_timeslots.py
"""
import contextlib
import io
import operator
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.apis.available_timeslots as at  # noqa: E402
import app.apis.cache as cache  # noqa: E402
import app.apis.check_slots as cs  # noqa: E402
from app.apis.models import AvailableTimeslotsRequest  # noqa: E402

DAY = datetime(2026, 10, 14)  # Mittwoch
OPS = {"==": operator.eq, ">=": operator.ge, "<": operator.lt}


def t(hhmm: str, day: datetime = DAY) -> datetime:
    h, m = map(int, hhmm.split(':'))
    return day.replace(hour=h, minute=m)


def utc(local: datetime) -> datetime:
    """Wie Firestore: Zeitstempel kommen als UTC zurück."""
    return local.astimezone().astimezone(timezone.utc)


class FakeDoc:
    def __init__(self, store, coll, doc_id):
        self.store, self.coll, self.id = store, coll, doc_id

    @property
    def exists(self):
        return self.id in self.store.setdefault(self.coll, {})

    def get(self):
        return self

    def to_dict(self):
        return dict(self.store[self.coll][self.id])


class FakeQuery:
    def __init__(self, db, coll, filters=()):
        self.db, self.coll, self.filters = db, coll, list(filters)

    def where(self, field, op, value):
        return FakeQuery(self.db, self.coll, self.filters + [(field, op, value)])

    def document(self, doc_id):
        return FakeDoc(self.db.store, self.coll, doc_id)

    def stream(self):
        self.db.queries.append((self.coll, [(f, op) for f, op, _ in self.filters]))
        for doc_id, data in list(self.db.store.setdefault(self.coll, {}).items()):
            if all(data.get(f) is not None and OPS[op](data[f], v) for f, op, v in self.filters):
                self.db.reads[self.coll] = self.db.reads.get(self.coll, 0) + 1
                yield FakeDoc(self.db.store, self.coll, doc_id)


class FakeDb:
    def __init__(self, store):
        self.store, self.queries, self.reads = store, [], {}

    def collection(self, name):
        return FakeQuery(self, name)


def week(open_='09:00', close='18:00', breaks=()):
    return [{'dayOfWeek': d, 'isOpen': d != 0, 'openTime': open_, 'closeTime': close, 'breaks': list(breaks)} for d in range(7)]


def shop_store(history: int = 0) -> dict:
    """Laden mit Robin (Mo–Sa 9–17), 30 Minuten Schnitt; dazu history alte Termine an den Tagen davor."""
    appts = {}
    for i in range(history):
        day = DAY - timedelta(days=1 + i // 16)
        start = t('08:00', day) + timedelta(minutes=(i % 16) * 30)
        appts[f'alt{i}'] = {'shopId': 'laden', 'staffId': 'robin', 'status': 'completed', 'startTime': utc(start), 'endTime': utc(start + timedelta(minutes=30))}

    def appt(start, end, **extra):
        return {'shopId': 'laden', 'staffId': 'robin', 'status': 'scheduled', 'startTime': utc(start), 'endTime': utc(end), **extra}

    appts.update({
        'zehn': appt(t('10:00'), t('10:30')),
        'abgesagt': appt(t('11:00'), t('11:30'), status='cancelled'),
        'andere_person': {**appt(t('12:00'), t('12:30')), 'staffId': 'kim'},
        'anderer_laden': {**appt(t('13:00'), t('13:30')), 'shopId': 'nebenan'},
        'morgen': appt(t('10:00', DAY + timedelta(days=1)), t('10:30', DAY + timedelta(days=1))),
        'vorabend': appt(t('20:00', DAY - timedelta(days=1)), t('20:30', DAY - timedelta(days=1))),
    })
    return {
        'shops': {'laden': {'name': 'Laden', 'businessHoursByDay': week(breaks=[{'startTime': '15:00', 'endTime': '15:30'}])}},
        'staff': {'robin': {'name': 'Robin', 'workingHours': [{'dayOfWeek': d, 'startTime': '09:00', 'endTime': '17:00', 'isWorking': d != 0} for d in range(7)]}},
        'services': {'schnitt': {'duration': 30, 'setupTime': 0}, 'bart': {'duration': 15, 'setupTime': 0}},
        'appointments': appts,
        'breaks': {'einmal': {'staffId': 'robin', 'date': utc(t('12:00')), 'startTime': utc(t('12:00')), 'endTime': utc(t('12:30'))}},
        'recurring-breaks': {
            'mittwochs': {'staffId': 'robin', 'dayOfWeek': 3, 'active': True, 'startTime': '13:00', 'endTime': '14:00'},
            'aus': {'staffId': 'robin', 'dayOfWeek': 3, 'active': False, 'startTime': '16:00', 'endTime': '17:00'},
        },
    }


def free_starts(slots) -> list:
    return [s.start_time.strftime('%H:%M') for s in slots if s.is_available]


# --- Lesen ------------------------------------------------------------------------------------

def test_berechnung_liest_nur_die_termine_des_tages_nicht_den_verlauf():
    db = FakeDb(shop_store(history=2000))
    inputs = at.load_timeslot_inputs(db, 'laden', 'robin', ['schnitt'], DAY.date(), DAY.date())
    ids = sorted(a['id'] for a in inputs.appointments)
    # Vorabend (Vorlauf für Termine über Mitternacht) und der Tag; nicht 2000 alte, nicht morgen, nicht Kim
    assert ids == ['abgesagt', 'vorabend', 'zehn'], ids
    assert db.reads['appointments'] == 4, db.reads  # dazu Robins Termin im anderen Laden
    # Abfrage über den Index staffId + startTime, nicht über alle Termine der Person
    assert ('appointments', [('staffId', '=='), ('startTime', '>='), ('startTime', '<')]) in db.queries, db.queries


def test_ohne_person_abfrage_ueber_laden_und_zeitraum():
    db = FakeDb(shop_store(history=50))
    inputs = at.load_timeslot_inputs(db, 'laden', None, ['schnitt'], DAY.date(), DAY.date())
    assert ('appointments', [('shopId', '=='), ('startTime', '>='), ('startTime', '<')]) in db.queries, db.queries
    assert all(a['shopId'] == 'laden' for a in inputs.appointments)
    assert db.reads['appointments'] <= 5, db.reads


def test_vierzehn_tage_eine_abfrage():
    db = FakeDb(shop_store(history=200))
    at.load_timeslot_inputs(db, 'laden', 'robin', ['schnitt', 'bart'], DAY.date(), (DAY + timedelta(days=13)).date())
    assert [q for q in db.queries if q[0] == 'appointments'] == [('appointments', [('staffId', '=='), ('startTime', '>='), ('startTime', '<')])]


# --- Rechnen ----------------------------------------------------------------------------------

def test_tag_mit_termin_pausen_und_ladenpause():
    db = FakeDb(shop_store(history=100))
    inputs = at.load_timeslot_inputs(db, 'laden', 'robin', ['schnitt'], DAY.date(), DAY.date())
    free = free_starts(at.timeslots_for_day(inputs, 'schnitt', DAY))
    assert free[0] == '09:00' and '10:00' not in free and '09:45' not in free  # Termin 10:00–10:30
    assert '11:00' in free  # abgesagt belegt nichts
    assert '12:00' not in free  # einmalige Pause
    assert '13:00' not in free and '13:30' not in free and '14:00' in free  # wiederkehrende Pause
    assert '15:00' not in free and '15:30' in free  # Pause des Ladens
    assert '16:00' in free and '16:30' in free  # ausgeschaltete Pause zählt nicht
    assert free[-1] == '16:30'


def test_sonntag_kein_arbeitstag():
    db = FakeDb(shop_store())
    inputs = at.load_timeslot_inputs(db, 'laden', 'robin', ['schnitt'], DAY.date(), DAY.date())
    assert at.timeslots_for_day(inputs, 'schnitt', DAY + timedelta(days=4)) is None  # Sonntag


def test_schnittstelle_eine_logzeile_je_berechnung():
    db = FakeDb(shop_store(history=300))
    at.get_firestore_db = lambda: db
    request = AvailableTimeslotsRequest(shop_id='laden', staff_id='robin', service_id='schnitt', date=DAY.replace(hour=12), force_refresh=True)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        response = at.get_available_timeslots(request, None)
    lines = [line for line in out.getvalue().splitlines() if line.strip()]
    assert len(lines) == 1 and '3 Termine gelesen' in lines[0], lines
    assert free_starts(response.timeslots)[:3] == ['09:00', '09:15', '09:30']


# --- Zwischenspeicher -------------------------------------------------------------------------

class FakeStorage:
    def __init__(self):
        self.files, self.loaded = {}, []

    def get(self, key, default=None):
        self.loaded.append(key)
        return self.files.get(key, default)

    def put(self, key, value):
        self.files[key] = value

    def delete(self, key):
        self.files.pop(key, None)

    def list(self):
        return [type('Entry', (), {'name': k})() for k in list(self.files)]


def test_zwischenspeicher_leeren_nur_nach_namen_ohne_protokolldateien():
    storage = FakeStorage()
    cache.db.storage.json = storage
    cache._last_cleanup = None
    key = lambda shop, staff, day: cache.get_cache_key({'shop_id': shop, 'staff_id': staff, 'service_id': 'schnitt', 'date': f'{day}T12:00:00'})
    today = datetime.now().date()
    tomorrow = (today + timedelta(days=1)).isoformat()
    for k in [key('laden', 'robin', tomorrow), key('laden', 'kim', tomorrow), key('laden', None, tomorrow), key('nebenan', 'robin', tomorrow)]:
        cache.save_to_cache(k, {'timeslots': []})
    storage.files['timeslot_cache_0123abcd'] = {}  # alter Name
    storage.files['cache_invalidation_log_1760000000'] = {}  # alte Protokolldatei
    storage.files[key('laden', 'robin', (today - timedelta(days=1)).isoformat())] = {}  # vergangener Tag
    storage.files['code-health-history'] = []  # anderes Modul

    assert cache.invalidate_shop_date_cache('laden', tomorrow, 'robin', verbose=False) == 1
    assert key('laden', 'robin', tomorrow) not in storage.files and key('laden', 'kim', tomorrow) in storage.files
    assert storage.loaded == []  # kein Eintrag geladen
    # Aufgeräumt: alte Namen, Protokolldateien, vergangene Tage; Fremdes bleibt
    assert sorted(storage.files) == sorted([key('laden', 'kim', tomorrow), key('laden', None, tomorrow), key('nebenan', 'robin', tomorrow), 'code-health-history'])

    assert cache.invalidate_shop_date_cache('laden', f'{tomorrow}T22:00:00.000Z', verbose=False) == 2  # ganzer Laden
    assert sorted(storage.files) == sorted([key('nebenan', 'robin', tomorrow), 'code-health-history'])
    assert not any(name.startswith('cache_invalidation_log_') for name in storage.files)


def test_zwischenspeicher_treffer_und_force_refresh():
    storage = FakeStorage()
    cache.db.storage.json = storage
    db = FakeDb(shop_store())
    at.get_firestore_db = lambda: db
    tasks = []
    background = type('BT', (), {'add_task': lambda self, fn, *a: tasks.append((fn, a))})()
    request = AvailableTimeslotsRequest(shop_id='laden', staff_id='robin', service_id='schnitt', date=DAY.replace(hour=12))
    with contextlib.redirect_stdout(io.StringIO()):
        first = at.get_available_timeslots(request, background)
        for fn, a in tasks:
            fn(*a)
        reads = sum(db.reads.values())
        second = at.get_available_timeslots(request, background)
        assert sum(db.reads.values()) == reads  # aus dem Zwischenspeicher
        assert free_starts(first.timeslots) == free_starts(second.timeslots)
        # Frontend nach dem Speichern eines Termins: nur leeren
        flush = AvailableTimeslotsRequest(shop_id='laden', staff_id='robin', service_id='force_refresh', date=DAY, force_refresh=True)
        assert at.get_available_timeslots(flush, background).timeslots == []
    assert not any(name.startswith(cache.PREFIX) for name in storage.files)


# --- "Früher dran": je Person eine Abfrage ----------------------------------------------------

def test_frueher_dran_liest_je_person_einmal_fuer_alle_tage_und_leistungen():
    db = FakeDb(shop_store(history=500))
    latest = {'schnitt': t('16:00', DAY + timedelta(days=5)), 'bart': t('11:00', DAY + timedelta(days=2))}
    by_service, read = cs._free_slots_for(db, 'laden', 'robin', latest, DAY)
    appointment_queries = [q for q in db.queries if q[0] == 'appointments']
    assert len(appointment_queries) == 1, appointment_queries
    assert read == 4, read  # zehn, abgesagt, morgen, vorabend – nicht die 500 alten
    # Schnitt bis zum 6. Tag, Bart nur bis zum 3. – wie vorher je Leistung
    assert {s[0].date() for s in by_service['schnitt']} == {(DAY + timedelta(days=i)).date() for i in range(6) if (DAY + timedelta(days=i)).weekday() != 6}
    assert max(s[0] for s in by_service['bart']).date() == (DAY + timedelta(days=2)).date()
    # Dieselben Plätze wie die Berechnung für einen einzelnen Tag
    one_day = at.timeslots_for_day(at.load_timeslot_inputs(db, 'laden', 'robin', ['schnitt'], DAY.date(), DAY.date()), 'schnitt', DAY)
    assert [s for s in by_service['schnitt'] if s[0].date() == DAY.date()] == [(s.start_time, s.end_time) for s in one_day if s.is_available]


def test_begrenzte_pruefung_liest_nur_diesen_laden():
    db = FakeDb({
        'appointments': {
            'a': {'shopId': 'laden', 'staffId': 'robin', 'serviceId': 'schnitt', 'customerId': 'k', 'status': 'scheduled', 'checkEarlierOptions': True, 'startTime': utc(t('16:00'))},
            'b': {'shopId': 'nebenan', 'staffId': 'kim', 'serviceId': 'schnitt', 'customerId': 'k', 'status': 'scheduled', 'checkEarlierOptions': True, 'startTime': utc(t('16:00'))},
        },
        'earlier_slot_notifications': {},
        'shops': {},
    })
    real = cs.get_firestore_db, cs.load_timeslot_inputs, cs.timeslots_for_day
    cs.get_firestore_db = lambda: db
    cs.load_timeslot_inputs = lambda *a: type('I', (), {'appointments': []})()
    cs.timeslots_for_day = lambda *a: []
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            result = cs.run_earlier_slot_check(shop_id='laden', now=t('09:00'))
    finally:
        cs.get_firestore_db, cs.load_timeslot_inputs, cs.timeslots_for_day = real
    assert result.appointments_checked == 1
    assert ('appointments', [('checkEarlierOptions', '=='), ('status', '=='), ('shopId', '==')]) in db.queries, db.queries
    assert ('earlier_slot_notifications', [('isAccepted', '=='), ('shopId', '==')]) in db.queries, db.queries
    assert db.reads.get('appointments') == 1, db.reads


if __name__ == '__main__':
    tests = [(name, fn) for name, fn in list(globals().items()) if name.startswith('test_') and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f'OK   {name}')
        except AssertionError as e:
            failed += 1
            print(f'FEHL {name}: {e}')
    print(f'{len(tests) - failed}/{len(tests)} bestanden')
    sys.exit(1 if failed else 0)
