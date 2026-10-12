# Hinweise für Claude

## Befehle für den Nutzer: PowerShell auf Windows

Der Nutzer führt Befehle in PowerShell auf Windows aus (meist Windows PowerShell 5.1). **Immer** so liefern:

- Läuft unverändert per Copy-Paste. Keine Platzhalter wie `XXXX`, `<pfad>`, `…`, die man erst anpassen muss.
- Variable Werte (Dateipfade, Namen, Ja/Nein) per `Read-Host` abfragen, mit Vorschlag, wo möglich (z. B. die neueste passende Datei in `Downloads`). Eingaben mit Anführungszeichen (Datei per Drag & Drop) akzeptieren.
- Mehrere Schritte in einen Block `& { ... }` packen, ohne Leerzeilen darin. Bei Fehlern mit `return` abbrechen.
- Nach jedem `ssh`/`scp` `$LASTEXITCODE` prüfen und klar melden, ob es geklappt hat. Am Ende das Ergebnis prüfen, nicht nur ausführen.
- Nur Syntax, die in 5.1 und 7 läuft: kein `\` am Zeilenende, kein `&&`/`||` zwischen PowerShell-Befehlen, kein `??`.
- Befehle für den Server in einfache Anführungszeichen, darin keine doppelten (PowerShell 5.1 verstümmelt sie bei `ssh.exe`). Daten mit doppelten Anführungszeichen (JSON) per Pipe an `ssh` übergeben.
- Vor der Ausgabe testen, z. B. mit PowerShell 7 für Linux und Attrappen für `ssh`/`scp`/`Read-Host`.

Server: `root@195.201.26.108`, Code in `/opt/q-me`, Einzelheiten in `deploy/README.md`.
