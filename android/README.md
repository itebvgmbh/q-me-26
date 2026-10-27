# Android-App (Google Play)

Die App ist eine **Trusted Web Activity**: Sie öffnet https://dranzeit.de im Vollbild über Chrome, ohne
Adresszeile. Jede Änderung an der Website ist sofort auch in der App – eine neue Store-Fassung braucht es nur,
wenn sich an der Hülle etwas ändert (Name, Symbol, Farben, Start-Adresse, Version).

- Paket: `de.dranzeit.app` (lässt sich nach dem ersten Hochladen nie mehr ändern), Ziel Android 16 (API 36)
- Start-Adresse `/?app=android`: Daran erkennt die Website die App und **verkauft dort nichts** – kein Tarif,
  keine Preise, keine Links dorthin (`frontend/src/utils/app-shell.ts`, Server-Seiten `backend/app/seo.py`).
  Google Play verlangt sonst die Abrechnung über Google. Abos gibt es nur im Browser.
- Benachrichtigungen: der vorhandene Web-Push, Android zeigt ihn als Benachrichtigung der App
- Standort: an die App weitergereicht (Karte „Läden finden“)

Erzeugt mit [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) aus `twa-manifest.json`. Die Dateien
unter `app/`, `gradle/` usw. nie von Hand ändern, sondern `twa-manifest.json` und dann neu erzeugen:

```bash
cd android && npm ci && npm run erzeugen
```

Das schreibt auch `frontend/public/.well-known/assetlinks.json` aus `fingerprints` (siehe unten). Für jede neue
Store-Fassung `appVersionCode` um eins erhöhen (und `appVersion` anpassen).

## Bauen

GitHub Actions baut bei jeder Änderung unter `android/` (`.github/workflows/android.yml`), von Hand unter
Actions → Android-App → Run workflow. Ergebnis unter dem Lauf → Artifacts → `dranzeit-android`:

- ohne Schlüssel: `dranzeit-unsigniert.aab/.apk` – nur als Gegenprobe, dass alles baut
- mit Schlüssel: `dranzeit.aab` zum Hochladen in Google Play, `dranzeit.apk` zum Ausprobieren auf dem Handy.
  Im Protokoll des Schritts „Signieren“ steht der SHA-256-Fingerabdruck des Upload-Schlüssels.

## Upload-Schlüssel anlegen (einmal, Stefan)

Mit dem Upload-Schlüssel unterschreibt der Build jede Fassung, bevor sie zu Google Play geht. Google signiert
die App danach mit einem eigenen Schlüssel neu (Play App Signing). Geht der Upload-Schlüssel verloren, lässt er
sich über den Play-Support ersetzen – trotzdem sicher aufbewahren.

Dieser Block legt den Schlüssel an (keytool fragt zweimal nach einem neuen Passwort) und hinterlegt ihn samt
Passwort in GitHub (gh fragt das Passwort noch einmal verdeckt ab). Kein Wert läuft über den Chat oder die
Befehlszeile. Fehlt Java, sagt der Block, wie es zu installieren ist.

```powershell
& {
  $repo = 'itebvgmbh/q-me-26'
  $vorschlag = Join-Path $env:USERPROFILE 'Dranzeit\dranzeit-upload.jks'
  $eingabe = Read-Host "Wo soll der Upload-Schlüssel liegen? (Enter = $vorschlag)"
  $ks = $vorschlag
  if ($eingabe) { $ks = $eingabe.Trim().Trim('"') }
  $keytool = Get-Command keytool -ErrorAction SilentlyContinue
  if (-not $keytool) { $keytool = @("$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe") + @(Get-ChildItem "$env:ProgramFiles\Eclipse Adoptium\*\bin\keytool.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) | Where-Object { Test-Path $_ } | Select-Object -First 1 }
  if (-not $keytool) { Write-Host 'Java fehlt (keytool). Erst installieren: winget install EclipseAdoptium.Temurin.17.JDK – dann ein neues PowerShell-Fenster öffnen und diesen Block noch einmal einfügen.' -ForegroundColor Yellow; return }
  if (Test-Path $ks) { Write-Host "Unter $ks liegt schon ein Schlüssel – der wird genommen, nichts überschrieben." -ForegroundColor Yellow } else {
    New-Item -ItemType Directory -Force -Path (Split-Path $ks) | Out-Null
    Write-Host 'keytool fragt gleich zweimal nach einem neuen Passwort (mindestens 6 Zeichen). Im Passwort-Manager ablegen, es wird gleich noch einmal gebraucht.' -ForegroundColor Cyan
    & $keytool -genkeypair -keystore $ks -alias upload -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=ITEBV GmbH, O=ITEBV GmbH, C=DE'
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ks)) { Write-Host 'Der Schlüssel wurde nicht angelegt.' -ForegroundColor Red; return }
    Write-Host "Schlüssel angelegt: $ks – die Datei zusätzlich sicher aufbewahren (z. B. im Passwort-Manager)." -ForegroundColor Green
  }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host 'gh (GitHub CLI) fehlt: Der Schlüssel liegt bereit, in GitHub ist noch nichts hinterlegt.' -ForegroundColor Red; return }
  [Convert]::ToBase64String([IO.File]::ReadAllBytes($ks)) | gh secret set ANDROID_UPLOAD_KEYSTORE --repo $repo
  if ($LASTEXITCODE -ne 0) { Write-Host 'Schlüssel nicht in GitHub hinterlegt (gh auth status prüfen).' -ForegroundColor Red; return }
  Write-Host 'Jetzt dasselbe Passwort noch einmal eingeben (für den Build in GitHub):' -ForegroundColor Cyan
  gh secret set ANDROID_UPLOAD_PASSWORD --repo $repo
  if ($LASTEXITCODE -ne 0) { Write-Host 'Passwort nicht in GitHub hinterlegt (gh auth status prüfen).' -ForegroundColor Red; return }
  $liste = gh secret list --repo $repo | Out-String
  if ($liste -match 'ANDROID_UPLOAD_KEYSTORE' -and $liste -match 'ANDROID_UPLOAD_PASSWORD') { Write-Host 'Fertig: Schlüssel und Passwort sind in GitHub hinterlegt. Sag Claude Bescheid, dann baut GitHub die signierte App.' -ForegroundColor Green } else { Write-Host 'In GitHub fehlt noch etwas:' -ForegroundColor Red; Write-Host $liste }
}
```

Getestet mit Attrappen: `powershell -NoProfile -File dev/powershell/android-schluessel.test.ps1`.

## Fingerabdrücke und assetlinks.json

Android zeigt die Seite nur dann ohne Adresszeile, wenn https://dranzeit.de/.well-known/assetlinks.json den
SHA-256-Fingerabdruck des Schlüssels nennt, mit dem die installierte App signiert ist. Das sind zwei:

1. **Upload-Schlüssel** – für die `dranzeit.apk` aus GitHub Actions (Fingerabdruck im Protokoll „Signieren“)
2. **App-Signaturschlüssel von Google** – für die App aus dem Play Store. Steht in der Play Console unter
   Testen und veröffentlichen → App-Integrität → App-Signatur, sobald die App dort angelegt ist.

Beide in `twa-manifest.json` unter `fingerprints` eintragen (`{ "name": "upload", "value": "AB:CD:…" }`),
`npm run erzeugen`, committen, ausrollen. Prüfen:
https://developers.google.com/digital-asset-links/tools/generator (Website `https://dranzeit.de`, Paket
`de.dranzeit.app`). Caddy liefert die Datei aus `frontend/dist` wie jede andere aus; `[]` heißt: noch kein
Fingerabdruck eingetragen.

## Google Play Console (Stefan)

1. Entwicklerkonto als **Organisation** auf die ITEBV GmbH (25 $ einmalig, D-U-N-S-Nummer nötig). Als
   Organisation entfällt der Pflicht-Test mit 12 Testern über 14 Tage, den neue private Konten brauchen.
2. App anlegen: Name Dranzeit, Standardsprache Deutsch, App (nicht Spiel), kostenlos.
3. Play App Signing annehmen, `dranzeit.aab` in einen internen Test hochladen, Fingerabdruck des
   App-Signaturschlüssels an Claude geben (siehe oben).
4. Store-Eintrag und Richtlinien:
   - Datenschutzerklärung: https://dranzeit.de/datenschutz
   - Konto löschen (Pflicht, auch als Web-Link): https://dranzeit.de/hilfe/konto
   - Datensicherheit: welche Daten die App erhebt und wofür – Claude bereitet das Formular aus der
     Datenschutzerklärung vor
   - Inhaltsbewertung (Fragebogen), Zielgruppe, Angabe „keine Werbung“
   - Händlerangaben (EU): Adresse, Telefon, E-Mail der ITEBV GmbH werden öffentlich angezeigt
   - Grafiken: Symbol 512×512 (`store_icon.png`), Vorstellungsgrafik 1024×500, Screenshots Handy und
     Tablet (Tresen)
