"""
Schneller Blick in die Datenbank: Termine eines Ladens an einem Tag und offene "Früher dran"-Angebote.

    python dev/daten.py                      # heute, ITEBV GmbH
    python dev/daten.py 2026-10-16           # bestimmter Tag
    python dev/daten.py 2026-10-16 <shopId>  # anderer Laden

Nur lesen, nichts ändern. Zeiten in deutscher Zeit. Nur Standardbibliothek.
"""
import datetime as dt
import json
import sys
import urllib.request

KEY = 'AIzaSyCpgbiFJD9_s3RidrNVGUoVEvgcE8cE4DE'
URL = f'https://firestore.googleapis.com/v1/projects/qmedata-7c79e/databases/(default)/documents:runQuery?key={KEY}'
ITEBV = 'zNS505OFvKZpFaR1vTdN'

try:
    from zoneinfo import ZoneInfo
    BERLIN = ZoneInfo('Europe/Berlin')
except Exception:
    BERLIN = dt.datetime.now().astimezone().tzinfo


def run_query(query):
    request = urllib.request.Request(URL, data=json.dumps({'structuredQuery': query}).encode(),
                                     headers={'Content-Type': 'application/json', 'Referer': 'https://q-me.spielmacherei.de/'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return [row['document'] for row in json.loads(response.read()) if 'document' in row]


def plain(field):
    if not field:
        return None
    kind, value = next(iter(field.items()))
    return '{…}' if kind in ('mapValue', 'arrayValue') else value


def local(value):
    if not value:
        return '–'
    try:
        stamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return value
    return (stamp.astimezone(BERLIN) if stamp.tzinfo else stamp).strftime('%d.%m. %H:%M')


def main():
    day = dt.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else dt.datetime.now(BERLIN).date()
    shop = sys.argv[2] if len(sys.argv) > 2 else ITEBV
    start = dt.datetime(day.year, day.month, day.day, tzinfo=BERLIN)
    end = start + dt.timedelta(days=1)
    utc = lambda d: d.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    appointments = run_query({'from': [{'collectionId': 'appointments'}], 'where': {'compositeFilter': {'op': 'AND', 'filters': [
        {'fieldFilter': {'field': {'fieldPath': 'shopId'}, 'op': 'EQUAL', 'value': {'stringValue': shop}}},
        {'fieldFilter': {'field': {'fieldPath': 'startTime'}, 'op': 'GREATER_THAN_OR_EQUAL', 'value': {'timestampValue': utc(start)}}},
        {'fieldFilter': {'field': {'fieldPath': 'startTime'}, 'op': 'LESS_THAN', 'value': {'timestampValue': utc(end)}}}]}}})
    print(f'Termine am {day:%d.%m.%Y} im Laden {shop}: {len(appointments)}')
    for doc in sorted(appointments, key=lambda d: plain(d['fields'].get('startTime')) or ''):
        f = doc['fields']
        print(f"  {local(plain(f.get('startTime')))}–{local(plain(f.get('endTime')))[-5:]}  {plain(f.get('status')):<11} {plain(f.get('type')) or '':<7}"
              f" früher={str(plain(f.get('checkEarlierOptions'))):<5} Konto={'ja ' if plain(f.get('customerId')) else 'nein'}"
              f" {plain(f.get('customerName')) or ''}  [{doc['name'].split('/')[-1]}]")
    offers = run_query({'from': [{'collectionId': 'earlier_slot_notifications'}], 'where': {'compositeFilter': {'op': 'AND', 'filters': [
        {'fieldFilter': {'field': {'fieldPath': 'shopId'}, 'op': 'EQUAL', 'value': {'stringValue': shop}}},
        {'fieldFilter': {'field': {'fieldPath': 'isAccepted'}, 'op': 'EQUAL', 'value': {'booleanValue': False}}}]}}})
    print(f'Offene "Früher dran"-Angebote: {len(offers)}')
    for doc in offers:
        f = doc['fields']
        print(f"  Termin {plain(f.get('appointmentId'))}: Platz {local(plain(f.get('earlierStartTime')))}, Status {plain(f.get('status')) or 'offered'},"
              f" reserviert bis {local(plain(f.get('expiresAt')))}")


if __name__ == '__main__':
    main()
