"""
Testdaten für die Regel- und Oberflächentests anlegen oder wieder löschen.

    python dev/fixtures.py anlegen   # Konto, Laden, Person, Leistung, Pausen, Termin
    python dev/fixtures.py loeschen  # alles wieder weg (auch Termine/Angebote, die Tests anlegen)

ACHTUNG: Es gibt nur ein Firebase-Projekt. Die Testdaten landen in der echten Datenbank – als eigener
Laden "Testladen (wird gleich gelöscht)", der bis zum Löschen auch in der Shop-Suche steht.

Aufbau (alle Zeiten deutsche Zeit, "Montag" = nächster Montag nach heute):
  Laden Mo–Fr 09:00–17:00, Person Robin Mo–Sa 08:00–18:00, Leistung "Schnitt" 30 Minuten
  Montag Mittagspause 12:00–13:00 (wiederkehrend), Dienstag einmalige Pause 15:00–15:30,
  Mittwoch Pause des Ladens 12:30–13:30 (gilt für alle), Montag Termin 10:00–10:30.
Löschen räumt auch Läden weg, die Tests mit diesem Konto angelegt haben (z. B. laden-einrichten.cjs).
Zugangsdaten und IDs stehen danach in dev/.local/fixture.json (nicht im Git).
Nur Standardbibliothek; läuft mit Python 3.9+ unter Windows, macOS und Linux.
"""
import datetime as dt
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

KEY = 'AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE'  # öffentlicher Web-Schlüssel, steht auch in der App
FS = 'https://firestore.googleapis.com/v1/projects/qmedata-7c79e/databases/(default)/documents'
AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts'
REFERER = 'https://dranzeit.de/'
FILE = Path(__file__).resolve().parent / '.local' / 'fixture.json'

try:
    from zoneinfo import ZoneInfo
    BERLIN = ZoneInfo('Europe/Berlin')
except Exception:  # Windows ohne tzdata: Ortszeit des Rechners nehmen (in Deutschland dasselbe)
    BERLIN = dt.datetime.now().astimezone().tzinfo
    print('Hinweis: Zeitzonendaten fehlen (pip install tzdata), nehme die Ortszeit dieses Rechners.')


def call(method, url, body=None, token=None):
    headers = {'Referer': REFERER, 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode()
            return json.loads(text) if text.strip() else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {url.split("?")[0]} -> {e.code}: {e.read().decode()[:300]}')


def value(v):
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': str(v)}
    if isinstance(v, dt.datetime):
        return {'timestampValue': v.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
    if isinstance(v, list):
        return {'arrayValue': {'values': [value(x) for x in v]}}
    if isinstance(v, dict):
        return {'mapValue': {'fields': {k: value(x) for k, x in v.items()}}}
    return {'stringValue': str(v)}


def create(collection, fields, token, doc_id=None):
    url = f'{FS}/{collection}' + (f'?documentId={doc_id}' if doc_id else '')
    return call('POST', url, {'fields': {k: value(v) for k, v in fields.items()}}, token)['name'].split('/documents/')[1]


def anlegen():
    if FILE.exists():
        raise SystemExit(f'Es gibt schon Testdaten ({FILE}). Erst: python dev/fixtures.py loeschen')
    email = f'q-me-test-{int(time.time())}@example.com'
    password = 'Test-' + secrets.token_hex(6)
    account = call('POST', f'{AUTH}:signUp?key={KEY}', {'email': email, 'password': password, 'returnSecureToken': True})
    token, uid = account['idToken'], account['localId']
    now = dt.datetime.now(dt.timezone.utc)
    docs = [create('users', {'uid': uid, 'email': email, 'role': 'shopOwner'}, token, uid)]

    hours = [{'dayOfWeek': d, 'isOpen': d in (1, 2, 3, 4, 5), 'openTime': '09:00', 'closeTime': '17:00',
              'breaks': [{'startTime': '12:30', 'endTime': '13:30'}] if d == 3 else []} for d in range(7)]
    shop = create('shops', {'name': 'Testladen (wird gleich gelöscht)', 'owner': uid, 'phone': '1', 'email': email,
                            'businessHoursByDay': hours, 'createdAt': now, 'updatedAt': now}, token)
    shop_id = shop.split('/')[1]
    service = create('services', {'shopId': shop_id, 'name': 'Schnitt', 'duration': 30, 'price': 20, 'createdAt': now, 'updatedAt': now}, token)
    service_id = service.split('/')[1]
    working = [{'dayOfWeek': d, 'startTime': '08:00', 'endTime': '18:00', 'isWorking': d != 0} for d in range(7)]
    staff = create('staff', {'shopId': shop_id, 'name': 'Robin', 'email': 'robin@example.com', 'phone': '', 'role': 'staff',
                             'serviceIds': [service_id], 'isActive': True, 'status': 'available', 'userId': '',
                             'workingHours': working, 'createdAt': now, 'updatedAt': now}, token)
    staff_id = staff.split('/')[1]
    docs += [shop, service, staff]

    today = dt.datetime.now(BERLIN).date()
    monday = today + dt.timedelta(days=(7 - today.weekday()) or 7)
    tuesday = monday + dt.timedelta(days=1)
    at = lambda day, h, m: dt.datetime(day.year, day.month, day.day, h, m, tzinfo=BERLIN)
    docs.append(create('recurring-breaks', {'shopId': shop_id, 'staffId': staff_id, 'dayOfWeek': 1, 'startTime': '12:00', 'endTime': '13:00',
                                            'type': 'lunch', 'active': True, 'createdAt': now, 'updatedAt': now}, token))
    docs.append(create('breaks', {'shopId': shop_id, 'staffId': staff_id, 'date': at(tuesday, 0, 0), 'startTime': at(tuesday, 15, 0),
                                  'endTime': at(tuesday, 15, 30), 'type': 'Arzt', 'createdAt': now, 'updatedAt': now}, token))
    docs.append(create('appointments', {'shopId': shop_id, 'staffId': staff_id, 'serviceId': service_id, 'customerName': 'Test Bestand',
                                        'status': 'scheduled', 'type': 'booked', 'startTime': at(monday, 10, 0), 'endTime': at(monday, 10, 30),
                                        'isAnonymous': False, 'createdAt': now, 'updatedAt': now}, token))

    FILE.parent.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps({'email': email, 'pw': password, 'uid': uid, 'docs': docs, 'shopId': shop_id, 'staffId': staff_id,
                                'serviceId': service_id, 'monday': monday.isoformat(), 'tuesday': tuesday.isoformat()}, indent=2))
    print(f'Angelegt: Laden {shop_id}, Person {staff_id}, Montag {monday}, Dienstag {tuesday}')
    print(f'Daten in {FILE}')


def loeschen():
    if not FILE.exists():
        print('Keine Testdaten vorhanden.')
        return
    fx = json.loads(FILE.read_text())
    token = call('POST', f'{AUTH}:signInWithPassword?key={KEY}', {'email': fx['email'], 'password': fx['pw'], 'returnSecureToken': True})['idToken']
    def find(collection, field, value):
        query = {'structuredQuery': {'from': [{'collectionId': collection}], 'where': {'fieldFilter': {
            'field': {'fieldPath': field}, 'op': 'EQUAL', 'value': {'stringValue': value}}}, 'limit': 500}}
        rows = call('POST', f'{FS}:runQuery', query, token)
        return [row['document']['name'].split('/documents/')[1] for row in rows if row.get('document')]

    extra = []
    # auch, was Tests im Testladen zusätzlich anlegen (Leistungen, Personen, Kunden aus "Kunde anlegen")
    for collection in ('appointments', 'earlier_slot_notifications', 'services', 'staff', 'customers', 'schedules', 'shop_days'):
        extra += find(collection, 'shopId', fx['shopId'])
    # Läden, die Tests mit dem Testkonto angelegt haben, samt allem, was daran hängt
    for shop in find('shops', 'owner', fx['uid']):
        shop_id = shop.split('/')[1]
        if shop_id == fx['shopId']:
            continue
        extra.append(shop)
        for collection in ('services', 'staff', 'staff-invitations', 'recurring-breaks', 'breaks', 'appointments', 'customers', 'schedules', 'shop_days'):
            extra += find(collection, 'shopId', shop_id)
    for doc in sorted(set(fx['docs'] + extra)):
        call('DELETE', f'{FS}/{doc}', token=token)
        print('gelöscht', doc)
    call('POST', f'{AUTH}:delete?key={KEY}', {'idToken': token})
    print('Testkonto gelöscht')
    FILE.unlink()


if __name__ == '__main__':
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command in ('anlegen', 'setup'):
        anlegen()
    elif command in ('loeschen', 'löschen', 'cleanup'):
        loeschen()
    else:
        raise SystemExit('Aufruf: python dev/fixtures.py anlegen | loeschen')
