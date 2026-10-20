"""
Tests für "Früher dran" (app/apis/check_slots): Verteilung der Angebote und eine Prüfung mit
nachgebauter Datenbank. Ohne Firebase-Zugang und ohne pytest lauffähig:

    cd backend && TZ=Europe/Berlin .venv/bin/python tests/test_earlier_slots.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.apis.check_slots as cs  # noqa: E402
from app.apis.check_slots import Candidate, Offer, plan_offers  # noqa: E402
from app.apis.models import AvailableTimeslotsResponse, TimeSlot  # noqa: E402

DAY = datetime(2026, 10, 14)


def t(hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(':'))
    return DAY.replace(hour=h, minute=m)


def slot(hhmm: str, minutes: int = 31):
    return (t(hhmm), t(hhmm) + timedelta(minutes=minutes))


def cand(appt: str, start: str, service: str = 'schnitt', staff: str = 'stefan') -> Candidate:
    return Candidate(appt, staff, service, t(start), t('08:00'))


# --- Verteilung -------------------------------------------------------------------------------

def test_dein_fall_nur_der_naechste_in_der_reihe_bekommt_den_platz():
    # 12:30 frei geworden; 13:15 und 14:00 wollen früher; jetzt 12:00
    plan = plan_offers([cand('A', '13:15'), cand('B', '14:00')], {('stefan', 'schnitt'): [slot('12:30')]}, [], t('12:00'))
    assert plan.create == [('A', slot('12:30'))], plan.create


def test_kaskade_nach_annahme_geht_der_alte_platz_an_den_naechsten():
    # A hat 12:30 angenommen (Termin jetzt 12:30), 13:15 ist frei, B (14:00) bekommt 13:15
    plan = plan_offers([cand('A', '12:30'), cand('B', '14:00')], {('stefan', 'schnitt'): [slot('13:15')]}, [], t('12:05'))
    assert plan.create == [('B', slot('13:15'))], plan.create


def test_frist_abgelaufen_platz_geht_an_die_naechste_person():
    offer = Offer('n1', 'A', 'stefan', *slot('15:00'), offered_at=t('12:00'))
    plan = plan_offers([cand('A', '15:30'), cand('B', '16:00')], {('stefan', 'schnitt'): [slot('15:00')]}, [offer], t('12:16'))
    assert plan.expire == ['n1'], plan
    assert plan.create == [('B', slot('15:00'))], plan.create


def test_innerhalb_der_frist_bekommt_niemand_sonst_den_platz():
    offer = Offer('n1', 'A', 'stefan', *slot('15:00'), offered_at=t('12:00'))
    plan = plan_offers([cand('A', '15:30'), cand('B', '16:00')], {('stefan', 'schnitt'): [slot('15:00')]}, [offer], t('12:10'))
    assert plan.keep == ['n1'] and plan.create == [], plan


def test_verfallenen_platz_nicht_noch_einmal_derselben_person_anbieten():
    c = cand('A', '15:30')
    c.declined.add(t('15:00'))
    plan = plan_offers([c], {('stefan', 'schnitt'): [slot('15:00'), slot('15:15')]}, [], t('12:00'))
    assert plan.create == [('A', slot('15:15'))], plan.create


def test_platz_inzwischen_gebucht_angebot_weg_und_neu_verteilen():
    offer = Offer('n1', 'A', 'stefan', *slot('15:00'), offered_at=t('12:00'))
    plan = plan_offers([cand('A', '16:00')], {('stefan', 'schnitt'): [slot('15:45')]}, [offer], t('12:05'))
    assert plan.delete == ['n1'] and plan.create == [('A', slot('15:45'))], plan


def test_frueherer_platz_frei_angebot_wird_verbessert_alter_platz_geht_weiter():
    # (31 Minuten Dauer: 12:30–13:01 und 13:00–13:31 überlappen, deshalb 13:15)
    offer = Offer('n1', 'A', 'stefan', *slot('13:15'), offered_at=t('12:00'))
    free = {('stefan', 'schnitt'): [slot('12:30'), slot('13:15')]}
    plan = plan_offers([cand('A', '15:00'), cand('B', '16:00')], free, [offer], t('12:05'))
    assert plan.move == [('n1', slot('12:30'))], plan.move
    assert plan.create == [('B', slot('13:15'))], plan.create


def test_ueberlappende_plaetze_verschiedener_leistungen_nicht_doppelt_vergeben():
    # A (31 min) bekommt 12:30–13:01; B (10 min) darf 12:45 nicht bekommen, wohl aber 13:15
    free = {('stefan', 'schnitt'): [slot('12:30')], ('stefan', 'kurz'): [slot('12:45', 10), slot('13:15', 10)]}
    plan = plan_offers([cand('A', '14:00'), cand('B', '15:00', service='kurz')], free, [], t('12:00'))
    assert plan.create == [('A', slot('12:30')), ('B', slot('13:15', 10))], plan.create


def test_andere_person_im_team_unabhaengig():
    free = {('stefan', 'schnitt'): [slot('12:30')], ('alex', 'schnitt'): [slot('12:30')]}
    plan = plan_offers([cand('A', '14:00'), cand('B', '14:00', staff='alex')], free, [], t('12:00'))
    assert sorted(plan.create) == [('A', slot('12:30')), ('B', slot('12:30'))], plan.create


def test_vorlauf_platz_in_weniger_als_15_minuten_wird_nicht_angeboten():
    plan = plan_offers([cand('A', '14:00')], {('stefan', 'schnitt'): [slot('12:10'), slot('12:15')]}, [], t('12:00'))
    assert plan.create == [('A', slot('12:15'))], plan.create


def test_nur_fruehere_plaetze():
    plan = plan_offers([cand('A', '13:00')], {('stefan', 'schnitt'): [slot('13:00'), slot('13:30')]}, [], t('12:00'))
    assert plan.create == [], plan.create


def test_angebot_fuer_erledigten_termin_und_doppelte_angebote_werden_entfernt():
    offers = [
        Offer('alt', 'WEG', 'stefan', *slot('15:00'), offered_at=t('12:00')),
        Offer('n1', 'A', 'stefan', *slot('15:00'), offered_at=t('12:00')),
        Offer('n2', 'A', 'stefan', *slot('15:15'), offered_at=t('12:01')),
    ]
    plan = plan_offers([cand('A', '16:00')], {('stefan', 'schnitt'): [slot('15:00'), slot('15:15')]}, offers, t('12:05'))
    assert sorted(plan.delete) == ['alt', 'n2'] and plan.keep == ['n1'], plan


# --- Prüfung mit nachgebauter Datenbank -------------------------------------------------------

class FakeDoc:
    def __init__(self, store, coll, doc_id):
        self.store, self.coll, self.id = store, coll, doc_id

    @property
    def reference(self):
        return self

    def to_dict(self):
        return dict(self.store[self.coll][self.id])

    def get(self):
        return self

    @property
    def exists(self):
        return self.id in self.store[self.coll]

    def set(self, data):
        self.store[self.coll][self.id] = dict(data)

    def update(self, data):
        self.store[self.coll][self.id].update(data)

    def delete(self):
        self.store[self.coll].pop(self.id, None)


class FakeQuery:
    def __init__(self, store, coll, filters=()):
        self.store, self.coll, self.filters = store, coll, list(filters)

    def where(self, field, op, value):
        assert op == '=='
        return FakeQuery(self.store, self.coll, self.filters + [(field, value)])

    def stream(self):
        for doc_id, data in list(self.store[self.coll].items()):
            if all(data.get(f) == v for f, v in self.filters):
                yield FakeDoc(self.store, self.coll, doc_id)

    def document(self, doc_id=None):
        if doc_id is None:
            self.store['_n'] = self.store.get('_n', 0) + 1
            doc_id = f'neu{self.store["_n"]}'
        return FakeDoc(self.store, self.coll, doc_id)


class FakeDb:
    def __init__(self):
        self.store = {'appointments': {}, 'earlier_slot_notifications': {}, 'shops': {}}

    def collection(self, name):
        return FakeQuery(self.store, name)


def utc(local: datetime) -> datetime:
    """Wie Firestore: Zeitstempel kommen als UTC zurück."""
    return local.astimezone().astimezone(timezone.utc)


def test_pruefung_mit_datenbank_zeitzone_angebot_frist_und_kaskade():
    db = FakeDb()
    appts = db.store['appointments']
    base = {'shopId': 'itebv', 'staffId': 'stefan', 'serviceId': 'schnitt', 'status': 'scheduled', 'checkEarlierOptions': True}
    appts['A'] = {**base, 'customerId': 'g', 'startTime': utc(t('13:15')), 'endTime': utc(t('13:46'))}
    appts['B'] = {**base, 'customerId': 'h', 'startTime': utc(t('14:00')), 'endTime': utc(t('14:31'))}
    appts['anonym'] = {**base, 'customerId': None, 'startTime': utc(t('13:45')), 'endTime': utc(t('14:16'))}
    free = {'12:30'}

    def fake_slots(request, background_tasks):
        if request.date.date() != DAY.date():
            return AvailableTimeslotsResponse(timeslots=[])
        return AvailableTimeslotsResponse(timeslots=[TimeSlot(start_time=t(h), end_time=t(h) + timedelta(minutes=31), is_available=True) for h in sorted(free)])

    cs.get_firestore_db = lambda: db
    cs.get_available_timeslots = fake_slots
    cs.threading.Timer = lambda *a, **k: type('T', (), {'start': lambda self: None, 'daemon': True})()

    # 12:10: 12:30 ist frei -> nur A (nächster in der Reihe) bekommt das Angebot
    result = cs.run_earlier_slot_check(now=t('12:10'))
    notes = db.store['earlier_slot_notifications']
    assert result.appointments_checked == 2, result  # ohne Kundenkonto kein Kandidat
    assert len(notes) == 1, notes
    (nid, note), = notes.items()
    assert note['appointmentId'] == 'A' and note['earlierStartTime'] == '2026-10-14T12:30:00', note
    assert note['expiresAt'] == t('12:25').astimezone(), note['expiresAt']
    assert note['status'] == 'offered' and note['userId'] == 'g'
    # ... und der Benachrichtigungsdienst schickt es per Push/E-Mail (app/libs/notify_worker.py)
    assert note['offerNotice'] == 'pending', note

    # 12:20: noch in der Frist -> nichts ändert sich
    cs.run_earlier_slot_check(now=t('12:20'))
    assert list(notes) == [nid] and notes[nid]['status'] == 'offered'

    # A nimmt an: Termin A jetzt 12:30, Angebot angenommen, 13:15 wird frei -> B bekommt 13:15
    appts['A'].update({'startTime': utc(t('12:30')), 'endTime': utc(t('13:01'))})
    notes[nid]['isAccepted'] = True
    free.clear()
    free.add('13:15')
    cs.run_earlier_slot_check(now=t('12:21'))
    open_offers = {k: v for k, v in notes.items() if not v['isAccepted']}
    assert len(open_offers) == 1, open_offers
    assert list(open_offers.values())[0]['appointmentId'] == 'B'
    assert list(open_offers.values())[0]['earlierStartTime'] == '2026-10-14T13:15:00'

    # B reagiert nicht: nach 15 Minuten verfällt das Angebot (bleibt als "abgelehnt" gemerkt)
    cs.run_earlier_slot_check(now=t('12:37'))
    (bid, bnote), = [(k, v) for k, v in notes.items() if v['appointmentId'] == 'B']
    assert bnote['status'] == 'expired', bnote
    # ... und B bekommt denselben Platz nicht noch einmal
    cs.run_earlier_slot_check(now=t('12:38'))
    assert [v['status'] for v in notes.values() if v['appointmentId'] == 'B'] == ['expired']


def test_frueher_fertig_gibt_den_rest_frei():
    # Wie occupiedWindow im Frontend (utils/queue-lane.ts): belegt ist, was wirklich gebraucht wird
    from app.apis.available_timeslots import occupied_window

    start, end = t('11:00'), t('11:30')
    assert occupied_window({'status': 'scheduled'}, start, end) == (start, end)
    # 10:20 früher aufgerufen, 10:45 fertig: belegt war 10:20–10:45, 11:00–11:30 ist wieder frei
    early = {'status': 'completed', 'calledAt': utc(t('10:20')), 'completedAt': utc(t('10:45'))}
    assert occupied_window(early, start, end) == (t('10:20'), t('10:45'))
    # Ohne Aufruf vor der Zeit abgehakt: belegt nichts
    assert occupied_window({'status': 'completed', 'calledAt': utc(t('10:30')), 'completedAt': utc(t('10:30'))}, start, end) is None
    # 11:00 dran, 11:15 fertig: ab 11:15 frei
    assert occupied_window({'status': 'completed', 'calledAt': utc(t('11:00')), 'completedAt': utc(t('11:15'))}, start, end) == (start, t('11:15'))
    # Dran seit 10:20 (zuletzt aufgerufen): belegt 10:20–10:50 statt 11:00–11:30
    assert occupied_window({'status': 'in-progress', 'calledAt': utc(t('09:00')), 'lastCalledAt': utc(t('10:20'))}, start, end) == (t('10:20'), t('10:50'))
    # Altbestand ohne Zeitpunkte: wie geplant
    assert occupied_window({'status': 'completed'}, start, end) == (start, end)



def test_gratis_laden_bekommt_kein_frueher_dran():
    db = FakeDb()
    db.store['shops']['itebv'] = {'trialEndsAt': datetime(2026, 1, 1, tzinfo=timezone.utc)}  # Test vorbei, kein Abo
    base = {'shopId': 'itebv', 'staffId': 'stefan', 'serviceId': 'schnitt', 'status': 'scheduled', 'checkEarlierOptions': True}
    db.store['appointments']['A'] = {**base, 'customerId': 'g', 'startTime': utc(t('13:15')), 'endTime': utc(t('13:46'))}

    def fake_slots(request, background_tasks):
        return AvailableTimeslotsResponse(timeslots=[TimeSlot(start_time=t('12:30'), end_time=t('13:01'), is_available=True)])

    cs.get_firestore_db = lambda: db
    cs.get_available_timeslots = fake_slots
    cs.threading.Timer = lambda *a, **k: type('T', (), {'start': lambda self: None, 'daemon': True})()
    result = cs.run_earlier_slot_check(now=t('12:10'))
    assert result.appointments_checked == 0, result
    assert db.store['earlier_slot_notifications'] == {}

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
