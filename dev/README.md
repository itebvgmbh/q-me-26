# Testskripte

Prüfen die App von außen: im echten Browser (Playwright) und direkt gegen die Datenbank.
Nicht Teil der App; der Server baut und installiert diesen Ordner nicht.

> **Achtung, echte Datenbank:** Es gibt nur ein Firebase-Projekt. Die Tests lesen und schreiben dort.
> Schreibende Tests arbeiten nur im eigenen Testladen aus `fixtures.py` und räumen ihre Termine selbst wieder auf.
> Ausnahme: `durchlauf-warteschlange.cjs ziehen` reiht wirklich im Laden ein.

## Einmal einrichten

Node.js (wie für das Frontend) und Python 3.9 oder neuer.

```powershell
cd dev
npm install
npx playwright install chromium
cd ..\frontend
npm ci
```

## Ablauf

```powershell
# 1. App starten (eigenes Fenster), läuft auf http://localhost:5173
cd frontend; npm run dev

# 2. Testladen anlegen (Konto, Laden, Person Robin, Mittagspause Mo, einmalige Pause Di, Ladenpause Mi, Termin Mo 10:00)
python dev/fixtures.py anlegen

# 3. Tests
node dev/e2e/regeln.cjs                     # Pausen (Person und Laden), Öffnungs-/Arbeitszeiten, Doppelbuchung, Verschieben (24 Prüfungen)
node dev/e2e/fruehester-platz.cjs           # Nummer ziehen: frühester Platz bei verschiedenen Uhrzeiten
node dev/e2e/speichern.cjs                  # Bearbeiten speichern ohne Kunden-ID / mit leerem Preis
node dev/e2e/warteschlange-sonderfaelle.cjs # Zeiten je Person, Platz weggeschnappt, Platz vorbei
node dev/e2e/absage-meldet.cjs              # Absage/Verschieben stößt "Früher dran" sofort an
node dev/e2e/laden-einrichten.cjs           # Einrichtungsassistent durchklicken (mit nachgebildetem Google/KI, ohne, nach Abbruch), prüft die Datenbank
node dev/e2e/betrieb-seiten.cjs             # Betriebsseiten Handy + Desktop: Dialoge, Team, Leistungen, Nummer vergeben, Rechte im Backend

# 4. Testladen wieder löschen
python dev/fixtures.py loeschen
```

Ohne Testladen, gegen ITEBV GmbH (ändert nichts):

```powershell
node dev/e2e/seiten.cjs                     # alle Seiten Handy + Desktop: JS-Fehler, Überlauf, Fotos in dev/out/
node dev/e2e/durchlauf-warteschlange.cjs    # QR-Link bis zur Bestätigung
node dev/e2e/durchlauf-buchung.cjs          # Termin buchen bis zur Zusammenfassung
node dev/e2e/ladezeit.cjs handy             # Ladezeit im langsamen Handynetz
node dev/e2e/wlan.cjs block                 # gesperrtes WLAN: klare Meldung statt "nicht gefunden"
python dev/daten.py 2026-10-16              # Termine eines Tages und offene "Früher dran"-Angebote
```

Jeder Test meldet je Prüfung `OK` oder `FEHL` und endet bei Fehlern mit Exit-Code 1.
Schlägt `regeln.cjs` nach einem abgebrochenen Lauf fehl, liegen meist Reste im Testladen:
`python dev/fixtures.py loeschen`, dann wieder `anlegen`.

## Einstellungen

| Variable | Standard | Wofür |
|---|---|---|
| `QME_URL` | `http://localhost:5173` | Adresse der App. Für echte Ladezeiten den Build messen: `npm run build`, `npm run preview`, dann `http://localhost:4173` |
| `QME_SHOP_ID` | ITEBV GmbH | Laden für Durchläufe, Seiten, Ladezeit, WLAN |
| `QME_BROWSER_ARGS` | leer | Zusätzliche Chromium-Argumente, z. B. hinter einem Firmen-Proxy |
| `QME_BACKEND` | `http://127.0.0.1:8000` | Ziel für `/routes` im Entwicklungsserver (`frontend/vite.config.ts`). `https://q-me.spielmacherei.de` testet das lokale Frontend gegen das Backend auf dem Server – ohne lokalen Firebase-Schlüssel |

Die Regel- und Speichertests laden Module der App direkt (`import('/src/...')`) und brauchen deshalb den
Entwicklungsserver, nicht den Build.

Backend-Tests (ohne Firebase, ohne Browser): `cd backend; uv run python tests/test_earlier_slots.py` und
`uv run python tests/test_shop_setup.py` (Laden einrichten: Google-Öffnungszeiten, Webseite lesen, Ladenpausen) und
`uv run python tests/test_access.py` (wer ist Betreiber der App)

## PowerShell-Blöcke testen

Blöcke für den Server (siehe `CLAUDE.md`) vor der Ausgabe mit Attrappen für `ssh`, `scp`, `Read-Host`
und fehlende Programme durchspielen – in Windows PowerShell 5.1 und, wenn vorhanden, PowerShell 7:

```powershell
powershell -NoProfile -File dev/powershell/Beispiel.ps1
```

`dev/powershell/Attrappen.ps1` erklärt die Optionen. Wichtig: Aliase wie `irm` lassen sich nicht durch
Funktionen ersetzen – im Block deshalb `Invoke-RestMethod` ausschreiben.
