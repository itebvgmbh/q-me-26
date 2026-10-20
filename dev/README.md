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
node dev/e2e/tarife.cjs                     # Preisseite, AGB, Mein Tarif, Sperren im Gratis-Tarif
node dev/e2e/laden-extras.cjs               # Wartezimmer-Bildschirm, Auswertung, QR-Plakat, Tagesnummern
node dev/e2e/abo-checkout.cjs               # Mein Tarif bis Stripe Checkout (Testschlüssel auf dem Server): Preis, Testphase, Steuer, SEPA
node dev/e2e/rechnungen.cjs                 # Mein Tarif → Rechnungen: Liste, Status, Beträge, PDF und E-Rechnung laden (Liste nachgebildet; QME_RECHNUNGEN=echt fragt das Backend)
node dev/e2e/betrieb-seiten.cjs             # Betriebsseiten Handy + Desktop: Dialoge, Team, Leistungen, Nummer vergeben, Rechte im Backend
node dev/e2e/leistungen-kunden.cjs          # Leistung löschen/zurückholen, Ladenauswahl, Vorlaufzeit für Online-Termine, Kunde anlegen + /activate (braucht das Backend ab diesem Stand)
node dev/e2e/team-einladen.cjs             # Person anlegen → Link/E-Mail → Konto anlegen oder bestehendes verbinden, Deaktivieren/Zurückholen, zwei Läden (braucht das Backend ab diesem Stand)
node dev/e2e/frueher-dran-schalter.cjs      # Meine Termine: „Früher dran“ selbst ein-/ausschalten bei einem vom Laden eingetragenen Termin, Angebot kommt und geht, Gratis-Tarif, Rechte (braucht das Backend ab diesem Stand)
node dev/e2e/hilfe-bilder.cjs               # Bilder für die Hilfe nach frontend/public/img/hilfe (danach committen), prüft die Startklar-Liste

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

## Lasttest (gegen die Live-Seite)

Eigener Laden „Lasttest (wird gleich gelöscht)“ mit 7 Konten, 4 Personen, 56 Terminen morgen und einem
Verlauf alter Termine – getrennt vom Testladen oben, damit parallel laufende Tests sich nicht stören.
Braucht keinen Entwicklungsserver, läuft gegen `QME_URL` (Standard: dranzeit.de, solange das nicht
auflöst q-me.spielmacherei.de).

```powershell
node dev/e2e/lasttest.cjs alles               # anlegen, alle Szenarien, löschen (ca. 3 Minuten)
node dev/e2e/lasttest.cjs anlegen 200         # oder einzeln: anlegen (Zahl = alte Termine bei Alex)
node dev/e2e/lasttest.cjs lauf kaskade        # nur bestimmte Szenarien
node dev/e2e/lasttest.cjs zeigen              # Tagesplan von morgen je Person
node dev/e2e/lasttest.cjs loeschen
```

Szenarien: `abfragen` (freie Zeiten unter Last), `ansturm` (10 Leute ziehen gleichzeitig eine Nummer,
`QME_ANSTURM` ändert die Zahl), `kaskade` („Früher dran“ nach 4 Absagen, alle nehmen sofort an),
`wettlauf` (Annahme und Tresen gleichzeitig, `QME_WETTLAUF=0,25,50` setzt die Verzögerungen des Tresens),
`absage` (Angebot nach Absage angenommen), `flut` (25× „Platz frei“), `ruhe` (nur Puls, `QME_RUHE` Sekunden).
Ein Puls misst dabei alle 250 ms die Antwortzeit des Servers. Ergebnisse auch in `dev/out/lasttest-*.json`.
Der Puls misst von diesem Rechner aus, also mit Leitung und DNS: Regelmäßige Ausreißer um 1,2 s kamen im Test
von hier, nicht vom Server. Was der Server selbst gebraucht hat, steht im Caddy-Log (`/var/log/caddy/q-me.log`, Feld `duration`).
Ein Lauf liest grob 15 000 Dokumente aus Firestore (Gratis-Kontingent: 50 000 am Tag).

Jeder Test meldet je Prüfung `OK` oder `FEHL` und endet bei Fehlern mit Exit-Code 1.
Schlägt `regeln.cjs` nach einem abgebrochenen Lauf fehl, liegen meist Reste im Testladen:
`python dev/fixtures.py loeschen`, dann wieder `anlegen`.

## Einstellungen

| Variable | Standard | Wofür |
|---|---|---|
| `QME_URL` | `http://localhost:5173` | Adresse der App. Für echte Ladezeiten den Build messen: `npm run build`, `npm run preview`, dann `http://localhost:4173` |
| `QME_SHOP_ID` | ITEBV GmbH | Laden für Durchläufe, Seiten, Ladezeit, WLAN |
| `QME_BROWSER_ARGS` | leer | Zusätzliche Chromium-Argumente, z. B. hinter einem Firmen-Proxy |
| `QME_BACKEND` | `http://127.0.0.1:8000` | Ziel für `/routes` im Entwicklungsserver (`frontend/vite.config.ts`). `https://dranzeit.de` testet das lokale Frontend gegen das Backend auf dem Server – ohne lokalen Firebase-Schlüssel |

Die Regel- und Speichertests laden Module der App direkt (`import('/src/...')`) und brauchen deshalb den
Entwicklungsserver, nicht den Build.

Backend-Tests (ohne Firebase, ohne Browser): `cd backend; uv run python tests/test_earlier_slots.py`,
`uv run python tests/test_customer_activation.py` (Kunden-Link /activate),
`uv run python tests/test_staff_invitation.py` (Team-Einladung /staff-registration),
`uv run python tests/test_frueher_dran.py` (Schalter „Früher dran“ unter Meine Termine) und
`uv run python tests/test_shop_setup.py` (Laden einrichten: Google-Öffnungszeiten, Webseite lesen, Ladenpausen) und
`uv run python tests/test_access.py` (wer ist Betreiber der App) und `uv run python tests/test_invoices.py`
(Rechnungen und E-Rechnung, Zugriff nur für den Inhaber)

E-Rechnungen gegen die offiziellen Prüfregeln (XML-Schema, EN 16931, XRechnung der KoSIT), ohne Java:
`cd backend; uv pip install --python .venv saxonche`, dann `uv run python ../dev/e-rechnung-pruefen.py`
(prüft die Beispiele aus `tests/test_invoices.py`; mit Dateinamen eine eigene, z. B. unter „Mein Tarif“ geladene XRechnung).

## PowerShell-Blöcke testen

Blöcke für den Server (siehe `CLAUDE.md`) vor der Ausgabe mit Attrappen für `ssh`, `scp`, `Read-Host`
und fehlende Programme durchspielen – in Windows PowerShell 5.1 und, wenn vorhanden, PowerShell 7:

```powershell
powershell -NoProfile -File dev/powershell/Beispiel.ps1
```

`dev/powershell/Attrappen.ps1` erklärt die Optionen. Wichtig: Aliase wie `irm` lassen sich nicht durch
Funktionen ersetzen – im Block deshalb `Invoke-RestMethod` ausschreiben.
