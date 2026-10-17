"""
Tests für "Laden einrichten" (app/apis/shop_setup) und die Pausen des Ladens in der Zeitberechnung.
Ohne Google, Claude und Firebase lauffähig, ohne pytest:

    cd backend && TZ=Europe/Berlin .venv/bin/python tests/test_shop_setup.py
"""
import os
import socket
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.apis.shop_setup as setup  # noqa: E402
from app.apis.available_timeslots import shop_breaks_for_day  # noqa: E402
from app.apis.calculators import calculate_available_timeslots  # noqa: E402


def period(day, open_hm, close_hm, close_day=None):
    oh, om = map(int, open_hm.split(':'))
    ch, cm = map(int, close_hm.split(':'))
    return {'open': {'day': day, 'hour': oh, 'minute': om}, 'close': {'day': day if close_day is None else close_day, 'hour': ch, 'minute': cm}}


# --- Öffnungszeiten von Google --------------------------------------------------------------------

def test_mittagspause_wird_zur_pause_des_tages():
    hours = setup.hours_from_google({'periods': [period(1, '09:00', '12:30'), period(1, '14:00', '18:00')]})
    monday = hours[1]
    assert monday == {'dayOfWeek': 1, 'isOpen': True, 'openTime': '09:00', 'closeTime': '18:00',
                      'breaks': [{'startTime': '12:30', 'endTime': '14:00'}]}, monday


def test_tage_ohne_eintrag_sind_geschlossen_sonntag_ist_null():
    hours = setup.hours_from_google({'periods': [period(d, '08:30', '17:00') for d in (1, 2, 3, 4, 5)]})
    assert [h['dayOfWeek'] for h in hours] == list(range(7))
    assert not hours[0]['isOpen'] and not hours[6]['isOpen']
    assert hours[3]['openTime'] == '08:30' and hours[3]['breaks'] == []


def test_rund_um_die_uhr_ohne_schliesszeit():
    hours = setup.hours_from_google({'periods': [{'open': {'day': 0, 'hour': 0, 'minute': 0}}]})
    assert all(h['isOpen'] and h['openTime'] == '00:00' and h['closeTime'] == '23:59' for h in hours)


def test_schliesst_um_mitternacht_nie_24_uhr():
    hours = setup.hours_from_google({'periods': [period(5, '18:00', '00:00', close_day=6)]})
    assert hours[5]['closeTime'] == '23:59', hours[5]
    assert not hours[6]['isOpen']


def test_ueberlappende_zeitfenster_werden_zusammengelegt():
    hours = setup.hours_from_google({'periods': [period(2, '09:00', '13:00'), period(2, '12:00', '18:00')]})
    assert hours[2]['openTime'] == '09:00' and hours[2]['closeTime'] == '18:00' and hours[2]['breaks'] == []


def test_ohne_oeffnungszeiten_leer():
    assert setup.hours_from_google(None) == []
    assert setup.hours_from_google({'weekdayDescriptions': ['Montag: geschlossen']}) == []


# --- Eintrag → Entwurf ----------------------------------------------------------------------------

def test_entwurf_aus_google_eintrag():
    place = {
        'id': 'ChIJabc1234567',
        'displayName': {'text': 'Salon Schnittig '},
        'addressComponents': [
            {'longText': '12', 'types': ['street_number']},
            {'longText': 'Hauptstraße', 'types': ['route']},
            {'longText': 'Leipzig', 'types': ['locality', 'political']},
            {'longText': '04109', 'types': ['postal_code']},
        ],
        'location': {'latitude': 51.34, 'longitude': 12.37},
        'primaryType': 'hair_salon',
        'types': ['hair_salon', 'beauty_salon', 'establishment'],
        'nationalPhoneNumber': '0341 123456',
        'websiteUri': 'https://schnittig.example/',
        'regularOpeningHours': {'periods': [period(2, '09:00', '18:00')], 'weekdayDescriptions': ['Dienstag: 09:00–18:00']},
    }
    draft = setup.draft_from_place(place)
    assert draft['name'] == 'Salon Schnittig'
    assert (draft['street'], draft['postalCode'], draft['city']) == ('Hauptstraße 12', '04109', 'Leipzig'), draft
    assert draft['phone'] == '0341 123456' and draft['website'] == 'https://schnittig.example/'
    assert draft['coordinates'] == {'latitude': 51.34, 'longitude': 12.37}
    assert draft['industry'] == 'barbershop'
    assert draft['businessHoursByDay'][2]['isOpen'] and not draft['businessHoursByDay'][1]['isOpen']
    assert draft['googlePlaceId'] == 'ChIJabc1234567' and not draft['closedPermanently']


def test_branche_aus_typen():
    assert setup.industry_from_types('nail_salon', []) == 'nailstudio'
    assert setup.industry_from_types(None, ['physiotherapist', 'health']) == 'physiotherapy'
    assert setup.industry_from_types('car_repair', None) == 'automotive'
    assert setup.industry_from_types('restaurant', ['food']) is None


# --- Webseite ---------------------------------------------------------------------------------------

def fake_dns(ip):
    return lambda host, port, proto=0: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, port))]


def test_nur_oeffentliche_adressen():
    for ip in ('127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.1'):
        try:
            setup.check_public_url('http://intern.example/', resolve=fake_dns(ip))
            assert False, f'{ip} hätte abgelehnt werden müssen'
        except ValueError:
            pass
    for url in ('ftp://salon.example/', 'https://salon.example:8091/', 'javascript:alert(1)'):
        try:
            setup.check_public_url(url, resolve=fake_dns('93.184.216.34'))
            assert False, f'{url} hätte abgelehnt werden müssen'
        except ValueError:
            pass
    url, ip = setup.check_public_url('salon.example/preise', resolve=fake_dns('93.184.216.34'))
    assert url == 'https://salon.example/preise' and ip == '93.184.216.34'


def test_preislinks_derselben_seite():
    html = """<a href="/preise">Preise</a> <a href="https://www.salon.example/leistungen/">Unsere Leistungen</a>
              <a href="/team">Team</a> <a href="https://andere.example/preise">Fremd</a>
              <a href="/preisliste.pdf">Preisliste PDF</a> <a href="mailto:a@b.de">Mail</a> <a href="#">Start</a>"""
    links = setup.price_links(html, 'https://salon.example/')
    assert links == ['https://salon.example/preise', 'https://www.salon.example/leistungen/'], links


def test_seitentext_ohne_skripte():
    text = setup.page_text('<html><script>var x=1</script><h2>Herren</h2><p>Haarschnitt   25 €</p><style>p{}</style></html>')
    assert text == 'Herren\nHaarschnitt 25 €', text


def test_zeichensatz_aus_der_seite():
    html = '<meta charset="iso-8859-1"><p>Föhnen</p>'.encode('latin-1')
    assert 'Föhnen' in setup._decode(html, 'text/html')
    assert 'Föhnen' in setup._decode('<p>Föhnen</p>'.encode('utf-8'), 'text/html; charset=utf-8')


# --- Webseite lesen: Ausfälle, Zeitlimit, Umlaute ------------------------------------------------

class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _html(self, body: str):
        data = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/':
            self._html('<a href="/preise">Preise</a><a href="/kaputt-preise">Leistungen</a><p>Salon Start</p>')
        elif self.path == '/preise':
            self._html('<h2>Herren</h2><p>Haarschnitt 25 €</p>')
        elif self.path == '/kaputt-preise':
            # verspricht 5000 Bytes, liefert 10 und legt auf
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', '5000')
            self.end_headers()
            self.wfile.write(b'<p>abgebr')
            self.wfile.flush()
            self.connection.shutdown(socket.SHUT_RDWR)
        elif self.path == '/langsam':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            try:
                for _ in range(30):
                    self.wfile.write(b'x')
                    self.wfile.flush()
                    time.sleep(0.5)
            except OSError:
                pass


def with_local_server(fn):
    """Testserver auf 127.0.0.1 – die Sperre für interne Adressen dafür kurz umgehen"""
    server = ThreadingHTTPServer(('127.0.0.1', 0), _Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    original = setup.check_public_url
    setup.check_public_url = lambda url, resolve=None: (url, '127.0.0.1')
    try:
        return fn(f'http://test.local:{server.server_address[1]}')
    finally:
        setup.check_public_url = original
        server.shutdown()


def test_kaputte_unterseite_kostet_nicht_den_ganzen_import():
    pages, text = with_local_server(lambda base: setup.collect_website_text(base + '/'))
    assert any(p.endswith('/preise') for p in pages), pages
    assert not any('kaputt' in p for p in pages), pages
    assert 'Haarschnitt 25 €' in text and 'Salon Start' in text, text


def test_abgebrochene_seite_ist_ein_lesbarer_fehler():
    def run(base):
        try:
            setup.fetch_page(base + '/kaputt-preise')
            return 'kein Fehler'
        except ValueError as e:
            return str(e)
    message = with_local_server(run)
    assert 'nicht vollständig lesen' in message, message


def test_troepfelnde_seite_bricht_nach_zeitlimit_ab():
    saved = setup.PAGE_SECONDS
    setup.PAGE_SECONDS = 2

    def run(base):
        start = time.monotonic()
        try:
            setup.fetch_page(base + '/langsam')
            return 'kein Fehler', time.monotonic() - start
        except ValueError as e:
            return str(e), time.monotonic() - start
    try:
        message, seconds = with_local_server(run)
    finally:
        setup.PAGE_SECONDS = saved
    assert 'zu langsam' in message, message
    assert seconds < 5, seconds


def test_umlaut_domain_und_zugangsdaten_in_der_adresse():
    url, _ = setup.check_public_url('https://www.müller.de/preise', resolve=fake_dns('93.184.216.34'))
    assert url == 'https://www.xn--mller-kva.de/preise', url
    url, _ = setup.check_public_url('http://nutzer:geheim@salon.example/', resolve=fake_dns('93.184.216.34'))
    assert url == 'http://salon.example/', url


# --- Leistungen ------------------------------------------------------------------------------------

def test_leistungen_aufraeumen():
    raw = [
        {'name': ' Herrenhaarschnitt ', 'category': 'Herren', 'duration_minutes': 28, 'duration_from_website': True, 'price_eur': 25, 'price_is_from': False},
        {'name': 'herrenhaarschnitt', 'category': '', 'duration_minutes': 30, 'duration_from_website': False, 'price_eur': 25, 'price_is_from': False},
        {'name': 'Färben', 'category': 'Farbe', 'duration_minutes': 0, 'duration_from_website': False, 'price_eur': 49.5, 'price_is_from': True},
        {'name': '', 'category': '', 'duration_minutes': 30, 'duration_from_website': False, 'price_eur': 10, 'price_is_from': False},
        {'name': 'Hochzeit', 'category': '', 'duration_minutes': 2000, 'duration_from_website': True, 'price_eur': -5, 'price_is_from': False},
    ]
    cleaned = setup.clean_services(raw)
    assert [s['name'] for s in cleaned] == ['Herrenhaarschnitt', 'Färben', 'Hochzeit'], cleaned
    assert cleaned[0]['duration'] == 30 and not cleaned[0]['durationGuessed']
    assert cleaned[1]['duration'] == 30 and cleaned[1]['durationGuessed'] and cleaned[1]['priceFrom'] and cleaned[1]['price'] == 49.5
    assert cleaned[2]['duration'] == 480 and cleaned[2]['price'] == 0


class FakeClient:
    """Nachbau von anthropic.Anthropic().beta.messages.create"""

    def __init__(self, text='', stop_reason='end_turn'):
        self.calls = []
        self.response = SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type='text', text=text)])
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def test_claude_aufruf_und_antwort():
    client = FakeClient('{"services": [{"name": "Maniküre", "category": "Hände", "duration_minutes": 45, "duration_from_website": true, "price_eur": 32, "price_is_from": false}]}')
    services = setup.extract_services('Maniküre 45 Min 32 €', 'nailstudio', client=client)
    assert services == [{'name': 'Maniküre', 'category': 'Hände', 'duration': 45, 'durationGuessed': False, 'price': 32.0, 'priceFrom': False}], services
    call = client.calls[0]
    assert call['model'] == 'claude-opus-5-5'
    assert call['output_config']['format']['type'] == 'json_schema' and call['output_config']['effort'] == 'low'
    assert call['fallbacks'] == 'default' and call['betas'] == ['server-side-fallback-2026-07-01']
    assert 'Branche laut Betrieb: nailstudio' in call['messages'][0]['content']
    assert '<webseite>' in call['messages'][0]['content']


def test_workspace_id_wird_mitgeschickt():
    saved = {k: os.environ.get(k) for k in ('ANTHROPIC_API_KEY', 'ANTHROPIC_WORKSPACE_ID')}
    try:
        os.environ['ANTHROPIC_API_KEY'] = 'sk-ant-test'
        os.environ['ANTHROPIC_WORKSPACE_ID'] = ' wrkspc_01Test '
        assert setup.anthropic_client().default_headers.get('anthropic-workspace-id') == 'wrkspc_01Test'
        os.environ['ANTHROPIC_WORKSPACE_ID'] = ''
        assert 'anthropic-workspace-id' not in setup.anthropic_client().default_headers
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_claude_lehnt_ab_oder_bricht_ab_leere_liste():
    assert setup.extract_services('x' * 100, None, client=FakeClient('', 'refusal')) == []
    assert setup.extract_services('x' * 100, None, client=FakeClient('{"services": [', 'max_tokens')) == []
    assert setup.extract_services('x' * 100, None, client=FakeClient('kein json')) == []


# --- Pausen des Ladens in der Zeitberechnung --------------------------------------------------------

SHOP = {'businessHoursByDay': [
    {'dayOfWeek': 3, 'isOpen': True, 'openTime': '09:00', 'closeTime': '17:00', 'breaks': [{'startTime': '12:30', 'endTime': '13:30'}]},
    {'dayOfWeek': 4, 'isOpen': False, 'openTime': '09:00', 'closeTime': '17:00', 'breaks': [{'startTime': '12:30', 'endTime': '13:30'}]},
    {'dayOfWeek': 5, 'isOpen': True, 'openTime': '09:00', 'closeTime': '17:00', 'breaks': [{'startTime': 'mittags', 'endTime': '13:00'}, {'startTime': '15:00', 'endTime': '14:00'}]},
]}


def test_ladenpausen_je_tag():
    assert shop_breaks_for_day(SHOP, 3) == [{'startTime': '12:30', 'endTime': '13:30', 'active': True, 'type': 'shop'}]
    assert shop_breaks_for_day(SHOP, 4) == []  # geschlossen
    assert shop_breaks_for_day(SHOP, 5) == []  # unlesbar / Ende vor Beginn
    assert shop_breaks_for_day({'businessHours': '9:00-17:00'}, 3) == []
    assert shop_breaks_for_day(None, 3) == []


def test_ladenpause_blockiert_zeiten():
    wednesday = datetime(2026, 10, 21)
    slots = calculate_available_timeslots(
        wednesday.replace(hour=9), wednesday.replace(hour=17), [],
        {'regular_breaks': [], 'recurring_breaks': shop_breaks_for_day(SHOP, 3)}, 30,
    )
    free = [s.start_time.strftime('%H:%M') for s in slots if s.is_available]
    assert '12:00' in free and '13:30' in free, free
    assert not {'12:15', '12:30', '12:45', '13:00', '13:15'} & set(free), free


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
