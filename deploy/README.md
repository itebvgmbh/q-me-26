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

```powershell
& {
  $server = 'root@195.201.26.108'
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
  scp $datei "${server}:/etc/q-me/firebase-service-account.json"
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Hochladen fehlgeschlagen.' -ForegroundColor Red; return }
  Write-Host '2/3 Rechte setzen und Backend neu starten ...' -ForegroundColor Cyan
  ssh $server 'chown root:q-me /etc/q-me/firebase-service-account.json && chmod 640 /etc/q-me/firebase-service-account.json && systemctl restart q-me && sleep 4 && systemctl is-active q-me'
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Backend laeuft nicht. Letzte Meldungen:' -ForegroundColor Red; ssh $server 'journalctl -u q-me -n 30 --no-pager'; return }
  Write-Host '3/3 Pruefen, ob das Backend mit dem Schluessel Firestore lesen kann ...' -ForegroundColor Cyan
  $anfrage = '{"shop_id":"zNS505OFvKZpFaR1vTdN","service_id":"QJd2oXDcbaHJH9jViOGu","date":"' + (Get-Date -Format 'yyyy-MM-dd') + 'T12:00:00"}'
  $antwort = $anfrage | ssh $server 'curl -s -X POST -H Content-Type:application/json --data-binary @- http://127.0.0.1:$(sed -n s/^PORT=//p /etc/q-me.env)/routes/available-timeslots'
  if ("$antwort" -match '^\s*\{"timeslots":') {
    Write-Host 'Fertig: Schluessel ist eingespielt und funktioniert.' -ForegroundColor Green
  } else {
    Write-Host 'Schluessel ist hochgeladen, aber die Pruefung schlug fehl. Antwort des Backends:' -ForegroundColor Yellow
    Write-Host "$antwort"
    ssh $server 'journalctl -u q-me -n 30 --no-pager'
    return
  }
  if ((Read-Host 'Lokale Schluesseldatei jetzt loeschen? (j/n)') -eq 'j') { Remove-Item -LiteralPath $datei; Write-Host 'Lokale Datei geloescht.' }
}
```

## Aktualisieren

Vom eigenen Rechner aus (PowerShell):

```powershell
ssh root@195.201.26.108 'bash /opt/q-me/deploy/update.sh'
```

Holt `main`, installiert Abhängigkeiten, baut die Web-App in ein neues Verzeichnis
und tauscht sie erst nach erfolgreichem Build aus. Danach startet es das Backend
neu und prüft es. Einen anderen Branch ausrollen: `BRANCH=<name> bash …`.

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
