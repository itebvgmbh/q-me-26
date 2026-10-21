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

**Tarif-Felder am Laden** (`shops`): `plan`, `billing`, `trialEndsAt`, `founder`, `founderSince`, `grant`,
`suspended` setzt nur noch das Backend (Stripe-Webhook, `/billing/claim-founder`, Betreiber-Bereich). Wer sie im
Browser schreiben kann, nutzt bezahlte Tarife umsonst oder hebt eine Sperre auf. Dazu `owner` und `createdAt`
(ohne `trialEndsAt` zählt die Testphase ab `createdAt`).

- Beim **Anlegen** darf ein Laden sie nur zum eigenen Nachteil mitbringen: `plan: 'gratis'`, Testphase höchstens
  30 Tage (+1 Tag Spielraum für falsche Uhren), gerne schon abgelaufen, oder gleich gesperrt (`suspended: { at }`).
  So legen Testskripte Läden mit beendeter Testphase oder gesperrt an (`dev/e2e/lib.cjs` → `tempShop`).
- **Ändern** darf den Laden nur der Inhaber, und nie diese Felder. Unverändert mitgeschickte Werte stören nicht.
  Das Team ändert den Laden nicht (die Startklar-Liste merkt sich dann im Browser).
- **Löschen** (macht nur ein Testskript, die App nicht) geht nur zusammen mit einem Vermerk
  `deleted_shops/{id}` im selben Schritt; unter dieser ID lässt sich danach kein Laden mehr anlegen. Sonst brächte
  Löschen und Neuanlegen mit derselben ID (QR-Plakate gelten weiter) eine frische Testphase.

**Nur Backend**, im Browser weder lesbar noch schreibbar: `meta` (Zähler der Gründerplätze – zurückgesetzt gäbe es
Gründerpreise über die 100 hinaus), `push_subscriptions`, `staff-invitations`, `verzeichnis` (Salon-Verzeichnis; Seiten
und Karte liefert das Backend) und jede Sammlung, die in den Regeln nicht vorkommt.

**Offen wie bisher**: alle übrigen Sammlungen (siehe unten). Das ist bewusst ein eigener, späterer Schritt.

## Wer liest und schreibt was (Stand 21.10.2026)

| Sammlung | Ohne Anmeldung | Kunde | Inhaber | Team |
|---|---|---|---|---|
| `shops` | lesen (alle: Läden finden, Karte; einzeln: Buchen, QR, Wartezimmer-Bildschirm) | lesen | anlegen, ändern | lesen |
| `appointments` | anlegen (Buchen, Nummer ziehen), lesen (Tagesplan der Person, `/nummer/<id>`), absagen | anlegen, eigene lesen, absagen, anonyme übernehmen | alles im Laden | aufrufen, verschieben |
| `schedules`, `shop_days` | in jeder Buchung/Absage mitgeschrieben (Transaktion) | ebenso | ebenso | ebenso |
| `staff`, `services`, `breaks`, `recurring-breaks` | lesen | lesen | anlegen, ändern | eigene Arbeitszeiten |
| `customers` | – | – | lesen | anlegen, lesen |
| `users` | – | eigenes Profil | Profil verbundener Kunden lesen (Name, Telefon) | ebenso |
| `earlier_slot_notifications` | – | eigene lesen (schreibt das Backend) | – | – |
| `queue` (alt) | – | abfragen | – | – |

Schreibvorgänge der Testskripte (`fixtures.py`, `lasttest.cjs` über REST mit dem Testkonto, die anderen über die
App-Module im Browser) laufen unter denselben Regeln.

## Als Nächstes

Die übrigen Sammlungen zu verschärfen ist ein eigener Schritt; die Tabelle oben zeigt, was dabei weiter gehen muss
(vor allem Buchen und Nummer ziehen ohne Anmeldung). Einzelheiten dazu bitte nicht hier eintragen: Das Repository
ist öffentlich.
