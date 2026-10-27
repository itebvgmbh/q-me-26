# Hinweise für Claude

## Befehle für den Nutzer: PowerShell auf Windows

Der Nutzer führt Befehle in PowerShell auf Windows aus (meist Windows PowerShell 5.1). **Immer** so liefern:

- Läuft unverändert per Copy-Paste. Keine Platzhalter wie `XXXX`, `<pfad>`, `…`, die man erst anpassen muss.
- Variable Werte (Dateipfade, Namen, Ja/Nein) per `Read-Host` abfragen, mit Vorschlag, wo möglich (z. B. die neueste passende Datei in `Downloads`). Eingaben mit Anführungszeichen (Datei per Drag & Drop) akzeptieren.
- Mehrere Schritte in einen Block `& { ... }` packen, ohne Leerzeilen darin. Bei Fehlern mit `return` abbrechen.
- `ssh`/`scp` immer mit `-o BatchMode=yes` und vorher die Verbindung prüfen: nie in eine Passwortabfrage laufen, sondern mit Hinweis auf „Verbindung prüfen“ (`deploy/README.md`) abbrechen.
- Nach jedem `ssh`/`scp` `$LASTEXITCODE` prüfen und klar melden, ob es geklappt hat. Am Ende das Ergebnis prüfen, nicht nur ausführen.
- Nur Syntax, die in 5.1 und 7 läuft: kein `\` am Zeilenende, kein `&&`/`||` zwischen PowerShell-Befehlen, kein `??`.
- Befehle für den Server in einfache Anführungszeichen, darin keine doppelten (PowerShell 5.1 verstümmelt sie bei `ssh.exe`). Daten mit doppelten Anführungszeichen (JSON) per Pipe an `ssh` übergeben.
- Vor der Ausgabe testen, z. B. mit PowerShell 7 für Linux und Attrappen für `ssh`/`scp`/`Read-Host`.

Server: `root@195.201.26.108`, Code in `/opt/q-me`, Einzelheiten in `deploy/README.md`. Adresse: https://dranzeit.de (q-me.spielmacherei.de, www.dranzeit.de und dranzeit.com leiten dorthin weiter).

## Mehrsprachigkeit

- Die App gibt es auf Deutsch, Englisch, Türkisch und Arabisch (von rechts nach links). Der deutsche Text im Code ist der Schlüssel: `t('…')`, `tn(n, '{n} Termin', '{n} Termine')`, `tTeile()` für Links im Satz, `merke()` für Konstanten auf Modulebene – alles aus `@/i18n` (erklärt in `frontend/src/i18n/index.ts`).
- Jeder neue oder geänderte Text gleich mit übersetzen in `frontend/src/i18n/{en,tr,ar}/<bereich>.ts`. Prüfen: `node --experimental-strip-types dev/i18n-pruefen.mjs` muss mit `0 Fehler` enden; `--offen` zeigt Text, der noch ohne `t()` dasteht.
- Layout-Klassen logisch schreiben (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`), nicht `ml-`, `mr-`, `left-`, `right-` – sonst steht es auf Arabisch falsch herum.
- Gespeicherte oder verglichene Werte bleiben deutsch (z. B. „Laufkundschaft“), übersetzt wird nur die Anzeige.
- Bleibt deutsch: Betreiber-Bereich, Rechtstexte (Impressum, Datenschutz, AGB – mit Hinweis), Seitenköpfe für Suchmaschinen, Hilfe- und Stadtseiten vom Backend.
- Backend (Push, E-Mails, Fehlermeldungen in `detail`): dasselbe Muster in `backend/app/i18n` – `t('…', sprache)`, `tn()`, `merke()` für Konstanten und Fehlermeldungen mit Werten (`detail=merke('{name} …', name=…)`), Kataloge `backend/app/i18n/{en,tr,ar}.py`. Sprache für Push und Mails aus dem Hintergrund: Feld `language` an Termin (Nummer ziehen, Buchen), Push-Anmeldung und Profil `users/{uid}`; bei Antworten auf eine Anfrage `Accept-Language`, das das Frontend an jeden `/routes/`-Aufruf hängt. Fehlt sie: Deutsch. Neue Texte gleich übersetzen; `backend/tests/test_i18n.py` muss grün sein (`--fehlend` listet Lücken).
- Die Tests laufen auf Deutsch (`locale: 'de-DE'` in `dev/e2e/lib.cjs`); andere Sprache im Browser zum Ansehen: `?sprache=en|tr|ar` an die Adresse hängen.

## Testen

- Testskripte liegen in `dev/` (Anleitung: `dev/README.md`): Testladen anlegen/löschen (`dev/fixtures.py`), Regel- und Oberflächentests mit Playwright (`dev/e2e/`), Datenblick (`dev/daten.py`), Attrappen für PowerShell-Blöcke (`dev/powershell/`).
- Achtung: Es gibt nur ein Firebase-Projekt – Tests laufen gegen die echte Datenbank. Schreibende Tests nur im Testladen aus `dev/fixtures.py`.
- Backend: `backend/tests/test_earlier_slots.py`, `test_queue_notify.py`, `test_i18n.py` und `test_telefon.py` (ohne Firebase lauffähig).
- Nach Änderungen an Buchung/Warteschlange mindestens `regeln.cjs`, `fruehester-platz.cjs`, `schlange-tresen.cjs` und `seiten.cjs` laufen lassen.
- Die Regel der Schlange (wer wartet, Reihenfolge, Verzug, belegte Zeit) steht in `frontend/src/utils/queue-lane.ts` und gleich im Backend in `backend/app/libs/queue_notify.py` – immer beide ändern, Test ohne Browser: `node --experimental-strip-types dev/schlange.test.mjs`.
- Das Speichern eines neuen Termins (Platz belegen, Tagesnummer, Termin) steht in `createAppointment` (`frontend/src/utils/firestore/appointments.ts`) und gleich im Backend in `backend/app/libs/buchung.py` (Telefon-Assistent) – immer beide ändern.
