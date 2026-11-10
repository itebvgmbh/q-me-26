# Anforderung: Termin-API für Läden

- **ID:** termin-api
- **Stand:** 10.11.2026
- **Status:** Abgestimmt mit Stefan am 10.11.2026 (siehe „Entschieden“).
- **Fortschritt:** Gebaut am 10.11.2026 (task-003). Tests: `backend/tests/test_termin_api.py`. Caddy: `caddy-domain.py`
  gibt `/api/*` ans Backend (`deploy/README.md`, „Termin-API der Läden“). Leitfaden für Entwickler:
  `backend/app/schnittstelle/leitfaden.md`, live unter `/api/v1/redoc` und `/api/v1/docs` (10.11.2026).
  Webhooks auf Stefans Wunsch nachgezogen am 10.11.2026 (`backend/app/libs/webhooks.py`, Tests
  `backend/tests/test_webhooks.py`), Anlass: Anbindung einer Software für Haarentfernungsinstitute.
- **Grundlage:** Buchung im Backend (`backend/app/libs/buchung.py`), Termine des Teams
  (`backend/app/libs/team_termine.py`), freie Plätze wie online (`backend/app/libs/online_platz.py`), Kundenliste
  (`backend/app/libs/laeden.py`, `backend/app/libs/telefon_kunden.py`), Telefon-Assistent als Vorbild für eine
  Schnittstelle ohne Browser (`backend/app/apis/telefon`).

## Worum es geht

Ein Laden will Dranzeit an eigene Systeme anbinden: die eigene Webseite, ein Kassensystem, eine Agentur, die ein
Buchungsformular baut, oder einen Assistenten. Dafür braucht er eine Schnittstelle (API), über die ein Programm

- Kunden anlegen und finden kann,
- Leistungen anlegen und auslesen kann,
- freie Zeiten abfragen kann,
- Termine anlegen, verschieben und absagen kann,
- Termine mit „Früher dran“ anlegen kann: Der Kunde ist einverstanden, vorgezogen zu werden, wenn früher etwas frei
  wird.

## Zugang

- Der **Inhaber** erzeugt unter „Laden“ → „Schnittstelle (API)“ einen Schlüssel und gibt ihm einen Namen
  (z. B. „Webseite“). Der Schlüssel wird **einmal** angezeigt; Dranzeit speichert nur seinen Hash.
- Ein Schlüssel gilt für genau **einen Laden**. Mehrere Schlüssel je Laden sind möglich (höchstens 10 aktive).
- Der Inhaber sieht je Schlüssel Name, Anfang des Schlüssels, angelegt am, zuletzt benutzt, und kann ihn
  **widerrufen**. Ein widerrufener Schlüssel geht sofort nicht mehr.
- Das Team (Personen ohne Inhaberrolle) sieht und erzeugt keine Schlüssel.
- **Tarif:** ab Solo (Solo, Laden, Team, auch in der Testphase). Fällt der Laden auf Gratis zurück oder wird er
  gesperrt, lehnt die API jede Anfrage ab; die Schlüssel bleiben und gelten wieder, sobald der Tarif passt.
- Bremse: höchstens 120 Anfragen je Minute und Schlüssel.

## Regeln beim Buchen

Zwei Wege, per Feld `regeln` in der Anfrage:

- **`online`** (Standard): wie die Online-Buchung. Nur freie Plätze innerhalb der Öffnungs- und Arbeitszeiten, ohne
  Pausen, mit der Vorlaufzeit für Online-Termine, nur bei Personen, die die Leistung anbieten. Ohne Angabe einer
  Person nimmt Dranzeit die erste, bei der die Zeit frei ist.
- **`tresen`**: wie wenn das Team im Kalender bucht. Jede Zeit, solange die gewählte Person dann nicht schon belegt ist,
  auch außerhalb der Öffnungszeiten. Eine Person muss angegeben sein.

In beiden Fällen geht ein Platz nur einmal weg, auch wenn im selben Moment online, am Tresen oder am Telefon gebucht
wird. Ist der Platz weg, antwortet die API mit 409 und nennt die nächsten freien Zeiten.

## Termine

- **Anlegen:** Leistung, Beginn, Kunde (ID aus der Kundenliste oder Name mit E-Mail/Telefon – dann legt Dranzeit den
  Eintrag in der Kundenliste an oder nimmt den vorhandenen), optional Person, Notiz, „Früher dran“. Das Ende ergibt
  sich aus Dauer und Rüstzeit der Leistung. Das Team bekommt Bescheid wie bei einer Online-Buchung. Der Termin ist
  in der Kundenliste und im Kalender als „über die API“ zu erkennen.
- **„Früher dran“:** nur mit diesem Tarif-Baustein (ab Solo). Ein Angebot erreicht den Kunden nur, wenn sein Eintrag in
  der Kundenliste mit einem Dranzeit-Konto verbunden ist (Kunden-Link); die API sagt das in der Antwort
  (`frueher_dran_erreichbar`).
- **Verschieben:** neue Zeit, optional andere Person, nach denselben zwei Regeln. Nur Termine, die noch nicht dran
  waren. Der Kunde bekommt Bescheid wie bei einer Verschiebung im Kalender (abschaltbar per
  `kunde_benachrichtigen`).
- **Absagen:** nur Termine, die noch nicht dran waren. Der Kunde bekommt Bescheid wie bei einer Absage im Kalender
  (abschaltbar). Sagt der Kunde selbst über die Webseite des Ladens ab, setzt das Programm `durch_kunde`: Dann bekommt
  das Team Bescheid und der Kunde keine Nachricht. Zweimal absagen ist kein Fehler.
- Danach wie überall: freie Zeiten neu rechnen, „Früher dran“ anstoßen, Kalender und Tresen live aktualisieren.

## Kunden, Leistungen, Personen

- **Kunden:** anlegen (Name, E-Mail, Telefon), einzeln lesen, suchen nach E-Mail, Telefon oder Namen. Gibt es die
  E-Mail oder Telefonnummer im Laden schon, liefert die API den vorhandenen Eintrag (kein Doppel). Löschfristen wie
  jeder Eintrag der Kundenliste.
- **Leistungen:** anlegen (Name, Dauer, Preis, optional Beschreibung, Kategorie, Rüstzeit und die Personen, die sie
  anbieten) und auslesen. Gelöschte (ausgeblendete) nur auf Wunsch.
- **Personen:** nur auslesen (zum Buchen bei einer bestimmten Person).

## Form

- Adresse `https://dranzeit.de/api/v1/…`, JSON, Felder und Pfade auf Deutsch wie beim Telefon-Assistenten.
- Zeiten im ISO-Format mit Zeitzone (`2026-11-12T10:00:00+01:00`); ohne Zeitzone gilt deutsche Zeit.
- Fehler als `{"fehler": {"code": "platz_weg", "meldung": "…"}}` mit passendem HTTP-Status.
- Beschreibung zum Ausprobieren unter `https://dranzeit.de/api/v1/docs` (OpenAPI).

## Acceptance – Abnahme

- Mit einem Schlüssel aus „Schnittstelle (API)“ lassen sich Kunde, Leistung und Termin anlegen; der Termin steht im
  Kalender und in der Kundenliste.
- Ein Termin über `online` außerhalb der Öffnungszeiten wird abgelehnt, über `tresen` angenommen.
- Doppelt gebucht wird nichts: Zwei gleichzeitige Buchungen derselben Zeit → eine 201, eine 409.
- Verschieben und Absagen schicken dem Kunden die gewohnte Nachricht; mit `kunde_benachrichtigen: false` nicht.
- Ein Termin mit `frueher_dran: true` bekommt Angebote, wenn früher etwas frei wird (Kunde mit Konto).
- Ein widerrufener Schlüssel, ein Gratis-Laden und ein gesperrter Laden bekommen 401 bzw. 403.
- Ein Schlüssel von Laden A sieht nichts von Laden B.

## Webhooks (ergänzt 10.11.2026)

- Das Programm legt über die API Webhooks an (höchstens 5 je Laden, nur `https` an öffentliche Adressen). Dranzeit
  meldet jede Änderung an Terminen des Ladens, egal wer sie gemacht hat: `termin.angelegt`, `termin.verschoben`,
  `termin.abgesagt`, `termin.geaendert`, dazu `ping` zum Testen.
- Signiert mit einem Geheimnis je Webhook (HMAC-SHA256), Wiederholung über etwa 22 Stunden, Zustellungen 7 Tage
  einsehbar.
- Ein Webhook gehört zum Schlüssel, mit dem er angelegt wurde; Widerrufen nimmt ihn mit. Der Inhaber sieht alle
  Webhooks unter „Schnittstelle (API)“ und kann sie entfernen.

## Nicht Teil dieses Vorhabens

- Leistungen ändern oder löschen, Personen anlegen, Nummern ziehen über die API.
- „Früher dran“ für Kunden ohne Dranzeit-Konto.
- Ein Partner-Zugang über mehrere Läden.

## Entschieden (Stefan, 10.11.2026)

- Zugang: Schlüssel je Laden, vom Inhaber erzeugt, nur gehasht gespeichert, widerrufbar.
- „Termine mit der Option, dass sie verschoben werden“ heißt „Früher dran“.
- Regeln: wie die Online-Buchung, per Schalter wie der Tresen.
- Tarif: ab Solo.

## Generated tasks

- `tasks/task-003-termin-api.md`
