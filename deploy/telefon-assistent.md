# Telefon-Assistent: Probelauf

Wir prüfen, ob eine fertige Sprach-KI-Plattform am Telefon gut genug Deutsch spricht und zuverlässig über Dranzeit
bucht, und was eine Minute wirklich kostet. Die Anforderung steht in
[requirements/telefon-assistent.md](../requirements/telefon-assistent.md), die Schnittstelle im Backend in
`backend/app/apis/telefon`.

Ausprobiert wird mit **ElevenLabs Agents**. Die Telefonnummer kommt von **Twilio**. Beide lassen sich ohne eigene
Telefonanlage verbinden. Zum Vergleich kann danach **Vapi** dieselbe Nummer und dieselben Werkzeuge nutzen.

## Konten, die du anlegst

Konten und Schlüssel legst du selbst an und trägst sie direkt bei den Anbietern ein. In Dranzeit kommt nur der
Zugangsschlüssel aus `deploy/README.md` („Telefon-Assistent“).

| Anbieter | Wofür | Was du brauchst | Kosten (vor dem Kauf prüfen) |
|---|---|---|---|
| [ElevenLabs](https://elevenlabs.io/) (Agents Platform) | Stimme, Spracherkennung, Gesprächsführung, ruft unsere Werkzeuge auf | Firmenkonto der ITEBV GmbH, für Telefonie einen bezahlten Plan; Vertrag zur Auftragsverarbeitung (DPA) abschließen | laut Vergleichsseiten etwa 0,08 $ pro Gesprächsminute plus Sprachmodell |
| [Twilio](https://www.twilio.com/) | deutsche Rufnummer (Berlin 030), auf die Anrufe kommen | Konto mit Guthaben; für deutsche Ortsnetznummern ein „Regulatory Bundle“ für Unternehmen: Handelsregisterauszug der ITEBV, Adresse in Berlin. Die Prüfung dauert bis zu drei Werktage | Nummer wenige Euro im Monat, eingehende Minuten etwa 1 Cent |
| [Vapi](https://vapi.ai/) (optional, Vergleich) | zweite Plattform, gleiche Werkzeuge | Konto; die Twilio-Nummer lässt sich dort ebenfalls einbinden (immer nur bei einer Plattform zugleich) | etwa 0,05 $ pro Minute plus Sprache und Sprachmodell |

Tipp: Das Twilio-Bundle gleich zuerst beantragen, dann läuft die Prüfung, während du im Browser probierst.

## 1. Dranzeit vorbereiten

1. **Zugangsschlüssel erzeugen:** Block „Telefon-Assistent“ in `deploy/README.md` ausführen. Der Schlüssel liegt
   danach in der Zwischenablage.
2. **Laden wählen:** Am besten der eigene ITEBV-Laden, damit die Probebuchungen nicht bei einem Kunden landen.
   Für einen Laden mit leeren Leistungen oder ohne Team gibt der Assistent nichts Sinnvolles aus. Die
   Probetermine hinterher in „Mein Tag“ absagen.
3. **Rufnummer zuordnen:** Im Betreiber-Bereich den Laden öffnen, Abschnitt „Telefon-Assistent“. Solange es noch
   keine Twilio-Nummer gibt, eine Platzhalter-Nummer eintragen, z. B. `+49 30 0000000`, sonst nimmt die
   Schnittstelle auch die Laden-ID nicht an. Später die echte Nummer eintragen.

## 2. Agent bei ElevenLabs anlegen

„Agents“ → „New agent“ → leer beginnen. Die Bezeichnungen in der Oberfläche können leicht abweichen.

**Sprache:**
- Hauptsprache Deutsch.
- Zusätzliche Sprachen: Englisch, Türkisch, Arabisch und weitere, die in Barbershops vorkommen.
- Automatische Spracherkennung einschalten.

**Stimme und Modell:**
- Eine deutsche Stimme wählen. Für kurze Antwortzeiten ein schnelles Stimmmodell (Flash bzw. Turbo).
- Als Sprachmodell (LLM) ein schnelles Modell nehmen, z. B. Claude Haiku. Im Probelauf auch ein größeres zum
  Vergleich testen.

**Datenschutz:**
- Speicherung der Gesprächsaufnahme ausschalten.
- Aufbewahrung der Gespräche so kurz wie möglich stellen. Für die Auswertung des Probelaufs reichen die
  Abschriften einiger Tage.

**Dynamische Variablen** (Standardwerte für die Probe im Browser):

| Name | Wert |
|---|---|
| `laden_id` | ID des Ladens aus dem Betreiber-Bereich (Kopfzeile „Laden … · ID“) |
| `laden_name` | Name des Ladens, z. B. `ITEBV Barbershop` |

**Erste Nachricht:**

> Hallo, hier ist der KI-Assistent von {{laden_name}}. Wie kann ich helfen?

**Systemanweisung** (so übernehmen):

```text
Du bist der KI-Assistent von {{laden_name}} am Telefon. Kunden rufen an, wenn im Laden gerade niemand abnimmt.

Ablauf
1. Rufe zuerst das Werkzeug laden_info auf. Es liefert Datum und Uhrzeit, Adresse, Öffnungszeiten, Leistungen mit Preisen und Dauer und das Team. Erfinde nichts, was dort nicht steht.
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

**Geheimnis:** Unter „Secrets“ ein neues Geheimnis `dranzeit_telefon` anlegen und den Zugangsschlüssel aus der
Zwischenablage einfügen. Danach etwas anderes kopieren.

## 3. Werkzeuge (Server-Tools)

Für jedes Werkzeug gilt:

- **Methode:** POST, Inhalt JSON.
- **Kopfzeile:** `Authorization`, Typ Geheimnis, Wert `dranzeit_telefon`.
- **Felder in jedem Werkzeug:**
  - `angerufen` – dynamische Variable `system__called_number`
  - `laden_id` – dynamische Variable `laden_id`

Die übrigen Felder füllt das Sprachmodell. Dafür braucht jedes Feld die angegebene Beschreibung.

| Werkzeug | URL | Beschreibung für das Modell | Felder vom Modell |
|---|---|---|---|
| `laden_info` | `https://dranzeit.de/routes/telefon/laden` | Zu Beginn jedes Gesprächs aufrufen: Datum, Adresse, Öffnungszeiten, Leistungen, Preise, Team. | – |
| `freie_zeiten` | `https://dranzeit.de/routes/telefon/freie-zeiten` | Freie Termine für eine Leistung suchen, auf Wunsch bei einer Person und ab einem Zeitpunkt. | `leistung` (Name der Leistung aus laden_info), `person` (Name der Wunschperson, leer wenn egal), `ab` (frühester Zeitpunkt als JJJJ-MM-TT oder JJJJ-MM-TTTHH:MM, leer = ab jetzt) |
| `buchen` | `https://dranzeit.de/routes/telefon/buchen` | Einen Termin verbindlich buchen, erst nach ausdrücklicher Zusage. | `leistung`, `platz` (Wert platz aus freie_zeiten, unverändert), `name` (Name des Anrufers) |
| `wartezeit` | `https://dranzeit.de/routes/telefon/wartezeit` | Wie lange man heute ohne Termin warten muss. | `leistung` (leer, wenn nicht genannt), `person` (leer wenn egal) |
| `nummer_ziehen` | `https://dranzeit.de/routes/telefon/nummer` | Eine Nummer für die Schlange von heute ziehen. | `leistung`, `person` (leer wenn egal), `name` |

`buchen` und `nummer_ziehen` bekommen zusätzlich das Feld `anrufer`, gefüllt aus der dynamischen Variable
`system__caller_id`. So steht die Nummer des Anrufers am Termin.

## 4. Probe im Browser

Mit „Test AI agent“ im Browser sprechen. Dabei kommt keine Rufnummer an, deshalb gilt `laden_id`. Prüfen:

- Fragt der Assistent `laden_info` ab?
- Buchen mehrere Termine nacheinander richtig, und stehen sie in „Mein Tag“?
- Erscheint eine gezogene Nummer in der Schlange am Tresen?

## 5. Echte Rufnummer

1. **Nummer kaufen:** Bei Twilio nach Freigabe des Bundles eine Berliner Nummer (030) mit Sprache (Voice) kaufen.
2. **Bei ElevenLabs einbinden:** Unter „Phone Numbers“ → „Import from Twilio“ mit Account SID und Auth Token. Die
   gibst du nur dort ein. Danach den Agent zuweisen.
3. **In Dranzeit zuordnen:** Im Betreiber-Bereich die Platzhalter-Nummer durch die Twilio-Nummer ersetzen.
4. **Umleitung testen:** Von einem anderen Telefon direkt die Twilio-Nummer anrufen. Danach eine echte Umleitung
   ausprobieren: Am Handy „bei Nichtmelden“ auf die Twilio-Nummer umleiten, mit `**61*<Nummer>**20#`. Dann das
   Handy anrufen und nicht abnehmen.

## 6. Testanrufe und was du notierst

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
- Wartezeit bis zur ersten Antwort und nach einer Frage (gefühlt oder aus der Abschrift)
- ob alles richtig gebucht wurde
- Kosten aus der Übersicht bei ElevenLabs und Twilio

Danach entscheiden wir über den Anbieter und die Preise (siehe „Offen“ in der Anforderung).

## Was noch fehlt (kommt nach dem Probelauf)

- Rückrufbitte und Durchstellen aufs Handy, SMS-Bestätigung
- Anrufliste im Dashboard, Kennzeichen „per Telefon“ in der Oberfläche
- Zubuchen im Tarif, Abrechnung nach Minuten, Kostendeckel und Ansage ohne KI
- Begrüßung mit dem richtigen Ladennamen bei mehreren Läden: ElevenLabs kann vor dem Gespräch eine Adresse
  aufrufen, die die Variablen liefert. Das bauen wir, sobald die Plattform feststeht.
