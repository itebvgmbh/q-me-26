# Telefon-Assistent: Probelauf

Wir prüfen, ob eine fertige Sprach-KI-Plattform am Telefon gut genug Deutsch spricht und zuverlässig über Dranzeit
bucht, und was eine Minute wirklich kostet. Die Anforderung steht in
[requirements/telefon-assistent.md](../requirements/telefon-assistent.md), die Schnittstelle im Backend in
`backend/app/apis/telefon`.

Angefangen wird mit **Vapi**. Dort ist die Berliner Nummer der ITEBV über **Vonage** schon eingebunden, eine neue
Nummer ist also nicht nötig. Zum Vergleich kann danach **ElevenLabs Agents** dieselben Werkzeuge nutzen (Abschnitt 4).

## Konten

Konten und Schlüssel legst du selbst an und trägst sie direkt bei den Anbietern ein. In Dranzeit kommt nur der
Zugangsschlüssel aus `deploy/README.md` („Telefon-Assistent“).

| Anbieter | Wofür | Stand (26.10.2026) | Kosten (vor dem Kauf prüfen) |
|---|---|---|---|
| [Vapi](https://vapi.ai/) | Gesprächsführung, ruft unsere Werkzeuge auf; Spracherkennung, Sprachmodell und Stimme wählst du dort je Assistent | Konto vorhanden, etwas Guthaben; Vertrag zur Auftragsverarbeitung noch abschließen | etwa 0,05 $ pro Minute plus Spracherkennung, Sprachmodell und Stimme; Vapi zeigt je Assistent eine Schätzung pro Minute |
| [Vonage](https://www.vonage.de/) | Berliner Nummer (030), über die Anrufe ankommen | in Vapi eingebunden (Integrations → Vonage) | Nummer und eingehende Minuten laut Vonage-Tarif |
| [ElevenLabs](https://elevenlabs.io/) (optional, Vergleich) | zweite Plattform mit denselben Werkzeugen | – | etwa 0,08 $ pro Minute plus Sprachmodell |
| [Twilio](https://www.twilio.com/) (nur für ElevenLabs) | Nummer für ElevenLabs, das Vonage-Nummern nur über ein eigenes Verbindungsprogramm annimmt | Testkonto ohne Nummer; für eine Berliner Nummer „Upgrade“ und ein Regulatory Bundle mit Handelsregisterauszug | Nummer wenige Euro im Monat |

## 1. Dranzeit vorbereiten

1. **Zugangsschlüssel erzeugen:** Block „Telefon-Assistent“ in `deploy/README.md` ausführen. Der Schlüssel liegt
   danach in der Zwischenablage.
2. **Laden wählen:** Am besten der eigene ITEBV-Laden, damit die Probebuchungen nicht bei einem Kunden landen.
   Für einen Laden mit leeren Leistungen oder ohne Team gibt der Assistent nichts Sinnvolles aus. Die
   Probetermine hinterher in „Mein Tag“ absagen.
3. **Rufnummer zuordnen:** Im Betreiber-Bereich den Laden öffnen, Abschnitt „Telefon-Assistent“, und die Berliner
   Vonage-Nummer eintragen. Die Schreibweise ist egal (`030 …` oder `+49 30 …`).
4. **Laden-ID notieren:** Sie steht im Betreiber-Bereich in der Kopfzeile des Ladens („Laden … · ID“). Die
   Werkzeuge schicken sie mit, damit die Probe auch ohne Telefon im Browser klappt.

## 2. Systemanweisung (für beide Plattformen)

```text
Du bist der KI-Assistent eines Friseursalons bzw. Barbershops am Telefon. Kunden rufen an, wenn im Laden gerade niemand abnimmt.

Ablauf
1. Rufe zuerst das Werkzeug laden_info auf. Es liefert Name des Ladens, Datum und Uhrzeit, Adresse, Öffnungszeiten, Leistungen mit Preisen und Dauer und das Team. Erfinde nichts, was dort nicht steht. Für Datum und Uhrzeit gilt nur, was laden_info sagt.
2. Finde heraus, was der Anrufer möchte: einen Termin, eine Nummer für heute (ohne Termin vorbeikommen, Schlange) oder eine Auskunft.
3. Termin: Frage nach der Leistung, ob er zu jemand Bestimmtem möchte und wann es ihm passt. Rufe freie_zeiten auf und nenne höchstens drei Zeiten. Sagt er zu, frage nach seinem Namen, wiederhole Tag, Uhrzeit, Leistung und Person und rufe erst nach einem klaren Ja buchen auf. Gib dabei den Wert "platz" genau so weiter, wie freie_zeiten ihn geliefert hat.
4. Wartezeit oder Nummer: Rufe wartezeit auf. Möchte er eine Nummer, frage nach seinem Namen und rufe nummer_ziehen auf. Nenne die Nummer und die ungefähre Zeit und bitte ihn, rechtzeitig da zu sein.
5. Jede Werkzeug-Antwort hat "ok" und "ansage". Antworte auf Grundlage von "ansage". Bei ok = false erkläre kurz, woran es liegt, und biete die Alternativen aus der Antwort an.
6. Kannst du nicht helfen (Beschwerde, Sonderwunsch, der Anrufer möchte einen Menschen sprechen): Sag, dass gerade niemand frei ist, und dass er es später noch einmal versuchen oder online buchen kann.

Regeln
- Sprich kurz und freundlich, höchstens zwei Sätze am Stück. Sieze den Anrufer, außer er duzt dich.
- Sprich in der Sprache des Anrufers.
- Nenne Uhrzeiten so: "14:30 Uhr". Lies nie IDs, Kennungen oder Werte wie "platz" vor.
- Buche nie ohne ausdrückliche Zusage und ohne Namen.
- Gib nur Auskünfte zum Laden, keine Ratschläge zu anderen Themen.
```

**Erste Nachricht** (den Namen des Ladens direkt hineinschreiben):

> Hallo, hier ist der KI-Assistent von ITEBV Barbershop. Wie kann ich helfen?

Wichtig: Der Assistent nennt sich gleich im ersten Satz KI-Assistent (Art. 50 Abs. 1 KI-Verordnung). Er gibt sich
nie als Mensch oder als eine andere Firma aus.

## 3. Einrichtung bei Vapi

Die Bezeichnungen stammen aus der Vapi-Dokumentation und können in der Oberfläche leicht abweichen.

### Zugangsschlüssel als Credential

„Integrations“ → „Server Configuration“ → „Add Custom Credential“:

- Authentication Type: **Bearer Token**
- Credential Name: `Dranzeit Telefon`
- Token: den Zugangsschlüssel aus der Zwischenablage einfügen, danach etwas anderes kopieren
- Header Name: `Authorization`
- Include Bearer Prefix: an

### Fünf Werkzeuge (Typ „API Request“)

„Tools“ → „Create Tool“ → **API Request**. Für jedes Werkzeug gilt:

- **Request HTTP Method:** POST
- **Authorization → Credential:** `Dranzeit Telefon`. Keine eigene Kopfzeile `Authorization` anlegen.
- **Static Body Fields** (füllt Vapi, das Modell sieht sie nicht):

  | Key | Value |
  |---|---|
  | `angerufen` | `{{ phoneNumber.number }}` |
  | `laden_id` | die Laden-ID aus Schritt 1 |

- **Request Body:** das JSON-Schema aus der Tabelle unten, mit „Lock schema“ (keine weiteren Felder). Diese Felder
  füllt das Modell.

| Name | Request URL | Beschreibung |
|---|---|---|
| `laden_info` | `https://dranzeit.de/routes/telefon/laden` | Zu Beginn jedes Gesprächs aufrufen: Name des Ladens, Datum, Adresse, Öffnungszeiten, Leistungen, Preise, Team. |
| `freie_zeiten` | `https://dranzeit.de/routes/telefon/freie-zeiten` | Freie Termine für eine Leistung suchen, auf Wunsch bei einer Person und ab einem Zeitpunkt. |
| `buchen` | `https://dranzeit.de/routes/telefon/buchen` | Einen Termin verbindlich buchen, erst nach ausdrücklicher Zusage. |
| `wartezeit` | `https://dranzeit.de/routes/telefon/wartezeit` | Wie lange man heute ohne Termin warten muss. |
| `nummer_ziehen` | `https://dranzeit.de/routes/telefon/nummer` | Eine Nummer für die Schlange von heute ziehen. |

Zusätzliche Static Body Fields:

- `freie_zeiten`: `anzahl` = `3`
- `buchen` und `nummer_ziehen`: `anrufer` = `{{ customer.number }}`. So steht die Nummer des Anrufers am Termin.

**Request Body je Werkzeug:**

`laden_info`:

```json
{ "type": "object", "properties": {}, "additionalProperties": false }
```

`freie_zeiten`:

```json
{
  "type": "object",
  "properties": {
    "leistung": { "type": "string", "description": "Name der Leistung, wie laden_info sie nennt" },
    "person": { "type": "string", "description": "Name der Wunschperson; leer lassen, wenn egal" },
    "ab": { "type": "string", "description": "Frühester Zeitpunkt als JJJJ-MM-TT oder JJJJ-MM-TTTHH:MM; leer lassen = ab jetzt" }
  },
  "required": ["leistung"],
  "additionalProperties": false
}
```

`buchen`:

```json
{
  "type": "object",
  "properties": {
    "leistung": { "type": "string", "description": "Name der Leistung, wie laden_info sie nennt" },
    "platz": { "type": "string", "description": "Wert platz aus freie_zeiten, unverändert übernehmen" },
    "name": { "type": "string", "description": "Name des Anrufers" }
  },
  "required": ["leistung", "platz", "name"],
  "additionalProperties": false
}
```

`wartezeit`:

```json
{
  "type": "object",
  "properties": {
    "leistung": { "type": "string", "description": "Name der Leistung; leer lassen, wenn nicht genannt" },
    "person": { "type": "string", "description": "Name der Wunschperson; leer lassen, wenn egal" }
  },
  "additionalProperties": false
}
```

`nummer_ziehen`:

```json
{
  "type": "object",
  "properties": {
    "leistung": { "type": "string", "description": "Name der Leistung, wie laden_info sie nennt" },
    "person": { "type": "string", "description": "Name der Wunschperson; leer lassen, wenn egal" },
    "name": { "type": "string", "description": "Name des Anrufers" }
  },
  "required": ["leistung", "name"],
  "additionalProperties": false
}
```

### Assistent

Einen **neuen** Assistenten anlegen, z. B. `Dranzeit Probe`, und keinen alten weiterverwenden:

- **First Message:** wie in Abschnitt 2, Modus „Assistant speaks first“.
- **System Prompt:** die Systemanweisung aus Abschnitt 2.
- **Tools:** die fünf Werkzeuge anhängen.
- **Transcriber:**
  - Deutsch, z. B. Deepgram Nova (Sprache Deutsch) oder Whisper mit Deutsch.
  - Für den Sprachwechsel zusätzlich eine mehrsprachige Einstellung (Deepgram „multi“) testen.
- **Model:**
  - ein schnelles Modell, z. B. GPT-4.1 mini oder Claude Haiku.
  - Im Probelauf auch ein größeres zum Vergleich testen.
- **Voice:**
  - eine deutsche Stimme mit kurzer Antwortzeit, z. B. ElevenLabs „Flash“ bzw. „Turbo“ (mehrsprachig).
  - Die Stimme „Sarah“ (ElevenLabs Multilingual v2) aus deinem früheren Test klingt gut, ist aber langsamer.
- **Datenschutz (Advanced):**
  - Gesprächsaufnahme ausschalten.
  - Für die Auswertung des Probelaufs reichen Abschriften und Logs.

### Nummer

„Phone Numbers“ → Berliner Vonage-Nummer → „Inbound Settings“ → **Assistant**: `Dranzeit Probe`.

Dort hängt bisher ein früherer Test-Assistent. Er wird damit abgelöst.

### Probe

1. **Im Browser:** Mit „Talk“ beim Assistenten probieren. Dabei kommt keine Rufnummer an, deshalb gilt die
   Laden-ID.
2. **Am Telefon:** Von einem Handy die Berliner Nummer anrufen.
3. **Mit Umleitung:** Am Handy „bei Nichtmelden“ auf die Berliner Nummer umleiten, mit `**61*<Nummer>**20#`. Dann
   das Handy anrufen und nicht abnehmen. So läuft es später bei einem Salon.

**Prüfen:**
- Unter „Logs“ steht je Anruf, welche Werkzeuge aufgerufen wurden, mit Antworten und Kosten.
- Gebuchte Termine stehen in „Mein Tag“, gezogene Nummern in der Schlange am Tresen.

## 4. Zum Vergleich: ElevenLabs Agents

Gleiche Systemanweisung und gleiche Werkzeuge. Unterschiede:

- **Erste Nachricht:** wie in Abschnitt 2.
- **Dynamische Variable** `laden_id` mit der Laden-ID als Standardwert anlegen.
- **Geheimnis:** Unter „Secrets“ ein Geheimnis `dranzeit_telefon` mit dem Zugangsschlüssel anlegen.
- **Werkzeuge:** Typ „Webhook“/Server-Tool, Methode POST, Kopfzeile `Authorization`, Typ Geheimnis, Wert
  `dranzeit_telefon`.
- **Felder statt der Static Body Fields:**
  - `angerufen`: dynamische Variable `system__called_number`
  - `laden_id`: dynamische Variable `laden_id`
  - `anrufer` (bei `buchen` und `nummer_ziehen`): `system__caller_id`

  Die übrigen Felder füllt das Modell, mit denselben Beschreibungen wie oben.
- **Sprache:**
  - Hauptsprache Deutsch, dazu Englisch, Türkisch, Arabisch.
  - Automatische Spracherkennung an.
  - Speicherung der Gesprächsaufnahme aus.
- **Nummer:** ElevenLabs nimmt Twilio-Nummern direkt („Phone Numbers“ → „Import from Twilio“, Account SID und Auth
  Token gibst du nur dort ein). Vonage-Nummern gehen nur über ein eigenes Verbindungsprogramm. Für den Vergleich reicht
  die Probe im Browser („Test AI agent“).

## 5. Testanrufe und was du notierst

| # | Anruf | Erwartet |
|---|---|---|
| 1 | „Ich hätte gern morgen Nachmittag einen Herrenschnitt.“ | drei Zeiten, Buchung nach Zusage, Termin in „Mein Tag“ mit Name und Nummer |
| 2 | Wunschperson nennen, die es nicht gibt | Assistent nennt das Team |
| 3 | Zwei Anrufe, beide wollen dieselbe Zeit | nur einer bekommt sie, der andere eine Alternative |
| 4 | „Wie lange muss ich gerade warten?“ und dann eine Nummer ziehen | Wartezeit wie auf der Nummernseite, Nummer in der Schlange |
| 5 | Frage nach Preis und Öffnungszeit | richtig aus den Ladendaten |
| 6 | Frage nach etwas, das nicht in Dranzeit steht (Parken, Kartenzahlung) | sagt, dass er es nicht weiß, und erfindet nichts |
| 7 | Anruf auf Englisch oder Türkisch | Gespräch in der Sprache, Buchung richtig |
| 8 | Dem Assistenten ins Wort fallen, schnell sprechen, Hintergrundlärm | reagiert sinnvoll |
| 9 | Mit unterdrückter Nummer anrufen | Buchung klappt, ohne Telefonnummer am Termin |
| 10 | „Ich will mit einem Menschen sprechen.“ | höflicher Hinweis |

Zu jedem Anruf notierst du:

- Dauer
- Wartezeit bis zur ersten Antwort und nach einer Frage (gefühlt oder aus den Logs)
- ob alles richtig gebucht wurde
- Kosten aus den Logs bei Vapi (bzw. ElevenLabs) und beim Telefonanbieter

Danach entscheiden wir über den Anbieter und die Preise (siehe „Offen“ in der Anforderung).

## Was noch fehlt (kommt nach dem Probelauf)

- Rückrufbitte und Durchstellen aufs Handy, SMS-Bestätigung
- Anrufliste im Dashboard, Kennzeichen „per Telefon“ in der Oberfläche
- Zubuchen im Tarif, Abrechnung nach Minuten, Kostendeckel und Ansage ohne KI
- Begrüßung mit dem richtigen Ladennamen bei mehreren Läden: Vapi und ElevenLabs können vor dem Gespräch eine
  Adresse aufrufen, die den Assistenten mit den Daten des Ladens liefert. Das bauen wir, sobald die Plattform feststeht.
