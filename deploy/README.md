# Test-Deployment auf dem Spielmacherei-Server

Q-ME läuft auf dem vorhandenen Hetzner-Server von Spielmacherei (`195.201.26.108`),
neben den anderen Projekten dort:

| Teil | Wo |
|---|---|
| Backend (FastAPI/uvicorn) | systemd-Dienst `q-me`, nur lokal auf `127.0.0.1:8091` (Port steht in `/etc/q-me.env`), Konto `q-me` |
| Web-App (gebautes React) | statische Dateien in `/opt/q-me-web` |
| HTTPS, `/routes/*` → Backend | eigener Block in der vorhandenen `/etc/caddy/Caddyfile` |
| Code | `/opt/q-me` (Git-Checkout, gehört root) |
| Konfiguration | `/etc/q-me.env`, Firebase-Schlüssel in `/etc/q-me/` |

Kein Docker, kein zweiter Caddy: Die Ports 80/443 gehören dem vorhandenen Caddy.
`setup-server.sh` hängt nur einen Block an dessen Caddyfile an (mit Sicherung und
Prüfung vorher) und lädt Caddy per `reload` neu. Die anderen Seiten laufen dabei
ohne Unterbrechung weiter.

## Vorher erledigen

1. **DNS**: A-Record `q-me.spielmacherei.de` → `195.201.26.108`, dort, wo auch
   `mamie.spielmacherei.de` eingetragen ist. Ohne den Eintrag bekommt Caddy kein
   Zertifikat. Die anderen Seiten stört das nicht.
2. **Firebase Console → Authentication → Settings → Autorisierte Domains**:
   `q-me.spielmacherei.de` eintragen, sonst scheitert die Google-Anmeldung.
3. **Firebase-Dienstkonto-Schlüssel**: Firebase Console → Projekteinstellungen →
   Dienstkonten → „Neuen privaten Schlüssel generieren“ (Projekt `qmedata-7c79e`).
   Die JSON-Datei gehört nie ins Repository.

## Erstinstallation

Das Repository ist öffentlich, der Server klont es per HTTPS ohne Deploy-Key.
Ein Befehl vom eigenen Rechner aus:

```powershell
ssh root@195.201.26.108 'git clone https://github.com/itebvgmbh/q-me-26.git /opt/q-me && bash /opt/q-me/deploy/setup-server.sh q-me.spielmacherei.de'
```

Einzeilige Befehle bleiben in **einer** Zeile: PowerShell kennt das `\` am
Zeilenende nicht. Mehrschrittige Abläufe stehen als `& { ... }`-Block da und
werden als Ganzes eingefügt. Regeln dafür: `CLAUDE.md`.

Wird das Repository später privat, braucht der Server einen eigenen Deploy-Key
(der vorhandene gehört zu Spielmacherei, GitHub erlaubt einen Key nur pro
Repository) und `git -C /opt/q-me remote set-url origin git@…`.

Das Skript installiert `uv` (Python 3.13 für das Backend), legt Konto, Dienst und
`/etc/q-me.env` an, baut die Web-App, startet das Backend und ergänzt die
Caddyfile. Als Backend-Port nimmt es den ersten freien ab 8090; auf dem
Spielmacherei-Server ist 8090 belegt, dort läuft Q-ME auf 8091.

Zum Schluss den Schlüssel einspielen: den ganzen Block in PowerShell einfügen. Er
sucht die neueste Schlüsseldatei in `Downloads` (oder fragt nach dem Pfad), prüft,
dass sie zum Projekt `qmedata-7c79e` gehört, lädt sie hoch, startet das Backend neu,
testet, ob es damit Firestore lesen kann, und bietet an, die lokale Datei zu löschen.
Vorher prüft er die Verbindung und fragt nie nach einem Passwort.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $downloads = Join-Path $env:USERPROFILE 'Downloads'
  $vorschlag = Get-ChildItem -Path $downloads -Filter 'qmedata-7c79e-firebase-adminsdk-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($vorschlag) {
    $eingabe = Read-Host "Schluessel gefunden: $($vorschlag.FullName)`nEnter = diese Datei nehmen, sonst Pfad eingeben oder Datei hier hineinziehen"
  } else {
    $eingabe = Read-Host 'Keine Schluesseldatei in Downloads gefunden. Pfad eingeben oder Datei hier hineinziehen'
  }
  if ([string]::IsNullOrWhiteSpace($eingabe)) { $datei = $vorschlag.FullName } else { $datei = $eingabe.Trim().Trim('"').Trim("'") }
  if (-not $datei -or -not (Test-Path -LiteralPath $datei)) { Write-Host "Abbruch: Datei nicht gefunden: $datei" -ForegroundColor Red; return }
  try { $json = Get-Content -LiteralPath $datei -Raw | ConvertFrom-Json } catch { Write-Host 'Abbruch: Das ist keine JSON-Datei.' -ForegroundColor Red; return }
  if ($json.type -ne 'service_account' -or $json.project_id -ne 'qmedata-7c79e') { Write-Host "Abbruch: Falsche Datei. Erwartet: Dienstkonto von qmedata-7c79e. Gefunden: $($json.type) / $($json.project_id)" -ForegroundColor Red; return }
  Write-Host '1/3 Schluessel hochladen ...' -ForegroundColor Cyan
  scp -o BatchMode=yes $datei "${server}:/etc/q-me/firebase-service-account.json"
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Hochladen fehlgeschlagen.' -ForegroundColor Red; return }
  Write-Host '2/3 Rechte setzen und Backend neu starten ...' -ForegroundColor Cyan
  ssh -o BatchMode=yes $server 'chown root:q-me /etc/q-me/firebase-service-account.json && chmod 640 /etc/q-me/firebase-service-account.json && systemctl restart q-me && sleep 4 && systemctl is-active q-me'
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Backend laeuft nicht. Letzte Meldungen:' -ForegroundColor Red; ssh -o BatchMode=yes $server 'journalctl -u q-me -n 30 --no-pager'; return }
  Write-Host '3/3 Pruefen, ob das Backend mit dem Schluessel Firestore lesen kann ...' -ForegroundColor Cyan
  $anfrage = '{"shop_id":"zNS505OFvKZpFaR1vTdN","service_id":"QJd2oXDcbaHJH9jViOGu","date":"' + (Get-Date -Format 'yyyy-MM-dd') + 'T12:00:00"}'
  $antwort = $anfrage | ssh -o BatchMode=yes $server 'curl -s -X POST -H Content-Type:application/json --data-binary @- http://127.0.0.1:$(sed -n s/^PORT=//p /etc/q-me.env)/routes/available-timeslots'
  if ("$antwort" -match '^\s*\{"timeslots":') {
    Write-Host 'Fertig: Schluessel ist eingespielt und funktioniert.' -ForegroundColor Green
  } else {
    Write-Host 'Schluessel ist hochgeladen, aber die Pruefung schlug fehl. Antwort des Backends:' -ForegroundColor Yellow
    Write-Host "$antwort"
    ssh -o BatchMode=yes $server 'journalctl -u q-me -n 30 --no-pager'
    return
  }
  if ((Read-Host 'Lokale Schluesseldatei jetzt loeschen? (j/n)') -eq 'j') { Remove-Item -LiteralPath $datei; Write-Host 'Lokale Datei geloescht.' }
}
```

## Aktualisieren

Vom eigenen Rechner aus, ganzen Block in PowerShell einfügen:

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  Write-Host 'Aktualisiere q-me (dauert etwa eine Minute) ...' -ForegroundColor Cyan
  ssh -o BatchMode=yes $server 'bash /opt/q-me/deploy/update.sh'
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Update fehlgeschlagen, Meldungen oben.' -ForegroundColor Red; return }
  Write-Host 'Fertig: q-me ist aktualisiert und laeuft.' -ForegroundColor Green
  ssh -o BatchMode=yes $server 'journalctl -u q-me -n 300 --no-pager | grep -q Scheduler.autostarted'
  if ($LASTEXITCODE -eq 0) { Write-Host 'Frueher dran: Hintergrunddienst laeuft (prueft alle 5 Minuten).' -ForegroundColor Green } else { Write-Host 'Frueher dran: Hintergrunddienst laeuft NICHT. Meist fehlt der Firebase-Schluessel (Block "Schluessel einspielen").' -ForegroundColor Yellow }
}
```

Der Block meldet zum Schluss auch, ob der Hintergrunddienst für „Früher dran“
läuft. Er startet mit dem Backend automatisch, sobald der Firebase-Schlüssel da ist,
und prüft alle 5 Minuten. Abweichend einstellbar in `/etc/q-me.env`:
`QME_SCHEDULER_INTERVAL=<Sekunden>` (mindestens 60) und `QME_SCHEDULER_AUTOSTART=0`
zum Abschalten.

Holt `main`, installiert Abhängigkeiten, baut die Web-App in ein neues Verzeichnis
und tauscht sie erst nach erfolgreichem Build aus. Danach startet es das Backend
neu und prüft es. Einen anderen Branch ausrollen: `BRANCH=<name> bash …`.

## Verbindung prüfen

Fragt `ssh` nach einem Passwort, findet es in diesem Fenster keinen passenden
Schlüssel; ein Root-Passwort braucht man nicht. Dieser Block prüft die Anmeldung
ohne Passwort, sucht sonst in `.ssh` den passenden Schlüssel, trägt ihn auf Wunsch
fest für den Server ein und schaut zuletzt in WSL nach:

```powershell
& {
  $ip = '195.201.26.108'
  $sshDir = Join-Path $env:USERPROFILE '.ssh'
  $cfg = Join-Path $sshDir 'config'
  $probe = { param([string[]]$optionen) $out = & ssh @optionen -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "root@$ip" 'echo q-me-ok' 2>&1 | Out-String; [pscustomobject]@{ Ok = ($LASTEXITCODE -eq 0 -and $out -match 'q-me-ok'); Text = $out } }
  Write-Host "1/3 Direkt: ssh root@$ip (ohne Passwort) ..." -ForegroundColor Cyan
  $direkt = & $probe @()
  if ($direkt.Ok) { Write-Host 'Klappt: Anmeldung per Schluessel funktioniert in diesem Fenster. Kein Passwort noetig.' -ForegroundColor Green; return }
  if ($direkt.Text -match 'IDENTIFICATION HAS CHANGED|Host key verification failed') { Write-Host 'Abbruch: Der Server meldet einen anderen Host-Schluessel als bekannt. Nicht weitermachen, erst klaeren, ob der Server neu aufgesetzt wurde.' -ForegroundColor Red; Write-Host $direkt.Text; return }
  Write-Host 'Klappt nicht direkt. Suche passenden Schluessel ...' -ForegroundColor Yellow
  Write-Host "2/3 Schluessel in $sshDir pruefen ..." -ForegroundColor Cyan
  $schluessel = @(Get-ChildItem -Path $sshDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -eq '' -and $_.Name -ne 'config' -and $_.Name -notlike 'known_hosts*' -and $_.Name -notlike 'authorized_keys*' })
  if ($schluessel.Count -eq 0) { Write-Host 'Keine privaten Schluessel gefunden.' }
  $treffer = $null
  foreach ($k in $schluessel) {
    $r = & $probe @('-i', $k.FullName, '-o', 'IdentitiesOnly=yes')
    if ($r.Ok) { Write-Host "Passt: $($k.Name)" -ForegroundColor Green; $treffer = $k; break } else { Write-Host "Passt nicht (oder hat ein Kennwort): $($k.Name)" }
  }
  if ($treffer) {
    $antwort = Read-Host "Soll ich $($treffer.Name) fest fuer $ip eintragen (Datei .ssh\config), damit ssh/scp ihn immer nehmen? (j/n)"
    if ($antwort -ne 'j') { Write-Host 'Nichts geaendert.'; return }
    $pfad = $treffer.FullName -replace '\\', '/'
    $eintrag = "`r`n# q-me / Spielmacherei-Server`r`nHost $ip`r`n  User root`r`n  IdentityFile `"$pfad`"`r`n  IdentitiesOnly yes`r`n"
    if (-not (Test-Path -LiteralPath $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }
    [System.IO.File]::AppendAllText($cfg, $eintrag, (New-Object System.Text.UTF8Encoding $false))
    $nachher = & $probe @()
    if ($nachher.Ok) { Write-Host 'Fertig: ssh root@195.201.26.108 klappt jetzt ohne Passwort.' -ForegroundColor Green } else { Write-Host 'Eingetragen, aber der Test schlaegt noch fehl:' -ForegroundColor Red; Write-Host $nachher.Text }
    return
  }
  Write-Host '3/3 WSL (Linux unter Windows) pruefen ...' -ForegroundColor Cyan
  if (Get-Command wsl -ErrorAction SilentlyContinue) {
    $wslOut = & wsl -e ssh -o BatchMode=yes -o ConnectTimeout=10 "root@$ip" 'echo q-me-ok' 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0 -and $wslOut -match 'q-me-ok') { Write-Host 'In WSL klappt die Anmeldung: Dein Schluessel liegt dort, nicht in Windows. Schick Claude dieses Ergebnis, dann gibt es einen Block zum Uebernehmen.' -ForegroundColor Yellow; return }
    Write-Host 'In WSL auch nicht.'
  } else { Write-Host 'Kein WSL vorhanden.' }
  Write-Host "Ergebnis: Auf diesem Rechner (Windows-Konto $env:USERNAME) gibt es keinen Schluessel, der auf den Server passt." -ForegroundColor Red
  Write-Host 'Wahrscheinlich liegt er auf dem Rechner, von dem aus die Einrichtung lief. Den Block dort ausfuehren oder Claude das Ergebnis schicken.'
}
```

## Prüfen

```bash
systemctl status q-me                  # Läuft der Dienst?
journalctl -u q-me -n 50               # Letzte Meldungen
curl -s https://q-me.spielmacherei.de/routes/scheduler-status
# → {"detail":"Not authenticated"}: Caddy und Backend sind verbunden
```

Meldet das Backend `No such file or directory: '/etc/q-me/firebase-service-account.json'`,
fehlt der Schlüssel.

## Platzbedarf

`npm ci` legt rund 660 MB in `/opt/q-me/frontend/node_modules` ab und braucht beim
Bauen unter 1 GB RAM. Ein Update dauert rund eine Minute. Die ausgelieferte Web-App
selbst ist knapp 3 MB groß, das von uv verwaltete Python 3.13 rund 100 MB.

## Entfernen

```bash
systemctl disable --now q-me && rm /etc/systemd/system/q-me.service
# Q-ME-Block aus /etc/caddy/Caddyfile löschen, dann: systemctl reload caddy
rm -rf /opt/q-me /opt/q-me-web /etc/q-me /etc/q-me.env && userdel q-me
```
