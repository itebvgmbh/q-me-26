# Firestore-Regeln prüfen

`firestore.rules` (im Hauptordner des Repos) sind die Sicherheitsregeln der Datenbank. Eingespielt werden sie nur
von Hand in der Firebase-Konsole – Anleitung, Prüfung und Rücknahme: `deploy/README.md`, Abschnitt „Firestore-Regeln“.

Hier liegen die Tests dazu. Sie laufen im **Firestore-Emulator** (eine Datenbank nur auf dem Rechner, nicht das
echte Projekt) und stellen die Schreib- und Lesevorgänge der App und der Testskripte mit denselben Feldern nach.

Dazu `storage.rules`, die Regeln für den Speicher (Logos und Fotos der Personen): `speicher.test.mjs`, im
Storage-Emulator zusammen mit dem Firestore-Emulator, weil die Regeln dort den Inhaber des Ladens nachsehen.
Einspielen: `deploy/README.md`, Abschnitt „Speicher-Regeln“.

## Ausführen

Auf GitHub laufen sie von selbst, sobald sich `firestore.rules` oder dieser Ordner ändert (Actions →
„Firestore-Regeln“, dort auch „Run workflow“ für einen Lauf von Hand).

Lokal braucht der Emulator Java 21 (auf diesem Rechner nicht installiert; z. B. `winget install EclipseAdoptium.Temurin.21.JDK`):

```powershell
cd dev\regeln
npm.cmd ci
npm.cmd test
```

Ob die eingespielten Regeln in der echten Datenbank wirken, prüft `node dev/e2e/regeln-live.cjs` (nur am Testladen
aus `fixtures.py`, ohne Entwicklungsserver).

## Was die Regeln schützen

Grundsatz: **Lesen** bleibt offen, wo Buchen und Nummer ziehen ohne Anmeldung es brauchen – aber ohne Personendaten:
Namen, Handynummern und E-Mails liest nur, wer sie braucht (Laden, eigenes Konto). **Schreiben** darf nur, wer zum
Laden gehört – der Inhaber (`shops.owner`) oder eine Person im Team (Vermerk `shops/{shopId}/members/{uid}`, setzt
das Backend: `backend/app/libs/team.py`). Kunden schreiben nichts an Terminen: Nummer ziehen, buchen, Platz ändern
und absagen gehen über das Backend (`backend/app/apis/nummer`), das den Platz nach den Regeln prüft.

**Tarif-Felder am Laden** (`shops`): `plan`, `billing`, `trialEndsAt`, `founder`, `founderSince`, `grant`,
`suspended` setzt nur das Backend (Stripe-Webhook, `/billing/claim-founder`, Betreiber-Bereich). Dazu `owner` und
`createdAt` (ohne `trialEndsAt` zählt die Testphase ab `createdAt`).

- Beim **Anlegen** darf ein Laden sie nur zum eigenen Nachteil mitbringen: `plan: 'gratis'`, Testphase höchstens
  30 Tage (+1 Tag Spielraum für falsche Uhren), gerne schon abgelaufen, oder gleich gesperrt (`suspended: { at }`).
  So legen Testskripte Läden mit beendeter Testphase oder gesperrt an (`dev/e2e/lib.cjs` → `tempShop`).
- **Ändern** darf den Laden nur der Inhaber, und nie diese Felder. Unverändert mitgeschickte Werte stören nicht.
- **Löschen** (macht nur ein Testskript und das Backend, die App nicht) geht nur zusammen mit einem Vermerk
  `deleted_shops/{id}` im selben Schritt; unter dieser ID lässt sich danach kein Laden mehr anlegen.

**Termine** (`appointments`): lesen nur Inhaber und Team (der ganze Laden) und das eigene Konto (`customerId`) – am
Termin stehen Name, Handynummer, E-Mail für Benachrichtigungen und Konto. Anlegen und ändern darf nur der Laden
(Inhaber, Team) im eigenen Laden. Kunden – ohne Anmeldung oder mit Kunden-Konto – ziehen Nummern, buchen, verschieben
und sagen ab über das Backend (`backend/app/apis/nummer`): Es prüft den Platz nach den Regeln (Öffnungs- und
Arbeitszeiten, Pausen, Vorlauf, Tarif, gesperrter Laden) und schreibt Termin, Belegung, Tagesnummer und Kurzfassung in
einer Transaktion. Ohne Konto zählt der Schlüssel aus dem Link der Nummernseite (`/nummer/<id>#k=…`), am Termin steht
nur dessen SHA-256 (`frontend/src/utils/ticket-key.ts`).

**Kurzfassung der Termine** (`public_appointments/{Termin-ID}`): Zeit, Person, Leistung, Status, Wartenummer,
Aufrufzeiten, dazu `staffDay`/`shopDay` (`{Person}_{Tag}`, `{Laden}_{Tag}`) für Abfragen ohne eigenen Index – das, was
Platzsuche, Nummernseite und Wartezimmer-Bildschirm ohne Anmeldung lesen. Schreiben darf sie der Laden, und nur als
genaue Kopie des Termins nach dem Schreibschritt (App: in derselben Transaktion; Backend gleicht laufend ab,
`backend/app/libs/public_appointments.py`); löschen nur, wenn es den Termin nicht mehr gibt.

**Belegung** (`schedules/{staffId}_{Tag}`) und **Tagesnummern** (`shop_days/{shopId}_{Tag}`) schreibt jede Buchung in
derselben Transaktion mit – im Browser nur der Laden, für Kunden das Backend: nur in der festen Form, nur für eine
Person dieses Ladens; Nummern werden angehängt (ohne Vergleich mit dem Stand davor – sonst lehnen die Regeln im
Ansturm ab, statt die Transaktion neu anlaufen zu lassen).

**Personen, Leistungen, Pausen**: pflegt der Inhaber, nur im eigenen Laden. Ein Konto verbindet mit einer Person nur
das Backend (Einladung); der Inhaber nur sich selbst. Die Person selbst ändert nur ihre Arbeitszeiten. E-Mail, Telefon
und die Adresse, an die die Einladung ging, stehen nicht am öffentlichen Eintrag, sondern in
`shops/{shopId}/staff_contacts/{staffId}` – lesen und pflegen nur der Inhaber, `inviteEmailTo` nur das Backend.

**Kundenliste** (`customers`): lesen und anlegen nur Inhaber und Team, ohne Konto-Verbindung; verbinden, Link und
Löschen macht das Backend. **Profile** (`users`): nur das eigene. **Angebote „Früher dran“**: lesen das eigene Konto.

**Nur Backend**, im Browser weder lesbar noch schreibbar: `meta` (Zähler der Gründerplätze), `push_subscriptions`,
`team_push_subscriptions` (Geräte des Teams für Nachrichten über Kunden),
`staff-invitations`, `verzeichnis` und jede Sammlung, die in den Regeln nicht vorkommt.

## Wer liest und schreibt was (Fassung 2026-10-29)

| Sammlung | Ohne Anmeldung | Kunde | Inhaber | Team |
|---|---|---|---|---|
| `shops` | lesen | lesen | anlegen, ändern (ohne Tarif-Felder) | lesen |
| `shops/{id}/members` | – | – | wegnehmen, zurückholen | – |
| `shops/{id}/staff_contacts` | – | – | lesen, pflegen (ohne `inviteEmailTo`) | – |
| `appointments` | – (Backend) | eigene lesen (buchen, absagen: Backend) | alles im Laden | alles im Laden |
| `public_appointments` | lesen | lesen | als genaue Kopie mitschreiben | ebenso |
| `schedules`, `shop_days` | lesen | lesen | in der Buchung mitschreiben | ebenso |
| `staff` | lesen (ohne Kontaktdaten) | lesen | anlegen, ändern | eigene Arbeitszeiten |
| `services`, `breaks`, `recurring-breaks` | lesen | lesen | anlegen, ändern, löschen | lesen |
| `customers` | – | – | lesen, anlegen | lesen, anlegen |
| `users` | – | eigenes Profil | eigenes Profil | eigenes Profil |
| `earlier_slot_notifications` | – | eigene lesen | aufräumen | – |
| `queue` (alt) | – | eigene abfragen | – | – |

Schreibvorgänge der Testskripte (`fixtures.py`, `lasttest.cjs` über REST mit dem Testkonto, die anderen über die
App-Module im Browser) laufen unter denselben Regeln.

## Ändern

Regeln und Tests immer zusammen ändern (`firestore.rules` mit `regeln.test.mjs`, `storage.rules` mit
`speicher.test.mjs`) und die Kopfzeile `// Fassung:` neu setzen. Neue Sammlungen im
Frontend brauchen eine Regel, sonst sind sie nach dem Einspielen zu. Schwachstellen bitte nicht hier eintragen:
Das Repository ist öffentlich.
