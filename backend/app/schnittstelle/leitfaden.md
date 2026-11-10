Schnittstelle für die eigenen Programme eines Ladens oder Instituts: Praxis- und Kassensoftware, Webseite,
Buchungsformular. Dein Programm legt Kunden und Termine an, Dranzeit sorgt dafür, dass kein Platz doppelt vergeben wird,
und übernimmt, was Kunden bekommen: Erinnerungen, Nachrichten bei Verschiebung oder Absage, „Früher dran“-Angebote.

Ausprobieren: [Swagger](/api/v1/docs) · Nachlesen: [ReDoc](/api/v1/redoc) · Für Postman, Insomnia oder einen
Code-Generator: [`openapi.json`](/api/v1/openapi.json)

## Erste Schritte

1. **Laden einrichten** auf [dranzeit.de](https://dranzeit.de): Konto anlegen, Laden mit Öffnungszeiten, Personen
   (mit Arbeitszeiten) und Leistungen. Die API bucht in diese Zeiten. Die ersten 30 Tage laufen mit allen Funktionen,
   danach braucht die API mindestens den Tarif Solo.
2. **Schlüssel erzeugen** in Dranzeit unter *Laden → Schnittstelle (API)*. Er wird nur einmal angezeigt.
3. **Verbindung prüfen:**

   ```
   curl https://dranzeit.de/api/v1/laden -H "Authorization: Bearer $DRANZEIT_KEY"
   ```

4. **IDs holen:** `GET /leistungen` und `GET /personen`.
5. **Freie Zeit suchen und buchen:**

   ```
   curl "https://dranzeit.de/api/v1/freie-zeiten?leistung_id=LEISTUNG_ID&anzahl=3" \
     -H "Authorization: Bearer $DRANZEIT_KEY"

   curl -X POST https://dranzeit.de/api/v1/termine \
     -H "Authorization: Bearer $DRANZEIT_KEY" -H "Content-Type: application/json" \
     -d '{"leistung_id": "LEISTUNG_ID", "start": "2026-11-20T10:30:00+01:00",
          "kunde": {"name": "Alex Muster", "email": "alex@example.com"}, "frueher_dran": true}'
   ```

6. **Änderungen empfangen:** einen Webhook anlegen (Abschnitt „Webhooks“), dann erfährt dein Programm sofort, wenn ein
   Kunde nachrückt, absagt oder der Laden etwas ändert.

## Zugang

- Jede Anfrage schickt den Schlüssel als Kopfzeile `Authorization: Bearer dz_…`.
- Ein Schlüssel gilt für **genau einen Laden**. Wer mehrere Läden oder Institute anbindet, bekommt von jedem einen eigenen
  Schlüssel. IDs eines anderen Ladens beantwortet die API mit 404.
- Der Schlüssel gehört auf einen Server, nie in den Browser oder eine App: Wer ihn hat, kann für den Laden buchen und
  Kundendaten lesen. Der Inhaber kann ihn jederzeit widerrufen, dann kommt sofort 401.

## Grundregeln

- JSON in UTF-8. IDs sind Zeichenketten; bitte nichts in sie hineinlesen.
- **Zeiten** im Format ISO 8601 mit Zeitzone, z. B. `2026-11-20T10:30:00+01:00`. Ohne Zeitzone gilt deutsche Zeit
  (Europe/Berlin). Antworten kommen immer mit deutscher Zeitzone.
- Preise in Euro.
- Höchstens **120 Anfragen je Minute** und Schlüssel, danach 429 `zu_viele`.

## Kunden

- `POST /kunden` legt einen Eintrag in der Kundenliste des Ladens an. Gibt es die E-Mail (Groß-/Kleinschreibung egal)
  oder die Telefonnummer (Schreibweise egal) im Laden schon, kommt der vorhandene Eintrag zurück: **200 statt 201**.
- Beim Termin geht statt `kunde_id` auch `kunde` mit Name, E-Mail, Telefon. Dranzeit nimmt dann den vorhandenen
  Eintrag oder legt einen an, aber nur, wenn der Termin zustande kommt.
- Am besten speichert dein Programm die Dranzeit-`id` zum eigenen Kundendatensatz.

## Termine

- **Regeln** (`regeln`):
  - `online` (Standard): wie die Online-Buchung. Nur freie Plätze in Öffnungs- und Arbeitszeiten, ohne Pausen, mit der
    Vorlaufzeit des Ladens, nur bei Personen, die die Leistung anbieten. Ohne `person_id` nimmt Dranzeit die erste
    Person, bei der die Zeit frei ist. `GET /freie-zeiten` liefert genau diese Plätze.
  - `tresen`: wie im Kalender des Ladens. Jede Zeit, solange die Person dann frei ist, auch außerhalb der
    Öffnungszeiten. `person_id` ist Pflicht.
- Das Ende ergibt sich aus Dauer und Rüstzeit der Leistung.
- **Ein Platz geht nur einmal weg**, auch wenn im selben Moment online, am Tresen oder am Telefon gebucht wird. Ist er
  weg, kommt 409 `platz_weg`, bei `online` mit den nächsten freien Zeiten in `alternativen`.
- `status`: `geplant`, `laeuft` (aufgerufen), `fertig`, `abgesagt`. `art`: `termin` oder `nummer` (in Dranzeit
  gezogene Nummer der Warteschlange).
- **Verschieben und absagen** geht nur bei `geplant`, sonst 409 `nicht_offen`. Zweimal absagen ist kein Fehler.
  - `kunde_benachrichtigen` (Standard `true`): Dranzeit schickt dem Kunden die Nachricht über die Verschiebung oder
    Absage.
  - `durch_kunde: true` beim Absagen: Der Kunde hat selbst abgesagt. Dann bekommt das Team Bescheid und der Kunde
    keine Nachricht.

## Früher dran

Mit `frueher_dran: true` ist der Kunde einverstanden, vorgezogen zu werden. Wird früher etwas frei (Absage,
Verschiebung, jemand ist früher fertig), bietet Dranzeit ihm den Platz an, exklusiv für kurze Zeit und in der Reihenfolge
der Termine. Nimmt er an, **verschiebt Dranzeit den Termin selbst**, und der alte Platz geht an den Nächsten.

- Das Angebot erreicht den Kunden nur, wenn sein Eintrag mit einem **Dranzeit-Konto verbunden** ist
  (`konto_verbunden`). Sonst steht in der Antwort `frueher_dran_erreichbar: false`. Verbinden geht heute über den
  Kunden-Link, den der Laden in Dranzeit in der Kundenliste erzeugt.
- Dein Programm muss solche Verschiebungen übernehmen, siehe nächster Abschnitt.

## Änderungen abgleichen

Termine ändern sich auch ohne dein Programm: Ein Kunde nimmt „Früher dran“ an oder sagt selbst ab, der Laden verschiebt
im Kalender, am Tresen wird aufgerufen, ein Kunde zieht eine Nummer. Am besten meldet Dranzeit dir das per **Webhook**
(nächster Abschnitt). Ohne Webhook: `GET /termine?von=…&bis=…` regelmäßig abfragen, etwa jede Minute für heute und
morgen und seltener für später, und `geaendert` mit dem gespeicherten Stand vergleichen. Ein Zeitraum umfasst höchstens
42 Tage.

## Webhooks

Dranzeit schickt deinem Programm bei jeder Änderung an einem Termin des Ladens ein `POST`, egal wer sie gemacht hat:
online, am Tresen, im Kalender, am Telefon, per „Früher dran“ oder über die API (auch dein eigenes Programm).

1. `POST /webhooks` mit `{"url": "https://…"}`, optional `ereignisse`. Die Antwort enthält **einmalig** das
   `geheimnis` (`whsec_…`). Bitte speichern.
2. `POST /webhooks/{id}/test` schickt ein `ping` und zeigt, was deine Gegenstelle geantwortet hat.
3. Ab dann kommt je Änderung:

```json
{
  "id": "evt_3f9c…",
  "typ": "termin.verschoben",
  "zeit": "2026-11-20T09:41:12+01:00",
  "laden_id": "…",
  "termin": { "id": "…", "status": "geplant", "start": "2026-11-20T10:00:00+01:00", "…": "wie GET /termine/{id}" },
  "vorher": { "start": "2026-11-20T15:30:00+01:00", "ende": "2026-11-20T16:00:00+01:00", "person_id": "…", "status": "geplant" }
}
```

| `typ` | wann |
|---|---|
| `termin.angelegt` | neuer Termin oder in Dranzeit gezogene Nummer (ohne `vorher`) |
| `termin.verschoben` | andere Zeit oder Person, auch wenn ein Kunde „Früher dran“ annimmt |
| `termin.abgesagt` | abgesagt, vom Laden oder vom Kunden |
| `termin.geaendert` | alles andere: aufgerufen, fertig, zurück auf geplant, Name, „Früher dran“ an oder aus |
| `ping` | nur von `POST /webhooks/{id}/test` |

**Antworten:** innerhalb von 10 Sekunden mit einem 2xx-Status. Sonst versucht Dranzeit es nach 1, 5, 15 und 60 Minuten,
nach 3, 6 und 12 Stunden noch einmal, danach gilt die Zustellung als fehlgeschlagen. Weiterleitungen werden nicht
verfolgt. `GET /webhooks/{id}/zustellungen` zeigt die letzten 50 mit Status und Fehler.

**Prüfen, dass es von Dranzeit kommt:** Die Kopfzeile `Dranzeit-Signatur: t=<Unix-Zeit>,v1=<Hex>` enthält einen
HMAC-SHA256 mit dem Geheimnis über `<t>.<roher Body>`. Ablehnen, wenn er nicht passt oder `t` älter als 5 Minuten ist.
Dazu kommen `Dranzeit-Ereignis` (der `typ`) und `Dranzeit-Zustellung` (bei jedem Versuch gleich).

```python
import hashlib, hmac, time

def von_dranzeit(geheimnis: str, signatur: str, body: bytes) -> bool:
    teile = dict(x.split("=", 1) for x in signatur.split(","))
    erwartet = hmac.new(geheimnis.encode(), teile["t"].encode() + b"." + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(erwartet, teile["v1"]) and abs(time.time() - int(teile["t"])) < 300
```

```js
const crypto = require("crypto");
// body: der rohe Request-Body als Buffer, nicht das geparste JSON
function vonDranzeit(geheimnis, signatur, body) {
  const t = Object.fromEntries(signatur.split(",").map((x) => x.split("=")));
  const erwartet = crypto.createHmac("sha256", geheimnis).update(`${t.t}.`).update(body).digest("hex");
  return t.v1?.length === erwartet.length && crypto.timingSafeEqual(Buffer.from(erwartet), Buffer.from(t.v1))
    && Math.abs(Date.now() / 1000 - Number(t.t)) < 300;
}
```

**Gut zu wissen:**

- Dasselbe Ereignis kann mehr als einmal ankommen, etwa wenn deine Antwort unterwegs verloren ging. Die `id` merken
  und Doppeltes übergehen.
- Die Reihenfolge ist nicht garantiert. `termin` ist immer der vollständige Stand zur `zeit`; im Zweifel
  `GET /termine/{id}`.
- Termine, die es vor dem ersten Webhook des Ladens schon gab, melden sich erst bei ihrer nächsten Änderung.
- Höchstens 5 Webhooks je Laden, nur `https` und nur Adressen im öffentlichen Internet.
- Ein Webhook gehört zu dem Schlüssel, mit dem er angelegt wurde: Widerruft der Inhaber den Schlüssel, ist auch der
  Webhook weg. Der Inhaber sieht alle Webhooks in Dranzeit und kann sie entfernen.
- War deine Gegenstelle länger als etwa 22 Stunden nicht erreichbar, danach einmal mit `GET /termine` abgleichen.

## Was Dranzeit selbst verschickt

- **Ans Team:** „Neue Buchung“ bei jedem Termin aus der API; „Absage“ bei `durch_kunde`.
- **An Kunden mit verbundenem Konto:** Erinnerung vor dem Termin, Nachricht bei Verschiebung oder Absage durch den Laden,
  „Früher dran“-Angebote (Push und E-Mail).
- Kunden **ohne** verbundenes Konto bekommen von Dranzeit nichts. Die benachrichtigt dein Programm selbst. Umgekehrt
  bitte nicht doppelt schicken, was Dranzeit schon schickt.

## Fehlercodes

Jeder Fehler kommt als `{"fehler": {"code": "…", "meldung": "…"}}`. Die `meldung` ist deutscher Text für Menschen,
entscheiden sollte dein Programm nach `code`.

| HTTP | `code` | Bedeutung |
|---|---|---|
| 400 | `kunde_fehlt` | weder `kunde_id` noch `kunde` angegeben |
| 400 | `person_fehlt` | `regeln: tresen` ohne `person_id` |
| 400 | `person_unbekannt` | Person gibt es hier nicht oder sie ist nicht aktiv |
| 400 | `person_bietet_nicht_an` | Person bietet die Leistung nicht an |
| 400 | `zeitraum` | `bis` nicht nach `von` oder mehr als 42 Tage |
| 400 | `zu_weit` | mehr als 400 Tage im Voraus |
| 400 | `url_ungueltig` | Webhook-Adresse nicht `https`, nicht auflösbar oder nicht öffentlich |
| 400 | `zu_viele_webhooks` | schon 5 Webhooks in diesem Laden |
| 401 | `kein_zugang` | Schlüssel fehlt, falsch oder widerrufen |
| 403 | `tarif` | Tarif des Ladens enthält die API (oder „Früher dran“) nicht |
| 403 | `gesperrt` | Laden ist gesperrt |
| 404 | `leistung_unbekannt`, `kunde_unbekannt`, `termin_unbekannt`, `webhook_unbekannt` | gibt es in diesem Laden nicht |
| 409 | `platz_weg` | Zeit nicht (mehr) frei; bei `online` mit `alternativen` |
| 409 | `zu_kurzfristig` | vorbei oder kürzer als die Vorlaufzeit des Ladens |
| 409 | `nicht_offen` | Termin läuft schon, ist fertig oder abgesagt |
| 422 | `ungueltig` | Anfrage unvollständig oder falsch; Einzelheiten in `details` |
| 429 | `zu_viele` | mehr als 120 Anfragen in einer Minute |

## Testen

Eine getrennte Testumgebung gibt es nicht. Zum Ausprobieren einen eigenen Testladen anlegen (die ersten 30 Tage laufen
mit allen Funktionen) und Kunden mit eigener E-Mail-Adresse nehmen: Nachrichten gehen wirklich raus.

## Noch nicht dabei

- **Nummer ziehen über die API.** Nummern ziehen Kunden heute auf der Seite des Ladens in Dranzeit (auch per QR-Code).
  Sie erscheinen in `GET /termine` mit `art: nummer`.
- Kunden-Link (Konto verbinden) über die API.
- Leistungen ändern oder löschen; Personen, Arbeits- und Öffnungszeiten anlegen.
- Ein Zugang für mehrere Läden.

Fragen und Wünsche: [hilfe@dranzeit.de](mailto:hilfe@dranzeit.de)
