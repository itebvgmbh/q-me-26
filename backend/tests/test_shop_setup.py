"""
Tests für "Laden einrichten" (app/apis/shop_setup) und die Pausen des Ladens in der Zeitberechnung.
Ohne Google, Claude und Firebase lauffähig, ohne pytest:

    cd backend && TZ=Europe/Berlin .venv/bin/python tests/test_shop_setup.py
"""
import base64
import json
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
        elif self.path == '/logo-start':
            self._html('<header><img class="logo" src="/umleitung-logo" alt="Salon"></header>'
                       '<link rel="apple-touch-icon" href="/riesig.png"><link rel="icon" type="image/svg+xml" href="/zeichen.svg">')
        elif self.path == '/umleitung-logo':
            self.send_response(302)
            self.send_header('Location', '/bilder/logo.png')
            self.send_header('Content-Length', '0')
            self.end_headers()
        elif self.path in ('/bilder/logo.png', '/riesig.png', '/zeichen.svg'):
            # falscher Content-Type mit Absicht: geprüft wird der Inhalt
            body = {'/bilder/logo.png': png(300, 100), '/riesig.png': png(300, 100, b'\x00' * 5000), '/zeichen.svg': SVG}[self.path]
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)


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


# --- Logo von der Webseite --------------------------------------------------------------------------

def png(breite, hoehe, rest=b''):
    return b'\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR' + breite.to_bytes(4, 'big') + hoehe.to_bytes(4, 'big') + b'\x08\x06\x00\x00\x00' + b'\x00' * 4 + rest


def jpeg(breite, hoehe):
    app0 = b'\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    sof = b'\xff\xc0\x00\x11\x08' + hoehe.to_bytes(2, 'big') + breite.to_bytes(2, 'big') + b'\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01'
    return b'\xff\xd8' + app0 + sof + b'\xff\xd9'


def gif(breite, hoehe):
    return b'GIF89a' + breite.to_bytes(2, 'little') + hoehe.to_bytes(2, 'little') + b'\x00' * 6


def webp_verlustfrei(breite, hoehe):
    bits = (breite - 1) | ((hoehe - 1) << 14)
    return b'RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f' + bits.to_bytes(4, 'little') + b'\x00' * 10


SVG = b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40"/></svg>'
ICO = b'\x00\x00\x01\x00\x01\x00\x10\x10\x00\x00\x01\x00\x20\x00' + b'\x00' * 40

LOGO_SEITE = """<html><head>
<link rel="icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" sizes="120x120" href="/touch-120.png">
<link rel="apple-touch-icon" sizes="180x180" href="/touch-180.png">
<link rel="mask-icon" href="/maske.svg">
<meta property="og:image" content="https://salon.example/titelbild.jpg">
<meta property="og:image" content="https://salon.example/salon-logo-og.png">
<script type="application/ld+json">{"@context": "https://schema.org", "@graph": [
  {"@type": "WebSite", "@id": "https://salon.example/#website", "publisher": {"@id": "https://salon.example/#org"}},
  {"@type": ["Organization", "HairSalon"], "@id": "https://salon.example/#org", "logo": {"@id": "https://salon.example/#logo"}},
  {"@type": "ImageObject", "@id": "https://salon.example/#logo", "url": "https://salon.example/wp-content/logo-quadrat.png"}]}</script>
<script type="application/ld+json">{ kaputt </script>
</head><body>
<footer><img src="/paypal-logo.png" alt="PayPal"></footer>
<header class="site-header"><a href="/" class="custom-logo-link"><img src="/wp-content/logo.svg" class="custom-logo" alt="Salon Schnittig"></a>
<nav><a class="navbar-brand" href="/"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/marke.webp"></a>
<a href="/logout"><img src="/icons/logout.png"></a></nav></header>
<main><img src="/team.jpg" alt="Unser Team"><img src="/wp-content/logo-quadrat.png#oben" alt="Logo"></main>
</body></html>"""


def test_logo_kandidaten_in_sinnvoller_reihenfolge():
    gefunden = setup.logo_candidates(LOGO_SEITE, 'https://salon.example/')
    assert gefunden == [
        ('https://salon.example/wp-content/logo-quadrat.png', 'json-ld'),  # aus @graph per @id, später als <img> nicht doppelt
        ('https://salon.example/wp-content/logo.svg', 'img'),  # WordPress custom-logo
        ('https://salon.example/marke.webp', 'img'),  # nachgeladen, in der Navigation (navbar-brand)
        ('https://salon.example/touch-180.png', 'apple-touch-icon'),  # nur das größte
        ('https://salon.example/icon.svg', 'icon'),  # SVG vor großem PNG, kein .ico, kein 32 px
        ('https://salon.example/icon-192.png', 'icon'),
        ('https://salon.example/salon-logo-og.png', 'og:image'),  # og:image nur mit "logo" in der Adresse
    ], gefunden


def test_logo_aus_json_ld_varianten():
    def ld(daten):
        return f'<script type="application/ld+json">{json.dumps(daten)}</script>'
    html = (ld({'@type': 'LocalBusiness', 'logo': '/a.png'})
            + ld([{'@type': 'Organization', 'logo': {'@type': 'ImageObject', 'contentUrl': 'https://cdn.example/b.png', 'url': 'https://cdn.example/b-alt.png'}}])
            + ld({'@type': 'HairSalon', 'logo': [{'url': '//cdn.example/c.png'}], 'image': '/kein-logo.jpg'})
            + ld({'@type': 'Organization', 'logo': 'javascript:alert(1)'}))
    adressen = [a for a, _ in setup.logo_candidates(html, 'https://salon.example/start')]
    assert adressen == ['https://salon.example/a.png', 'https://cdn.example/b.png', 'https://cdn.example/c.png'], adressen


def test_bild_nach_inhalt_nicht_nach_endung():
    assert setup.bild_art(png(200, 80)) == 'png' and setup.bild_groesse(png(200, 80), 'png') == (200, 80)
    assert setup.bild_art(jpeg(640, 320)) == 'jpeg' and setup.bild_groesse(jpeg(640, 320), 'jpeg') == (640, 320)
    assert setup.bild_art(webp_verlustfrei(300, 100)) == 'webp' and setup.bild_groesse(webp_verlustfrei(300, 100), 'webp') == (300, 100)
    assert setup.bild_art(gif(16, 16)) == 'gif' and setup.winzig(setup.bild_groesse(gif(16, 16), 'gif'))
    assert setup.bild_art(SVG) == 'svg' and setup.bild_groesse(SVG, 'svg') is None and not setup.winzig(None)
    assert setup.bild_art('﻿  <svg xmlns="http://www.w3.org/2000/svg"/>'.encode()) == 'svg'
    assert setup.bild_art(ICO) is None  # Favicons als ICO nicht
    assert setup.bild_art(b'<!doctype html><html><body><svg></svg></body></html>') is None  # Fehlerseite statt Bild
    assert setup.bild_art(b'') is None and setup.bild_art(b'GIF8') is None
    assert setup.winzig((300, 4)) and setup.winzig((31, 31)) and not setup.winzig((120, 40))


class _Attrappe:
    """fetch_page, fetch_image und die Rollenprüfung kurz ersetzen"""

    def __init__(self, html, bilder, seite='https://salon.example/'):
        self.html, self.bilder, self.seite, self.geladen = html, bilder, seite, []

    def __enter__(self):
        self.alt = (setup.fetch_page, setup.fetch_image, setup._require_owner, os.environ.pop('ANTHROPIC_API_KEY', None))
        setup.fetch_page = self.seite_holen
        setup.fetch_image = self.bild_holen
        setup._require_owner = lambda user: None
        return self

    def __exit__(self, *args):
        setup.fetch_page, setup.fetch_image, setup._require_owner, schluessel = self.alt
        if schluessel is not None:
            os.environ['ANTHROPIC_API_KEY'] = schluessel

    def seite_holen(self, url, deadline=None):
        if isinstance(self.html, Exception):
            raise self.html
        return self.seite, self.html

    def bild_holen(self, url, deadline=None):
        self.geladen.append(url)
        if url not in self.bilder:
            raise ValueError('Die Webseite antwortet mit Fehler 404.')
        return url, self.bilder[url]


def test_logo_endpunkt_ueberspringt_unbrauchbares_und_versucht_hoechstens_fuenf():
    html = """<script type="application/ld+json">{"@type": "Organization", "logo": "/favicon.ico"}</script>
      <header><img class="logo" src="/winzig.png"><img class="logo" src="/logo.png"><img class="logo" src="/fehlt.png"></header>
      <link rel="apple-touch-icon" href="/touch.png"><link rel="icon" type="image/svg+xml" href="/logo.svg">"""
    s = 'https://salon.example'
    bilder = {f'{s}/favicon.ico': ICO, f'{s}/winzig.png': png(16, 16), f'{s}/logo.png': png(240, 80),
              f'{s}/touch.png': png(240, 80), f'{s}/logo.svg': SVG}  # touch.png ist dasselbe Bild wie logo.png
    with _Attrappe(html, bilder) as attrappe:
        antwort = setup.shop_setup_website_logo(setup.WebsiteLogoRequest(url='salon.example'), SimpleNamespace(sub='logo-test-1'))
    assert attrappe.geladen == [f'{s}/favicon.ico', f'{s}/winzig.png', f'{s}/logo.png', f'{s}/fehlt.png', f'{s}/touch.png'], attrappe.geladen
    assert antwort.seite == 'https://salon.example/'
    assert [(logo.art, logo.quelle) for logo in antwort.logos] == [('png', f'{s}/logo.png')], antwort.logos
    assert base64.b64decode(antwort.logos[0].dataUrl.removeprefix('data:image/png;base64,')) == png(240, 80)


def test_logo_endpunkt_hoechstens_drei_und_svg_als_vorschau():
    s = 'https://salon.example'
    html = ''.join(f'<img class="logo" src="/l{i}.png">' for i in range(3)) + '<link rel="icon" type="image/svg+xml" href="/l.svg">'
    html = '<link rel="apple-touch-icon" href="/start.svg">' + html
    bilder = {f'{s}/l{i}.png': png(100 + i, 50) for i in range(3)}
    bilder[f'{s}/start.svg'] = SVG
    with _Attrappe(html, bilder) as attrappe:
        antwort = setup.shop_setup_website_logo(setup.WebsiteLogoRequest(url='https://salon.example'), SimpleNamespace(sub='logo-test-2'))
    assert len(antwort.logos) == 3 and len(attrappe.geladen) == 3, attrappe.geladen
    assert [logo.art for logo in antwort.logos] == ['png', 'png', 'png']  # <img> vor Apple-Touch-Icon
    with _Attrappe('<link rel="apple-touch-icon" href="/start.svg">', bilder):
        antwort = setup.shop_setup_website_logo(setup.WebsiteLogoRequest(url='salon.example'), SimpleNamespace(sub='logo-test-2'))
    assert antwort.logos[0].art == 'svg' and antwort.logos[0].dataUrl.startswith('data:image/svg+xml;base64,')


def test_logo_endpunkt_ohne_logo_und_mit_fehler():
    with _Attrappe('<p>Willkommen</p>', {}):
        antwort = setup.shop_setup_website_logo(setup.WebsiteLogoRequest(url='salon.example'), SimpleNamespace(sub='logo-test-3'))
    assert antwort.logos == [] and antwort.seite == 'https://salon.example/'
    fehler = ValueError(setup.merke('Diese Webseite gibt es nicht (Adresse nicht gefunden).'))
    with _Attrappe(fehler, {}):
        try:
            setup.shop_setup_website_logo(setup.WebsiteLogoRequest(url='gibts-nicht.example'), SimpleNamespace(sub='logo-test-3'))
            assert False, 'hätte 400 geben müssen'
        except setup.HTTPException as e:
            assert e.status_code == 400 and e.detail == 'Diese Webseite gibt es nicht (Adresse nicht gefunden).', e.detail
    assert setup.LIMITS['logo'] >= 10 and setup.DAY_LIMITS['logo'] >= 100


def test_logo_ueber_den_testserver():
    """Echte Abrufe: Weiterleitung, falscher Content-Type, zu großes Bild, SVG; HTML-Abruf lehnt Bilder ab"""
    saved = setup.MAX_IMAGE_BYTES
    setup.MAX_IMAGE_BYTES = 2000

    def run(base):
        seite, logos = setup.find_logos(base + '/logo-start')
        try:
            setup.fetch_page(base + '/bilder/logo.png')
            keine_seite = 'kein Fehler'
        except ValueError as e:
            keine_seite = str(e)
        return seite, logos, keine_seite
    try:
        seite, logos, keine_seite = with_local_server(run)
    finally:
        setup.MAX_IMAGE_BYTES = saved
    assert seite.endswith('/logo-start'), seite
    assert [logo['art'] for logo in logos] == ['png', 'svg'], logos  # riesig.png fehlt: zu groß
    assert logos[0]['quelle'].endswith('/bilder/logo.png'), logos[0]['quelle']
    assert base64.b64decode(logos[0]['dataUrl'].split(',', 1)[1]) == png(300, 100)
    assert keine_seite == 'Das ist keine Webseite.', keine_seite


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
