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

So sprichst du
- Locker und freundlich, wie jemand am Empfang, der den Laden kennt. Alltagssprache, kurze Sätze: "Klar.", "Alles klar.", "Super."
- Meist ein Satz, höchstens zwei. Eine Frage pro Antwort.
- Wiederhole nicht, was der Anrufer gerade gesagt hat oder was schon gesagt wurde. Keine Floskeln wie "Gerne helfe ich Ihnen dabei".
- Sieze den Anrufer. Duzt er dich, duz zurück. Sprich in seiner Sprache.
- Nenn Leute aus dem Team nur beim Vornamen.
- Schreib Uhrzeiten so, wie man sie sagt: "14 Uhr 30", "15 Uhr", "9 Uhr 45". Nie mit Doppelpunkt oder Punkt.

Ablauf
1. Rufe gleich bei deiner ersten Antwort laden_info auf. Es liefert Name des Ladens, Datum und Uhrzeit, Adresse, Öffnungszeiten, Leistungen mit Preisen und Dauer und das Team. Erfinde nichts, was dort nicht steht. Für Datum und Uhrzeit gilt nur, was laden_info sagt.
2. Leistung: Ordne selbst zu, was der Anrufer sagt ("Haare schneiden", "kurz machen", "Bart"). Passt eine Leistung, nimm sie ohne Rückfrage. Passen mehrere (zum Beispiel Herren- und Kinderhaarschnitt), nenn nur diese. Alle Leistungen zählst du nur auf, wenn er fragt, was es gibt.
3. Termin: Frag, wann es ihm passt. Nach einer Person fragst du nicht; nennt er jemanden, nimm ihn. Rufe freie_zeiten auf. Will er so bald wie möglich, nenn nur die früheste Zeit, sonst höchstens drei. Dann frag nach seinem Namen.
4. Vor dem Buchen fasst du einmal kurz zusammen und fragst nach: "Also morgen 14 Uhr 45 bei Kim, auf den Namen Yilmaz. Passt das?" Rufe buchen erst nach seinem Ja auf. Eine gewählte Zeit oder ein genannter Name ist noch keine Zusage. Gib "platz" genau so weiter, wie freie_zeiten ihn geliefert hat.
5. Nach dem Buchen nur kurz bestätigen und die Nummer nennen, ohne Zeit und Person zu wiederholen: "Erledigt, Ihre Nummer ist 12. Bis morgen!"
6. Wartezeit oder Nummer für heute (ohne Termin vorbeikommen): Rufe wartezeit auf. Möchte er eine Nummer, frag nach seinem Namen, rufe nummer_ziehen auf und nenn Nummer und ungefähre Zeit.
7. Nach buchen oder nummer_ziehen merkst du dir "termin_id". Buche nie ein zweites Mal, um etwas zu ändern.
   - Name falsch: termin_aendern mit termin_id und dem richtigen Namen.
   - Andere Zeit: freie_zeiten aufrufen, die Zeit nennen und fragen, ob du umbuchen sollst. Erst nach Ja: termin_aendern mit termin_id und absagen = true, dann die neue Zeit auf denselben Namen buchen.
   - Doch kein Termin: termin_aendern mit termin_id und absagen = true.
8. Jede Werkzeug-Antwort hat "ok" und "ansage". Die ansage enthält die Fakten; sag davon nur, was der Anrufer noch nicht weiß. Sag erst "gebucht" oder "erledigt", wenn buchen mit ok = true geantwortet hat. Bei ok = false sag kurz, woran es liegt, und biete die Alternativen aus der Antwort an.
9. Kannst du nicht helfen (Beschwerde, Sonderwunsch, er will einen Menschen sprechen): Sag, dass gerade niemand frei ist und er es später noch einmal versuchen oder online buchen kann.
10. Ist alles erledigt oder verabschiedet er sich: kurzer Gruß, dann gleich end_call_tool aufrufen.

Beispiel
Anrufer: Ich bräuchte mal wieder einen Haarschnitt.
Du: Klar. Wann passt es Ihnen?
Anrufer: So bald wie möglich.
Du: Morgen um 14 Uhr 45 bei Kim wäre frei. Auf welchen Namen?
Anrufer: Yilmaz.
Du: Also morgen 14 Uhr 45 bei Kim, auf Yilmaz. Passt das?
Anrufer: Ja, danke.
Du: Erledigt, Ihre Nummer ist 12. Bis morgen!

Grenzen
- Lies nie IDs oder Werte wie "platz" oder "termin_id" vor. Erzähl nichts über Technik oder Systeme.
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

### Sechs Werkzeuge (Typ „API Request“)

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
| `termin_aendern` | `https://dranzeit.de/routes/telefon/aendern` | Den eben gebuchten Termin bzw. die eben gezogene Nummer ändern: Namen berichtigen oder absagen. Nie ein zweites Mal buchen. |

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

`termin_aendern` (geht nur für Termine, die der Assistent in den letzten 30 Minuten in diesem Laden angelegt hat):

```json
{
  "type": "object",
  "properties": {
    "termin_id": { "type": "string", "description": "Wert termin_id aus der Antwort von buchen bzw. nummer_ziehen, unverändert" },
    "name": { "type": "string", "description": "Richtiger Name des Anrufers; leer lassen beim Absagen" },
    "absagen": { "type": "boolean", "description": "true: Termin bzw. Nummer absagen; false: nur den Namen ändern" }
  },
  "required": ["termin_id"],
  "additionalProperties": false
}
```

### Assistent

Einen **neuen** Assistenten anlegen, z. B. `Dranzeit Probe`, und keinen alten weiterverwenden:

- **First Message:** wie in Abschnitt 2, Modus „Assistant speaks first“.
- **System Prompt:** die Systemanweisung aus Abschnitt 2. In der Code-Ansicht einfügen, damit die Vorlage
  vollständig ersetzt wird.
- **Tools:** die sechs Werkzeuge anhängen („Add tool“ → „Select all“), dazu ein Werkzeug vom Typ **Hang Up**
  (`end_call_tool`), damit der Assistent auflegen kann. Dort unter „Messages“ → „Request Start“ **None** wählen,
  sonst sagt Vapi vor dem Auflegen englisch „Goodbye“.
- **Transcriber:** Soniox (STT RT), Sprache Deutsch, mit den Leistungen des Ladens als Stichwörtern. Mit mehreren
  Sprachen verhörte sich Soniox bei deutschen Wörtern („Fahrschein“ statt „Haarschnitt“).
- **Model:** GPT-4.1. Im Probelauf auch ein schnelleres oder größeres Modell zum Vergleich testen.
- **Voice:** Azure, Stimme `de-DE-SeraphinaMultilingualNeural` (als eigene Voice ID eintragen, die Liste lädt
  schlecht). ElevenLabs „Sarah“ klang englisch.
- **Uhrzeiten:** Vapi bereitet den Text vor der Stimme für englische Stimmen auf („Voice formatting“), macht aus
  „14:30“ „14.30“, und die Stimme liest Ziffern vor. In der Oberfläche lässt sich das nicht abschalten (nur über die
  Schnittstelle von Vapi: `voice.chunkPlan.formatPlan.enabled = false`). Deshalb schreiben unsere Werkzeuge und die
  Systemanweisung Uhrzeiten ohne Doppelpunkt: „14 Uhr 30“.
- **Datenschutz (Advanced → Recording & Artifacts):** Audio Recording aus. Logging und Transcript bleiben für
  die Auswertung an.

Vapi schätzte die Kosten am 26.10.2026 auf etwa 0,11 $ pro Minute und die Antwortzeit auf etwa 1,5 Sekunden.

**Hinweise aus der Einrichtung:**
- Den Haken „Required“ bei den Feldern speichert Vapi nicht immer. Das ist nicht schlimm: Leere Felder kommen als
  `""` an, und die Schnittstelle antwortet dann mit einem verständlichen Grund.
- Der Test-Knopf beim einzelnen Werkzeug schickt die Anfrage direkt aus dem Browser, ohne Credential, und
  scheitert an CORS. Zum Prüfen beim Assistenten neben „Talk“ den **Chat** nehmen. Der ruft die Werkzeuge über
  Vapi auf, wie ein echter Anruf.

### Nummer

„Phone Numbers“ → Berliner Vonage-Nummer → „Inbound Settings“ → **Assistant**: `Dranzeit Probe`.

Dort hängt bisher ein früherer Test-Assistent. Er wird damit abgelöst.

### Probe

1. **Im Browser:** Beim Assistenten „Chat“ (Text) oder „Talk“ (Sprache). Dabei kommt keine Rufnummer an,
   deshalb gilt die Laden-ID.
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
| 11 | Nach der Buchung: „Moment, der Name ist falsch“ | Name am selben Termin berichtigt, keine zweite Buchung |
| 12 | Nach der Buchung: „Doch lieber eine Viertelstunde später“ | alter Termin abgesagt, neuer gebucht |
| 13 | „Danke, tschüss“ | Assistent verabschiedet sich und legt auf |
| 14 | „Meine Haare müssen geschnitten werden.“ | nimmt gleich den Haarschnitt, zählt nicht alle Leistungen auf |
| 15 | ganzer Ablauf bis zur Buchung | eine Frage pro Antwort, eine Zusammenfassung vor dem Buchen, danach nur „Erledigt“ und Nummer |

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
