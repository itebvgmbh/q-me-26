# Firestore-Regeln prüfen

`firestore.rules` (im Hauptordner des Repos) sind die Sicherheitsregeln der Datenbank. Eingespielt werden sie nur
von Hand in der Firebase-Konsole – Anleitung, Prüfung und Rücknahme: `deploy/README.md`, Abschnitt „Firestore-Regeln“.

Hier liegen die Tests dazu. Sie laufen im **Firestore-Emulator** (eine Datenbank nur auf dem Rechner, nicht das
echte Projekt) und stellen die Schreib- und Lesevorgänge der App und der Testskripte mit denselben Feldern nach.

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
das Backend: `backend/app/libs/team.py`). Ohne Anmeldung und als Kunde nur genau das, was die App dort tut.

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
Termin stehen Name, Handynummer, E-Mail für Benachrichtigungen und Konto. Anlegen darf das Team alles im eigenen
Laden; ohne Anmeldung nur eine Nummer ohne Konto (`isAnonymous`, `type: 'queue'`, mit `ticketKeyHash`), mit Konto nur
für sich selbst (`customerId` = eigenes Konto) – beides nur wartend, ohne Aufruf- oder Nachrichtenfelder, bei einer
Person dieses Ladens und nicht in einem gesperrten Laden. Ändern darf das Team; absagen (nur der Status, wartend →
abgesagt) das eigene Konto. Eine Nummer ohne Konto zurückgeben oder ins Konto übernehmen geht nur übers Backend
(`backend/app/apis/nummer`): Es prüft den Schlüssel aus dem Link der Nummernseite (`/nummer/<id>#k=…`), am Termin
steht nur dessen SHA-256 (`frontend/src/utils/ticket-key.ts`).

**Kurzfassung der Termine** (`public_appointments/{Termin-ID}`): Zeit, Person, Leistung, Status, Wartenummer,
Aufrufzeiten, dazu `staffDay`/`shopDay` (`{Person}_{Tag}`, `{Laden}_{Tag}`) für Abfragen ohne eigenen Index – das, was
Platzsuche, Nummernseite und Wartezimmer-Bildschirm ohne Anmeldung lesen. Schreiben darf sie jeder, aber nur als genaue
Kopie des Termins nach dem Schreibschritt (App: in derselben Transaktion; Backend gleicht laufend ab,
`backend/app/libs/public_appointments.py`); löschen nur, wenn es den Termin nicht mehr gibt.

**Belegung** (`schedules/{staffId}_{Tag}`) und **Tagesnummern** (`shop_days/{shopId}_{Tag}`) schreibt jede Buchung in
derselben Transaktion mit, auch ohne Anmeldung: nur in der festen Form, nur für eine Person dieses Ladens; Nummern
kommen genau eine je Schritt dazu und fallen nie weg.

**Personen, Leistungen, Pausen**: pflegt der Inhaber, nur im eigenen Laden. Ein Konto verbindet mit einer Person nur
das Backend (Einladung); der Inhaber nur sich selbst. Die Person selbst ändert nur ihre Arbeitszeiten. E-Mail, Telefon
und die Adresse, an die die Einladung ging, stehen nicht am öffentlichen Eintrag, sondern in
`shops/{shopId}/staff_contacts/{staffId}` – lesen und pflegen nur der Inhaber, `inviteEmailTo` nur das Backend.

**Kundenliste** (`customers`): lesen und anlegen nur Inhaber und Team, ohne Konto-Verbindung; verbinden, Link und
Löschen macht das Backend. **Profile** (`users`): nur das eigene. **Angebote „Früher dran“**: lesen das eigene Konto.

**Nur Backend**, im Browser weder lesbar noch schreibbar: `meta` (Zähler der Gründerplätze), `push_subscriptions`,
`staff-invitations`, `verzeichnis` und jede Sammlung, die in den Regeln nicht vorkommt.

## Wer liest und schreibt was (Fassung 2026-10-23.2)

| Sammlung | Ohne Anmeldung | Kunde | Inhaber | Team |
|---|---|---|---|---|
| `shops` | lesen | lesen | anlegen, ändern (ohne Tarif-Felder) | lesen |
| `shops/{id}/members` | – | – | wegnehmen, zurückholen | – |
| `shops/{id}/staff_contacts` | – | – | lesen, pflegen (ohne `inviteEmailTo`) | – |
| `appointments` | Nummer ohne Konto ziehen | eigene lesen, für sich buchen, eigene absagen | alles im Laden | alles im Laden |
| `public_appointments` | lesen, als genaue Kopie mitschreiben | ebenso | ebenso | ebenso |
| `schedules`, `shop_days` | in der Buchung mitschreiben | ebenso | ebenso | ebenso |
| `staff` | lesen (ohne Kontaktdaten) | lesen | anlegen, ändern | eigene Arbeitszeiten |
| `services`, `breaks`, `recurring-breaks` | lesen | lesen | anlegen, ändern, löschen | lesen |
| `customers` | – | – | lesen, anlegen | lesen, anlegen |
| `users` | – | eigenes Profil | eigenes Profil | eigenes Profil |
| `earlier_slot_notifications` | – | eigene lesen | aufräumen | – |
| `queue` (alt) | – | eigene abfragen | – | – |

Schreibvorgänge der Testskripte (`fixtures.py`, `lasttest.cjs` über REST mit dem Testkonto, die anderen über die
App-Module im Browser) laufen unter denselben Regeln.

## Ändern

Regeln und `regeln.test.mjs` immer zusammen ändern und die Kopfzeile `// Fassung:` neu setzen. Neue Sammlungen im
Frontend brauchen eine Regel, sonst sind sie nach dem Einspielen zu. Schwachstellen bitte nicht hier eintragen:
Das Repository ist öffentlich.
