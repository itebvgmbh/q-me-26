"""
Tests für "Früher dran" annehmen (app/apis/accept_slot) und die Belegung je Person und Tag
(app/libs/schedule.py) mit nachgebauter Datenbank. Ohne Firebase-Zugang und ohne pytest lauffähig:

    cd backend && uv run python tests/test_accept_slot.py

Echte Gleichzeitigkeit (zwei Geräte, Tresen, Ansturm) prüft der Lasttest gegen die Live-Seite:
node dev/e2e/lasttest.cjs alles
"""
import inspect
import os
import sys
import threading
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.apis.accept_slot as acc  # noqa: E402
import app.apis.check_slots as cs  # noqa: E402
from app.libs import schedule  # noqa: E402

BERLIN = schedule.BERLIN
TOMORROW = (datetime.now(BERLIN) + timedelta(days=1)).date()


def at(hhmm: str) -> datetime:
    """Zeitpunkt morgen, wie Firestore ihn zurückgibt (UTC)."""
    h, m = map(int, hhmm.split(':'))
    return datetime(TOMORROW.year, TOMORROW.month, TOMORROW.day, h, m, tzinfo=BERLIN).astimezone(timezone.utc)


def local(hhmm: str) -> str:
    """So speichern Angebote die Zeit: Ortszeit ohne Zeitzone."""
    return at(hhmm).astimezone(BERLIN).replace(tzinfo=None).isoformat()


# --- nachgebaute Datenbank mit Transaktionen ---------------------------------------------------

class Snap:
    def __init__(self, ref, data):
        self.reference, self.id, self._data = ref, ref.id, data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class Ref:
    def __init__(self, db, coll, doc_id):
        self.db, self.coll, self.id = db, coll, doc_id

    def _docs(self):
        return self.db.store.setdefault(self.coll, {})

    def get(self, transaction=None):
        if transaction is not None:
            assert not transaction.writes, 'Firestore: erst lesen, dann schreiben'
            transaction.reads.append(self.id)
        data = self._docs().get(self.id)
        return Snap(self, dict(data) if data is not None else None)

    def set(self, data):
        self._docs()[self.id] = dict(data)

    def update(self, data):
        self._docs()[self.id].update(data)

    def delete(self):
        self._docs().pop(self.id, None)


OPS = {'==': lambda a, b: a == b, '<': lambda a, b: a is not None and a < b}


class Query:
    def __init__(self, db, coll, filters=(), limit=None):
        self.db, self.coll, self.filters, self.max = db, coll, list(filters), limit

    def where(self, field, op, value):
        return Query(self.db, self.coll, self.filters + [(field, OPS[op], value)], self.max)

    def limit(self, n):
        return Query(self.db, self.coll, self.filters, n)

    def stream(self):
        hits = [doc_id for doc_id, data in self.db.store.get(self.coll, {}).items() if all(op(data.get(f), v) for f, op, v in self.filters)]
        for doc_id in hits[:self.max]:
            yield Snap(Ref(self.db, self.coll, doc_id), self.db.store[self.coll][doc_id])

    def document(self, doc_id):
        return Ref(self.db, self.coll, doc_id)


class Transaction:
    def __init__(self):
        self.reads, self.writes = [], []

    def set(self, ref, data):
        self.writes.append(lambda: ref.set(data))

    def update(self, ref, data):
        self.writes.append(lambda: ref.update(data))


class Db:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        return Query(self, name)

    def transaction(self):
        return Transaction()


def transactional(fn):
    """Wie google.cloud.firestore.transactional: Fehler = nichts geschrieben, sonst alle Schreibvorgänge."""
    def run(tx):
        result = fn(tx)
        for write in tx.writes:
            write()
        return result
    return run


class Calls:
    def __init__(self):
        self.checks, self.free = [], True


def setup(free=True):
    db = Db()
    calls = Calls()
    calls.free = free
    acc.get_firestore_db = lambda: db
    acc.firestore.transactional = transactional
    acc._slot_still_free = lambda *a, **k: calls.free
    acc.invalidate_shop_date_cache = lambda *a, **k: 0
    acc.trigger_check_in_background = lambda shop, staff: calls.checks.append((shop, staff))
    base = {'shopId': 'laden', 'staffId': 'robin', 'serviceId': 'schnitt', 'customerId': 'kim', 'checkEarlierOptions': True}
    db.store['appointments'] = {
        'A': {**base, 'status': 'scheduled', 'startTime': at('15:00'), 'endTime': at('15:30')},
    }
    db.store['earlier_slot_notifications'] = {
        'n1': {'appointmentId': 'A', 'userId': 'kim', 'shopId': 'laden', 'staffId': 'robin', 'isAccepted': False, 'status': 'offered',
               'earlierStartTime': local('10:00'), 'earlierEndTime': local('10:30')},
    }
    return db, calls


def slots(db, day=None):
    return (db.store.get('schedules', {}).get(f"robin_{day or TOMORROW.isoformat()}") or {}).get('slots', {})


# --- Tests -------------------------------------------------------------------------------------

def test_annahme_verschiebt_termin_und_traegt_ihn_in_die_belegung_ein():
    db, calls = setup()
    result = acc.accept_earlier_slot_impl('n1', 'kim')
    assert result['status'] == 'success', result
    appt = db.store['appointments']['A']
    assert appt['startTime'] == at('10:00') and appt['endTime'] == at('10:30'), appt
    assert appt['status'] == 'scheduled'
    assert db.store['earlier_slot_notifications']['n1']['isAccepted'] is True
    assert set(slots(db)) == {'A'} and slots(db)['A']['start'] == at('10:00'), slots(db)
    assert calls.checks == [('laden', 'robin')], 'Kaskade: alter Platz wird sofort neu verteilt'


def test_zweite_annahme_meldet_erfolg_und_aendert_nichts():
    db, calls = setup()
    assert acc.accept_earlier_slot_impl('n1', 'kim')['status'] == 'success'
    before = dict(db.store['appointments']['A'])
    second = acc.accept_earlier_slot_impl('n1', 'kim')
    assert second['status'] == 'success' and 'Schon angenommen' in second['message'], second
    assert db.store['appointments']['A'] == before
    assert 'n1' in db.store['earlier_slot_notifications'], 'Angebot (Verlauf) bleibt'
    assert len(calls.checks) == 1


def test_abgesagter_termin_bleibt_abgesagt():
    db, _ = setup()
    db.store['appointments']['A']['status'] = 'cancelled'
    result = acc.accept_earlier_slot_impl('n1', 'kim')
    assert result['status'] == 'error' and result.get('code') == 'not_scheduled', result
    assert db.store['appointments']['A']['status'] == 'cancelled'
    assert db.store['appointments']['A']['startTime'] == at('15:00')


def test_platz_in_der_belegung_vergeben_kein_zweiter_termin():
    # Der Tresen hat 10:00 gerade gebucht (steht in der Belegung, die Platzberechnung wusste es noch nicht)
    db, _ = setup()
    db.store['appointments']['T'] = {'shopId': 'laden', 'staffId': 'robin', 'status': 'scheduled', 'startTime': at('10:00'), 'endTime': at('10:30')}
    db.store['schedules'] = {f'robin_{TOMORROW.isoformat()}': {'slots': {'T': {'start': at('10:00'), 'end': at('10:30')}}}}
    result = acc.accept_earlier_slot_impl('n1', 'kim')
    assert result['status'] == 'error' and result.get('code') == 'taken', result
    assert db.store['appointments']['A']['startTime'] == at('15:00'), 'Termin bleibt, wo er war'
    assert set(slots(db)) == {'T'}
    assert 'n1' not in db.store['earlier_slot_notifications'], 'totes Angebot weg'


def test_veralteter_eintrag_abgesagter_termin_blockiert_nicht():
    db, _ = setup()
    db.store['appointments']['X'] = {'shopId': 'laden', 'staffId': 'robin', 'status': 'cancelled', 'startTime': at('10:00'), 'endTime': at('10:30')}
    db.store['schedules'] = {f'robin_{TOMORROW.isoformat()}': {'slots': {
        'X': {'start': at('10:00'), 'end': at('10:30')},
        'weg': {'start': at('10:15'), 'end': at('10:45')},  # Termin gelöscht
    }}}
    result = acc.accept_earlier_slot_impl('n1', 'kim')
    assert result['status'] == 'success', result
    assert set(slots(db)) == {'A'}, slots(db)


def test_fremder_kunde_darf_nicht_annehmen():
    db, _ = setup()
    result = acc.accept_earlier_slot_impl('n1', 'jemand')
    assert result['status'] == 'error' and result.get('code') == 'unauthorized', result
    assert db.store['appointments']['A']['startTime'] == at('15:00')


def test_platz_laut_berechnung_weg_pause_oder_aelterer_termin():
    db, _ = setup(free=False)
    result = acc.accept_earlier_slot_impl('n1', 'kim')
    assert result['status'] == 'error' and result.get('code') == 'taken', result
    assert db.store['appointments']['A']['startTime'] == at('15:00')


def test_angebot_weg_klare_meldung():
    db, _ = setup()
    db.store['earlier_slot_notifications'].clear()
    result = acc.accept_earlier_slot_impl('n1', 'kim')
    assert result['status'] == 'error' and 'gibt es nicht mehr' in result['message'], result


def test_annahme_wartet_auf_laufende_pruefung():
    db, _ = setup()
    done = []
    with cs._check_lock:
        worker = threading.Thread(target=lambda: done.append(acc.accept_earlier_slot_impl('n1', 'kim')))
        worker.start()
        time.sleep(0.2)
        assert not done, 'Annahme darf nicht mitten in einer Prüfung laufen'
    worker.join(5)
    assert done and done[0]['status'] == 'success', done


def test_endpunkt_blockiert_den_server_nicht():
    # def statt async def: FastAPI führt ihn im Threadpool aus, der Event-Loop bleibt frei
    assert not inspect.iscoroutinefunction(acc.accept_earlier_slot)
    assert not inspect.iscoroutinefunction(acc.accept_earlier_slot_impl)


def test_belegung_verschieben_innerhalb_des_tages_und_ueber_tage():
    db = Db()
    tx = Transaction()
    day1 = TOMORROW.isoformat()
    old = schedule.Placement('robin', at('15:00'), at('15:30'))
    db.store['schedules'] = {f'robin_{day1}': {'slots': {'A': {'start': old.start, 'end': old.end}}}}
    new = schedule.Placement('robin', at('10:00') + timedelta(days=1), at('10:30') + timedelta(days=1))
    change = schedule.read_placement(tx, db, 'A', 'laden', occupy=new, release=old)
    assert change.conflict is None
    change.write()
    for w in tx.writes:
        w()
    day2 = (TOMORROW + timedelta(days=1)).isoformat()
    assert slots(db, day1) == {}, 'alter Tag frei'
    assert set(slots(db, day2)) == {'A'}, 'neuer Tag belegt'


def test_belegung_ueber_mitternacht_beruehrt_beide_tage():
    p = schedule.Placement('robin', at('23:45'), at('23:45') + timedelta(minutes=30))
    assert p.days() == [TOMORROW.isoformat(), (TOMORROW + timedelta(days=1)).isoformat()]
    q = schedule.Placement('robin', at('10:00'), at('10:30'))
    assert q.days() == [TOMORROW.isoformat()]
    assert schedule.day_key(datetime(2026, 10, 20, 23, 30, tzinfo=timezone.utc)) == '2026-10-21', 'deutscher Tag, nicht UTC'


def test_vergangene_tage_werden_aufgeraeumt():
    db = Db()
    db.store['schedules'] = {f'robin_2026-10-{d:02d}': {'day': f'2026-10-{d:02d}', 'slots': {}} for d in range(1, 21)}
    db.store['shop_days'] = {'laden_2026-10-01': {'day': '2026-10-01', 'codes': ['12']}, 'laden_2026-10-20': {'day': '2026-10-20', 'codes': []}}
    deleted = schedule.delete_past_days(db, now=datetime(2026, 10, 20, 12, 0, tzinfo=BERLIN), batch_size=4)
    assert sorted(db.store['schedules']) == [f'robin_2026-10-{d:02d}' for d in range(13, 21)], sorted(db.store['schedules'])
    assert list(db.store['shop_days']) == ['laden_2026-10-20']
    assert deleted == 13, deleted


if __name__ == '__main__':
    tests = [(name, fn) for name, fn in sorted(globals().items()) if name.startswith('test_') and callable(fn)]
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
