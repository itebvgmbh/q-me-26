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

Ob die eingespielten Regeln in der echten Datenbank wirken, prüft `node dev/e2e/regeln-live.cjs` (nur lesend, ohne
Anmeldung und ohne Entwicklungsserver).

## Was die Regeln schützen (Fassung 2026-11-04)

Seit Stufe 2 von `requirements/eigene-datenbank.md` liest und schreibt der Browser nichts mehr selbst in Firestore.
Alles geht über das Backend (`/routes/live`, `/routes/team`, `/routes/konto`, `/routes/nummer` …), das mit dem Admin
SDK arbeitet und von den Regeln nicht betroffen ist. Deshalb ist für den Browser **alles zu** – ohne Anmeldung, für
Kunden, Team und Inhaber, für jede Sammlung. Wer was darf, prüft jetzt das Backend (`backend/app/apis/firebase_utils.py`,
`backend/app/libs/team_laden.py`, `laeden.py`, `pausen.py`, `team_termine.py`).

Im **Speicher** (`storage.rules`) liegen nur noch ältere Logos und Fotos; neue lädt die App zum eigenen Server hoch
(`/var/lib/q-me/dateien`). Ansehen geht weiter ohne Anmeldung, Hochladen, Ersetzen, Löschen und Auflisten nicht mehr.

Die letzte Fassung mit Zugriff aus dem Browser (2026-10-29, mit Tabelle „Wer liest und schreibt was“) steht in der
Git-Geschichte von `firestore.rules`, `storage.rules` und dieser Datei.

Testskripte, die selbst in Firestore lesen oder schreiben (`dev/e2e/lasttest.cjs` über REST mit dem Testkonto),
gehen nach dem Einspielen nicht mehr; `fixtures.py` arbeitet mit dem Dienstkonto und läuft weiter.

## Ändern

Regeln und Tests immer zusammen ändern (`firestore.rules` mit `regeln.test.mjs`, `storage.rules` mit
`speicher.test.mjs`) und die Kopfzeile `// Fassung:` neu setzen. Neue Sammlungen im
Frontend gibt es nicht mehr: Neue Daten bekommen einen Endpunkt im Backend. Schwachstellen bitte nicht hier eintragen:
Das Repository ist öffentlich.
