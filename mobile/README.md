# Dranzeit für iPhone und iPad

Eine App für den App Store: eine [Capacitor](https://capacitorjs.com)-Hülle um **https://dranzeit.de** mit
nativem Push. Gebaut wird nur auf GitHub (macOS-Runner), ein Mac ist nicht nötig.

Stand 27.10.2026: Die App baut für den Simulator. Signieren und TestFlight sind vorbereitet, aber erst mit dem
Apple-Konto zu prüfen (Abschnitt „Was du selbst erledigen musst“).

## So ist die App gebaut

- **Lädt die Live-Seite** (`capacitor.config.json`, `server.url` = `https://dranzeit.de/?app=ios`). Jede Änderung
  an der Webseite ist sofort in der App, ohne neue Fassung im Store. Eine gebündelte Fassung (Webseite in der App)
  wäre bei Dranzeit schlechter: Die Seite ändert sich oft am Tag, Nummern und Schlange kommen ohnehin live aus
  Firestore, und jede Änderung müsste erst durch Apples Prüfung. Ohne Netz zeigt die App eine eigene Seite
  „Keine Verbindung“ (`www/offline.html`, viersprachig).
- **Erkennung:** `?app=ios` in der Start-Adresse und `DranzeitApp/ios` im User-Agent (`frontend/src/utils/app-shell.ts`
  aus der Android-Sitzung). In der App blendet die Seite Tarif und Preise aus (Apple-Richtlinie 3.1.3(f):
  Begleit-App ohne Verkauf und ohne Hinweis auf einen Kauf woanders).
- **Nur dranzeit.de** öffnet sich in der App (`server.allowNavigation`), alles andere (Karten, Telefon, Mail) in Safari.
- **Sprachen:** de, en, tr, ar (`CFBundleLocalizations` in `ios/App/App/Info.plist`, Freigabetexte in
  `ios/App/App/*.lproj/InfoPlist.strings`). Die Webseite bekommt dadurch die Gerätesprache wie im Browser.
- `ITSAppUsesNonExemptEncryption` = false: Exportfrage in App Store Connect entfällt (nur HTTPS).

### Was die App mehr kann als die Webseite (Richtlinie 4.2)

| Funktion | Wo |
|---|---|
| **Push** „Gleich bist du dran“, „Du bist dran“, Erinnerungen, Absagen – auch wenn die App zu ist | `ios/App/App/AppDelegate.swift`, `frontend/src/utils/push.ts` (`enableAppPush`), `backend/app/libs/fcm.py` |
| **Bildschirm bleibt an** am Tresen (`/shop-dashboard`) und auf dem Wartezimmer-Bildschirm (`/bildschirm/…`) | `frontend/src/utils/native-app.ts` (`useKeepScreenOn`) |
| **Universal Links:** QR-Code vom Plakat, Links aus Mails und Mitteilungen öffnen die App statt Safari | `frontend/public/.well-known/apple-app-site-association`, `ios/App/App/App.entitlements` |
| **Passwörter aus dem iCloud-Schlüsselbund** für dranzeit.de beim Anmelden | `webcredentials` in denselben beiden Dateien |

Antippen einer Mitteilung öffnet die Nummer (`data.url`), ein QR-Code die Seite zum Nummer-Ziehen
(`connectNativeApp` in `native-app.ts`).

### Push

1. Nummernseite (`/nummer/<id>`) → „Benachrichtigung einschalten“. In der App fragt iOS einmal um Erlaubnis.
2. iOS liefert ein APNs-Token, der AppDelegate tauscht es über Firebase Messaging gegen ein FCM-Token.
3. Die Seite meldet es an: `POST /routes/push/subscribe-app` (Termin, Schlüssel der Nummer, Token, Sprache).
   Es landet wie eine Web-Push-Anmeldung in `push_subscriptions`, nur mit `token` statt `endpoint`.
4. `backend/app/libs/notify_worker.py` schickt über `firebase_admin.messaging` (dasselbe Dienstkonto wie
   Firestore, kein neuer Schlüssel auf dem Server). Ist die App gelöscht, verschwindet die Anmeldung von selbst.

Dafür braucht Firebase den APNs-Schlüssel von Apple, und die App ihre `GoogleService-Info.plist` (beides unten).
Ohne die Datei startet die App trotzdem, nur ohne Push.

### Dateien

- `capacitor.config.json` – Start-Adresse, User-Agent, Offline-Seite, Mitteilungen auch bei offener App
- `www/` – nur die Offline-Seite (Capacitor verlangt einen Web-Ordner)
- `ios/App/App.xcodeproj` – Xcode-Projekt (iPhone und iPad, ab iOS 15). Pakete über Swift Package Manager:
  Capacitor-Plugins (`ios/App/CapApp-SPM/Package.swift`, schreibt `npx cap sync ios`) und Firebase Messaging
  (direkt im Projekt). Das Skript „GoogleService-Info.plist“ legt die Firebase-Datei ins App-Paket, wenn es sie gibt.
- `ios/App/App/Assets.xcassets` – App-Symbol und Startbild aus dem Favicon-Motiv (Ticket auf Schwarz)
- `.github/workflows/ios.yml` – Simulator-Build bei jeder Änderung an `mobile/`, TestFlight von Hand

Nach Änderungen an `capacitor.config.json` oder neuen Plugins: `npm ci` und `npx cap sync ios` in `mobile/`,
dann `ios/App/CapApp-SPM/Package.swift` mit committen. Plugins im Frontend (`frontend/package.json`) und hier
müssen dieselbe Hauptversion haben.

## Was du selbst erledigen musst

In dieser Reihenfolge. Wo ein Wert ins Repo muss, gibt es einen Block, der ihn abfragt und direkt zu GitHub
schickt – er läuft nicht durch den Chat.

### 1. Apple Developer Program (Organisation)

- Mit der D-U-N-S-Nummer der ITEBV GmbH unter https://developer.apple.com/programs/enroll/ als **Organisation**
  anmelden (99 € im Jahr). Apple ruft zur Prüfung an.
- Danach unter https://developer.apple.com/account → Mitgliedschaft die **Team-ID** ablesen (10 Zeichen) und
  mit diesem Block als GitHub-Variable eintragen. Die Team-ID ist kein Geheimnis: Sag sie auch Claude, damit sie
  in `apple-app-site-association` kommt – sonst öffnen QR-Codes Safari statt der App.

```powershell
& {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host 'Abbruch: GitHub CLI fehlt (winget install GitHub.cli, dann gh auth login).' -ForegroundColor Red; return }
  $team = (Read-Host 'Team-ID aus developer.apple.com/account (10 Zeichen)').Trim().Trim('"').ToUpper()
  if ($team -notmatch '^[A-Z0-9]{10}$') { Write-Host "Abbruch: '$team' sieht nicht wie eine Team-ID aus (10 Buchstaben oder Ziffern)." -ForegroundColor Red; return }
  gh variable set APPLE_TEAM_ID --repo itebvgmbh/q-me-26 --body $team
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Variable nicht gesetzt. Mit gh auth status pruefen, ob du als itebvgmbh angemeldet bist.' -ForegroundColor Red; return }
  $wert = (gh variable get APPLE_TEAM_ID --repo itebvgmbh/q-me-26 | Out-String).Trim()
  if ($wert -eq $team) { Write-Host "Fertig: APPLE_TEAM_ID = $team steht in GitHub. Jetzt Claude die Team-ID sagen (fuer die Universal Links)." -ForegroundColor Green } else { Write-Host "Achtung: GitHub meldet '$wert' statt '$team'." -ForegroundColor Yellow }
}
```

### 2. App anlegen

- https://developer.apple.com/account/resources/identifiers → **+** → App IDs → App → Bundle ID *Explicit*
  `de.dranzeit.app`, Beschreibung „Dranzeit“. Haken bei **Associated Domains** und **Push Notifications**.
- https://appstoreconnect.apple.com → Apps → **+** → Neue App: iOS, Name „Dranzeit“, Primärsprache Deutsch,
  Bundle-ID `de.dranzeit.app`, SKU `dranzeit-ios`, voller Zugriff.

### 3. Push: APNs-Schlüssel in Firebase, App in Firebase registrieren

- https://developer.apple.com/account/resources/authkeys → **+** → Name „Dranzeit Push“, Haken bei
  **Apple Push Notifications service (APNs)** → herunterladen (`AuthKey_….p8`, geht nur einmal) und die Key-ID notieren.
- Firebase-Konsole (Projekt `qmedata-7c79e`) → Projekteinstellungen → **Cloud Messaging** → Apple-App-Konfiguration
  → APNs-Authentifizierungsschlüssel hochladen (Datei, Key-ID, Team-ID). Das machst du im Browser, Claude sieht
  die Datei nie.
- Firebase-Konsole → Projektübersicht → **App hinzufügen** → iOS → Bundle-ID `de.dranzeit.app`, App-Name
  „Dranzeit“ → `GoogleService-Info.plist` herunterladen (die übrigen Schritte des Assistenten überspringen,
  das ist schon eingebaut). Dann mit diesem Block zu GitHub schicken:

```powershell
& {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host 'Abbruch: GitHub CLI fehlt (winget install GitHub.cli, dann gh auth login).' -ForegroundColor Red; return }
  $neueste = Get-ChildItem -Path (Join-Path $env:USERPROFILE 'Downloads') -Filter 'GoogleService-Info*.plist' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $vorschlag = ''; if ($neueste) { $vorschlag = $neueste.FullName }
  $pfad = (Read-Host "Pfad zur GoogleService-Info.plist (Enter = $vorschlag)").Trim().Trim('"')
  if (-not $pfad) { $pfad = $vorschlag }
  if (-not $pfad -or -not (Test-Path -LiteralPath $pfad)) { Write-Host "Abbruch: Datei nicht gefunden: '$pfad'" -ForegroundColor Red; return }
  $inhalt = [IO.File]::ReadAllText($pfad)
  if ($inhalt -notmatch '<string>de\.dranzeit\.app</string>') { Write-Host 'Abbruch: Die Datei gehoert nicht zur App de.dranzeit.app. In Firebase die iOS-App mit dieser Bundle-ID waehlen.' -ForegroundColor Red; return }
  $inhalt | gh secret set IOS_GOOGLE_SERVICE_INFO --repo itebvgmbh/q-me-26
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Secret nicht gesetzt. Mit gh auth status pruefen, ob du als itebvgmbh angemeldet bist.' -ForegroundColor Red; return }
  $namen = (gh secret list --repo itebvgmbh/q-me-26 | Out-String)
  if ($namen -match 'IOS_GOOGLE_SERVICE_INFO') { Write-Host 'Fertig: IOS_GOOGLE_SERVICE_INFO steht in GitHub.' -ForegroundColor Green } else { Write-Host 'Achtung: GitHub listet IOS_GOOGLE_SERVICE_INFO nicht.' -ForegroundColor Yellow }
}
```

### 4. Schlüssel für TestFlight (App Store Connect API)

- https://appstoreconnect.apple.com/access/integrations/api → Team-Schlüssel → **+** → Name „GitHub“, Zugriff
  **Admin** (nötig, damit Xcode Zertifikat und Profil selbst anlegen darf) → herunterladen (`AuthKey_<Key-ID>.p8`,
  geht nur einmal). Key-ID und Issuer-ID stehen auf derselben Seite.
- Mit diesem Block zu GitHub schicken (die Datei bleibt bei dir, danach am besten in den Passwort-Manager und
  aus Downloads löschen):

```powershell
& {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host 'Abbruch: GitHub CLI fehlt (winget install GitHub.cli, dann gh auth login).' -ForegroundColor Red; return }
  $repo = 'itebvgmbh/q-me-26'
  $keyId = (Read-Host 'Key-ID des API-Schluessels (10 Zeichen)').Trim().Trim('"').ToUpper()
  if ($keyId -notmatch '^[A-Z0-9]{10}$') { Write-Host "Abbruch: '$keyId' sieht nicht wie eine Key-ID aus." -ForegroundColor Red; return }
  $issuer = (Read-Host 'Issuer-ID (steht ueber der Schluesselliste)').Trim().Trim('"').ToLower()
  if ($issuer -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { Write-Host "Abbruch: '$issuer' sieht nicht wie eine Issuer-ID aus." -ForegroundColor Red; return }
  $vorschlag = Join-Path $env:USERPROFILE "Downloads\AuthKey_$keyId.p8"
  $pfad = (Read-Host "Pfad zur .p8-Datei (Enter = $vorschlag)").Trim().Trim('"')
  if (-not $pfad) { $pfad = $vorschlag }
  if (-not (Test-Path -LiteralPath $pfad)) { Write-Host "Abbruch: Datei nicht gefunden: '$pfad'" -ForegroundColor Red; return }
  $inhalt = [IO.File]::ReadAllText($pfad)
  if ($inhalt -notmatch '-----BEGIN PRIVATE KEY-----') { Write-Host 'Abbruch: Das ist keine .p8-Datei von Apple.' -ForegroundColor Red; return }
  $keyId | gh secret set ASC_KEY_ID --repo $repo
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: ASC_KEY_ID nicht gesetzt. Mit gh auth status pruefen, ob du als itebvgmbh angemeldet bist.' -ForegroundColor Red; return }
  $issuer | gh secret set ASC_ISSUER_ID --repo $repo
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: ASC_ISSUER_ID nicht gesetzt.' -ForegroundColor Red; return }
  $inhalt | gh secret set ASC_KEY_P8 --repo $repo
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: ASC_KEY_P8 nicht gesetzt.' -ForegroundColor Red; return }
  $namen = (gh secret list --repo $repo | Out-String)
  $fehlen = @('ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_P8') | Where-Object { $namen -notmatch $_ }
  if ($fehlen) { Write-Host "Achtung: GitHub listet $($fehlen -join ', ') nicht." -ForegroundColor Yellow } else { Write-Host 'Fertig: ASC_KEY_ID, ASC_ISSUER_ID und ASC_KEY_P8 stehen in GitHub.' -ForegroundColor Green }
}
```

### 5. Erste Fassung zu TestFlight

Auf GitHub: Actions → **iOS-App** → Run workflow → „Zu TestFlight hochladen“ anhaken. Oder:

```powershell
gh workflow run ios.yml --repo itebvgmbh/q-me-26 --ref bildschirm -f testflight=true
```

Der Lauf prüft zuerst, ob alle Secrets da sind. Das Signieren macht Xcode über den API-Schlüssel selbst
(automatische Signatur); das ist ungetestet, bis das Konto steht – scheitert es, das Log an Claude geben.
Nach etwa 15 Minuten ist der Build in App Store Connect → TestFlight. Dort dich selbst als Tester eintragen und
auf dem iPhone mit der TestFlight-App installieren. Prüfen: Nummer ziehen, Benachrichtigung einschalten,
App schließen, am Tresen aufrufen → Mitteilung kommt; QR-Code mit der Kamera scannen → App öffnet sich.

### 6. Demo-Salon und Logins für die Prüfung

Apple prüft mit echten Logins. In App Store Connect → App-Informationen → **App-Prüfung** brauchst du:

- einen **Demo-Salon** mit Tarif, der Benachrichtigungen enthält (z. B. Testphase verlängert im Betreiber-Bereich),
  zwei Personen im Team, ein paar Leistungen, Öffnungszeiten an allen Tagen (Apple prüft auch am Wochenende
  und nachts – sonst ist „Nummer ziehen“ zu)
- **Inhaber-Login** (E-Mail und Passwort) für Tresen, Team, Leistungen
- **Mitarbeiter-Login** für „Mein Tag“
- in den Notizen für die Prüfung: „Nummer ziehen ohne Konto: https://dranzeit.de/public-join-queue?shopId=… in der
  App öffnen oder den QR-Code im Tresen scannen. Benachrichtigung auf der Nummernseite einschalten, dann am Tresen
  mit dem Inhaber-Login aufrufen.“ Und: „Preise und Abo gibt es nur auf der Webseite für Läden; die App ist
  für Kunden und das Team kostenlos.“

Konten legst du selbst an (Passwörter nie in den Chat). Für die Prüfung keine echten Kundendaten.

### 7. Store-Eintrag

- **Screenshots:** iPhone 6,9" (1320 × 2868) und iPad 13" (2064 × 2752), je mindestens drei: Nummernseite mit
  Wartezeit, Nummer ziehen, Tresen mit Schlange. Am einfachsten aus TestFlight auf echten Geräten; oder Claude
  macht sie mit Playwright in genau diesen Größen aus dem Demo-Salon, sobald es die Demo-Logins gibt.
- **Datenschutz-Angaben** (App Store Connect → App-Datenschutz): Name, E-Mail, Telefon (Buchung, nicht für
  Werbung), Gerätekennung (Push-Token), kein Tracking. Datenschutz-URL `https://dranzeit.de/datenschutz`,
  Support-URL `https://dranzeit.de/hilfe`.
- **Kategorie:** Lifestyle oder Business, Altersfreigabe 4+.
- Kein Hinweis auf Preise oder Abos in Beschreibung und Screenshots (Richtlinie 3.1.3(f)).

## Vorschlag für später: Live-Aktivität „Gleich bist du dran“

Nicht gebaut, nur als Idee: Eine Live-Aktivität zeigt auf dem Sperrbildschirm und in der Dynamic Island die
eigene Nummer, wie viele noch davor sind und die ungefähre Zeit – ohne die App zu öffnen. Das wäre die
deutlichste native Funktion für Apple und für Kunden im Café nebenan.

Aufwand: ein Widget-Ziel in Swift (ActivityKit, eigenes Xcode-Ziel mit App Group), ein kleines Capacitor-Plugin
zum Starten aus der Nummernseite, und im Backend Updates per APNs-Push mit `apns-push-type: liveactivity`
(Firebase Cloud Messaging kann das über `apns.live_activity_token`). Der Backend-Dienst kennt Reihenfolge und
Verzug schon (`queue_notify.py`) und müsste bei jeder Änderung der Schlange ein Update schicken. Realistisch
zwei bis drei Tage plus Test auf echten Geräten – erst sinnvoll, wenn TestFlight läuft.
