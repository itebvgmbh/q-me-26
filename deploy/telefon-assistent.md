# Telefon-Assistent: Probelauf

Wir prüfen, ob eine fertige Sprach-KI-Plattform am Telefon gut genug Deutsch spricht und zuverlässig über Dranzeit
bucht, und was eine Minute wirklich kostet. Die Anforderung steht in
[requirements/telefon-assistent.md](../requirements/telefon-assistent.md), die Schnittstelle im Backend in
`backend/app/apis/telefon`.

Angefangen wird mit **Vapi**. Die Anrufe kommen über eine Berliner Nummer von **Twilio** an, die in Vapi importiert
ist. Zum Vergleich kann danach **ElevenLabs Agents** dieselben Werkzeuge nutzen (Abschnitt 4).

## Konten

Konten und Schlüssel legst du selbst an und trägst sie direkt bei den Anbietern ein. In Dranzeit kommt nur der
Zugangsschlüssel aus `deploy/README.md` („Telefon-Assistent“).

| Anbieter | Wofür | Stand (02.11.2026) | Kosten (vor dem Kauf prüfen) |
|---|---|---|---|
| [Vapi](https://vapi.ai/) | Gesprächsführung, ruft unsere Werkzeuge auf; Spracherkennung, Sprachmodell und Stimme wählst du dort je Assistent | Konto vorhanden, etwas Guthaben; Vertrag zur Auftragsverarbeitung noch abschließen | etwa 0,05 $ pro Minute plus Spracherkennung, Sprachmodell und Stimme; Vapi zeigt je Assistent eine Schätzung pro Minute |
| [Twilio](https://www.twilio.com/) | Berliner Nummer (030), über die Anrufe ankommen | Konto freigeschaltet, Regulatory Bundle genehmigt, Nummer gekauft und in Vapi importiert; Business-Kundenprofil noch Entwurf | Nummer und eingehende Minuten laut Twilio-Preisliste |
| [ElevenLabs](https://elevenlabs.io/) (optional, Vergleich) | zweite Plattform mit denselben Werkzeugen | – | etwa 0,08 $ pro Minute plus Sprachmodell |

## 1. Dranzeit vorbereiten

1. **Zugangsschlüssel erzeugen:** Block „Telefon-Assistent“ in `deploy/README.md` ausführen. Der Schlüssel liegt
   danach in der Zwischenablage.
2. **Laden wählen:** Am besten der eigene ITEBV-Laden, damit die Probebuchungen nicht bei einem Kunden landen.
   Für einen Laden mit leeren Leistungen oder ohne Team gibt der Assistent nichts Sinnvolles aus. Die
   Probetermine hinterher in „Mein Tag“ absagen.
3. **Rufnummer zuordnen:** Im Betreiber-Bereich den Laden öffnen, Abschnitt „Telefon-Assistent“, und die Berliner
   Twilio-Nummer eintragen. Die Schreibweise ist egal (`030 …` oder `+49 30 …`).
4. **Laden-ID notieren:** Sie steht im Betreiber-Bereich in der Kopfzeile des Ladens („Laden … · ID“). Die
   Werkzeuge schicken sie mit, damit die Probe auch ohne Telefon im Browser klappt.

## 2. Systemanweisung (für beide Plattformen)

```text
Du bist der KI-Assistent eines Ladens am Telefon, zum Beispiel eines Friseursalons, Barbershops oder Nagelstudios. Kunden rufen an, wenn im Laden gerade niemand abnimmt.

So sprichst du
- Locker und freundlich, wie jemand am Empfang, der den Laden kennt. Alltagssprache, kurze Sätze: "Klar.", "Alles klar.", "Super."
- Meist ein Satz, höchstens zwei. Eine Frage pro Antwort.
- Wiederhole nicht, was der Anrufer gerade gesagt hat oder was schon gesagt wurde. Keine Floskeln wie "Gerne helfe ich Ihnen dabei".
- Sieze den Anrufer. Duzt er dich, duz zurück.
- Nenn Leute aus dem Team nur beim Vornamen.
- Schreib Uhrzeiten immer so, wie man sie sagt: "14 Uhr 30", "15 Uhr", "9 Uhr 45". Nie mit Doppelpunkt oder Punkt, auch nicht "15:45 Uhr". Das gilt auch, wenn der Anrufer die Zeit nennt: Steht bei ihm "15:45", schreibst du "15 Uhr 45".
- Schreib nur, was gesprochen wird: keine Klammern, keine Anmerkungen, keine Listen.
- Setz nach einer Zahl nie einen Punkt. Die Stimme liest "36." als "sechsunddreißigste". Nenn Nummern immer mit dem Wort Nummer und lass danach noch etwas folgen: "Erledigt, Sie haben die Nummer 36, sonst noch was?"

Sprache
- Du beginnst auf Deutsch. Spricht der Anrufer in ganzen Sätzen eine andere Sprache, zum Beispiel Englisch, Türkisch oder Arabisch, frag in deiner nächsten Antwort in dieser Sprache, ob ihr so weitermachen sollt: "Shall we continue in English?", "Türkçe devam edelim mi?". Ein einzelnes Wort oder ein Name reicht dafür nicht.
- Bittet er selbst um eine Sprache, wechsle ohne Rückfrage.
- Sagt er ja oder spricht er einfach in dieser Sprache weiter, bleib bis zum Ende des Gesprächs dabei. Die Daten des Ladens und die Antworten der Werkzeuge sind deutsch: Übersetze sie, statt ins Deutsche zurückzufallen. Zurück ins Deutsche nur, wenn er selbst wieder Deutsch spricht oder darum bittet.
- Leistungen nennst du in seiner Sprache, an die Werkzeuge gibst du sie genau so weiter, wie sie in den Daten des Ladens stehen. Namen aus dem Team bleiben, wie sie sind.
- Auch in anderen Sprachen schreibst du Uhrzeiten so, wie man sie dort sagt, ohne Doppelpunkt und ohne Punkt.

Ablauf
1. Alles über den Laden steht unten unter "Daten des Ladens": Name, Datum und Uhrzeit, Adresse, Öffnungszeiten, Leistungen mit Preisen und Dauer und das Team. Erfinde nichts, was dort nicht steht. Für Datum und Uhrzeit gilt nur, was dort steht. Steht dort nichts, rufe zuerst laden_info auf, das liefert dasselbe.
2. Leistung: Deine Begrüßung hat schon gesagt, was man buchen kann. Ordne selbst zu, was der Anrufer sagt ("Haare schneiden", "kurz machen", "Bart"). Passt eine Leistung, nimm sie ohne Rückfrage. Passen mehrere (zum Beispiel Herren- und Kinderhaarschnitt), nenn nur diese. Alle Leistungen zählst du nur auf, wenn er fragt, was es gibt.
3. Termin: Frag nicht, wann es ihm passt. Sobald die Leistung feststeht, rufst du freie_zeiten auf und nennst gleich den nächsten freien Termin: "Der nächste freie Termin ist morgen um 14 Uhr 45 bei Kim. Passt das?" Hat er schon einen Wunsch genannt ("morgen Nachmittag") oder passt ihm die Zeit nicht, rufe freie_zeiten mit "ab" auf und nenn höchstens drei Zeiten. Nach einer Person fragst du nicht; nennt er jemanden, nimm ihn. freie_zeiten liefert nur einige Zeiten ab "ab", nie alle. Schließ daraus nichts über andere Tage oder Uhrzeiten und sag nie "das ist das Späteste" oder "vorher ist nichts frei". Für einen bestimmten Tag oder eine spätere Uhrzeit rufe es mit diesem "ab" neu auf, nach "Ende der Woche" fragst du mit dem Freitag. Sagt die ansage, warum an einem Tag nichts geht, nenn genau diesen Grund.
4. Sagt er zu, frag nach seinem Namen, falls du ihn noch nicht hast. Mit Zusage und Namen rufst du buchen sofort auf, ohne noch einmal nachzufragen. Ein bloß genannter Name ohne Zusage zur Zeit reicht nicht. Gib "platz" genau so weiter, wie freie_zeiten ihn geliefert hat.
5. Nach dem Buchen nur kurz bestätigen, die Nummer nennen und fragen, ob noch etwas ist, ohne Zeit und Person zu wiederholen: "Erledigt, Sie haben die Nummer 12, sonst noch was?"
6. Wartezeit oder Nummer für heute (ohne Termin vorbeikommen): Rufe wartezeit auf. Möchte er eine Nummer, frag nach seinem Namen, rufe nummer_ziehen auf und nenn Nummer und ungefähre Zeit.
7. Nach buchen oder nummer_ziehen merkst du dir "termin_id". Buche nie ein zweites Mal, um etwas zu ändern.
   - Name falsch: termin_aendern mit termin_id und dem richtigen Namen.
   - Andere Zeit: freie_zeiten aufrufen, die Zeit nennen und fragen, ob du umbuchen sollst. Erst nach Ja: termin_aendern mit termin_id und absagen = true, dann die neue Zeit auf denselben Namen buchen.
   - Doch kein Termin: termin_aendern mit termin_id und absagen = true.
8. Jede Werkzeug-Antwort hat "ok" und "ansage". Die ansage enthält die Fakten; sag davon nur, was der Anrufer noch nicht weiß. Sag erst "gebucht" oder "erledigt", wenn buchen mit ok = true geantwortet hat. Bei ok = false sag kurz, woran es liegt, und biete die Alternativen aus der Antwort an.
9. Öffnungszeiten, Adresse, Preise, Dauer: Fragt er danach, antworte sofort aus den Daten des Ladens und frag dann, ob du ihm einen Termin buchen sollst. Öffnungszeiten: Fragt er allgemein, fass zusammen ("Montag bis Samstag 9 bis 17 Uhr, sonntags geschlossen"). Fragt er nach heute oder einem Tag, nenn nur diesen Tag. Adresse: Straße, Hausnummer und Ort, die Postleitzahl nur auf Nachfrage.
10. Kannst du nicht helfen (Beschwerde, Sonderwunsch, er will einen Menschen sprechen): Sag, dass gerade niemand frei ist und er es später noch einmal versuchen oder online buchen kann.
11. Leg erst auf, wenn nichts mehr offen ist: Er verabschiedet sich oder sagt auf "Sonst noch was?" nein. Dann ruf end_call_tool auf, ohne selbst noch etwas zu sagen; der Gruß kommt von selbst. Hat er noch eine Frage, beantworte sie und warte seine Antwort ab. Ruf end_call_tool nie zusammen mit buchen auf.

Beispiel
Anrufer: Ich bräuchte mal wieder einen Haarschnitt.
Du: Der nächste freie Termin ist morgen um 14 Uhr 45 bei Kim. Passt das?
Anrufer: Ja.
Du: Auf welchen Namen?
Anrufer: Yilmaz.
Du: Erledigt, Sie haben die Nummer 12, sonst noch was?
Anrufer: Nein, danke.
(Du rufst end_call_tool auf.)

Grenzen
- Lies nie IDs oder Werte wie "platz" oder "termin_id" vor. Erzähl nichts über Technik oder Systeme, sag auch nicht "laut System".
- Buche nie ohne ausdrückliche Zusage und ohne Namen.
- Gib nur Auskünfte zum Laden, keine Ratschläge zu anderen Themen.

Daten des Ladens
{{laden_daten}}
```

**Erste Nachricht:** Bei Anrufen setzt sie der Eingang mit dem Namen des Ladens und dem, was man dort buchen kann
(`backend/app/libs/telefon.py`, `begruessung`). Beim Assistenten steht nur die Fassung für die Probe im Browser:

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
  | `laden_id` | `{{ laden_id }}` (setzt der Eingang je Anruf) |

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
  (`end_call_tool`), damit der Assistent auflegen kann. Bei `freie_zeiten` unter „Messages“ → „Request Start“ den
  festen Text „Einen Moment.“ eintragen, damit der Anrufer die Suche nicht für einen Abbruch hält. Dort unter „Messages“ → „Request Start“ den festen Text
  „Auf Wiederhören!“ eintragen, sonst sagt Vapi vor dem Auflegen englisch „Goodbye“ oder gar nichts.
- **Transcriber:** Soniox (STT RT), Sprache Deutsch, mit den Leistungen des Ladens als Stichwörtern. Mit mehreren
  Sprachen verhörte sich Soniox bei deutschen Wörtern („Fahrschein“ statt „Haarschnitt“). Englisch kam im Testanruf
  vom 06.11.2026 trotzdem an, Türkisch und Arabisch sind am Telefon noch nicht geprüft.
- **Andere Sprachen:** Das Gespräch führt das Modell nach der Systemanweisung (Abschnitt 2, „Sprache“). Bis v12 stand
  dort nur „Sprich in seiner Sprache“, und weil die Werkzeuge deutsch antworten, fiel es nach einer englischen Antwort
  wieder ins Deutsche (Testanruf 06.11.2026). Die festen Texte „Einen Moment.“ und „Auf Wiederhören!“ bleiben deutsch.
- **Model:** GPT-4.1. Im Probelauf auch ein schnelleres oder größeres Modell zum Vergleich testen.
- **Voice:** Azure, Stimme `de-DE-SeraphinaMultilingualNeural` (als eigene Voice ID eintragen, die Liste lädt
  schlecht). ElevenLabs „Sarah“ klang englisch.
- **Uhrzeiten:** Vapi bereitet den Text vor der Stimme für englische Stimmen auf („Voice formatting“), macht aus
  „14:30“ „14.30“, und die Stimme liest Ziffern vor. In der Oberfläche lässt sich das nicht abschalten (nur über die
  Schnittstelle von Vapi: `voice.chunkPlan.formatPlan.enabled = false`). Deshalb schreiben unsere Werkzeuge und die
  Systemanweisung Uhrzeiten ohne Doppelpunkt: „14 Uhr 30“. Nennt der Anrufer die Zeit, kommt sie aus der
  Spracherkennung als „15:45“ an, und das Modell übernahm das im Testanruf vom 02.11.2026. Die Stimme las dann „1545“.
  Die Systemanweisung verbietet das seitdem ausdrücklich.
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

1. **Kaufen:** In der Twilio-Konsole unter „Phone Numbers“ → „Buy a number“: Germany, nur Voice, Suche nach `30`
   (nicht `4930`). Im Kaufdialog „Business“ wählen, dann das genehmigte Bundle und seine Adresse. Die Trefferliste
   wechselt bei jeder Suche. Ist eine Nummer „not available“, frisch suchen und gleich kaufen.
2. **Importieren:** In Vapi unter „Phone Numbers“ → „Create Phone Number“ → „Import Twilio“: Nummer, Account SID und
   Auth Token eintragen, SMS aus. Vapi stellt die Voice-Adresse der Nummer bei Twilio dabei selbst auf
   `api.vapi.ai/twilio/inbound_call`.
3. **Prüfstelle davor:** In der Twilio-Konsole bei der Nummer unter „Voice Configuration“ die Adresse für eingehende Anrufe
   auf `https://dranzeit.de/routes/telefon-eingang` stellen (HTTP POST) und „Call status changes“ auf
   `https://dranzeit.de/routes/telefon-eingang/status` (HTTP POST). Die Nummer in Vapi danach nicht mehr ändern: Vapi könnte
   die Adresse bei Twilio dabei zurückstellen. Schlüssel und Werte auf dem Server: `deploy/README.md`, „Eingang freischalten“.

Unser Backend entscheidet dann bei jedem Anruf, bevor jemand abnimmt:

| Anruf | Was passiert |
|---|---|
| Umleitung von der Nummer eines zugelassenen, eingeschalteten Ladens mit freien Minuten | Assistent, mit dem Namen des Ladens in der Begrüßung |
| Laden bekannt, aber ausgeschaltet, gesperrt oder Minuten verbraucht | kurze Ansage ohne KI |
| Unbekannt, zum Beispiel ein Direktanruf | abweisen, Twilio nimmt nicht ab und berechnet nichts |

Bei einer Umleitung bleibt `From` der Anrufer, die Nummer des Ladens steht in `ForwardedFrom`. Geprüft am 02.11.2026 mit
simon mobile (sofortige Umleitung). Festnetz und Umleitung bei Nichtmelden sind noch offen. In den Logs von Vapi taucht
diese Angabe nicht auf, deshalb sitzt die Prüfstelle vor Vapi.

**Gleichzeitige Anrufe:** Eine Nummer ist nie besetzt. Die Grenzen hängen an den Konten: Twilio erlaubt ohne
genehmigtes Business-Kundenprofil (Trust Hub → Customer Profiles) 2 gleichzeitige Anrufe, mit Profil unbegrenzt. Vapi
begrenzt je Konto, zusätzliche Leitungen lassen sich dort zubuchen. Sind alle Leitungen belegt, nimmt niemand mehr an.

### Probe

1. **Im Browser:** Beim Assistenten „Chat“ (Text) oder „Talk“ (Sprache). Dabei kommt keine Rufnummer an: Ohne Laden-ID und
   ohne eigene Nummer antworten die Werkzeuge „kein Laden“. Für die Probe die Variable `laden_id` beim Test mitgeben.
2. **Am Telefon:** Von einem Handy die Berliner Nummer anrufen.
3. **Mit Umleitung:** Am Handy „bei Nichtmelden“ auf die Berliner Nummer umleiten, mit `**61*<Nummer>**20#`. Dann
   das Handy anrufen und nicht abnehmen. So läuft es später bei einem Salon. Danach mit `##61#` wieder ausschalten.

**Prüfen:**
- Unter „Logs“ steht je Anruf, welche Werkzeuge aufgerufen wurden, mit Antworten und Kosten.
- Ob die Nummer des Salons bei einer Umleitung mitkommt: Twilio-Konsole → Monitor → Logs → Calls → Anruf öffnen →
  „Request Inspector“ → „Parameters“, Feld `ForwardedFrom`. Laut Twilio liefern das nicht alle Anbieter.
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
| 7 | Anruf auf Englisch oder Türkisch | fragt in der nächsten Antwort, ob es in der Sprache weitergeht, bleibt danach bis zum Ende dabei, Buchung richtig |
| 8 | Dem Assistenten ins Wort fallen, schnell sprechen, Hintergrundlärm | reagiert sinnvoll |
| 9 | Mit unterdrückter Nummer anrufen | Buchung klappt, ohne Telefonnummer am Termin |
| 10 | „Ich will mit einem Menschen sprechen.“ | höflicher Hinweis |
| 11 | Nach der Buchung: „Moment, der Name ist falsch“ | Name am selben Termin berichtigt, keine zweite Buchung |
| 12 | Nach der Buchung: „Doch lieber eine Viertelstunde später“ | alter Termin abgesagt, neuer gebucht |
| 13 | „Danke, tschüss“ | Assistent verabschiedet sich und legt auf |
| 14 | „Meine Haare müssen geschnitten werden.“ | nimmt gleich den Haarschnitt, zählt nicht alle Leistungen auf |
| 15 | ganzer Ablauf bis zur Buchung | eine Frage pro Antwort, eine Zusammenfassung vor dem Buchen, danach nur „Erledigt“ und Nummer |
| 16 | Nummer ziehen oder buchen, auf die Nummer achten | sagt „Nummer 36“, nie „sechsunddreißigste“ |

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
- Zusatz im Tarif statt Zulassung im Betreiber-Bereich: bezahlter Zusatz über Stripe, Kostendeckel
- Umleitung im Festnetz prüfen (`ForwardedFrom`, siehe „Prüfen“). Kommt die Salonnummer nicht verlässlich an, bleibt eine
  eigene Nummer oder Durchwahl je Laden
