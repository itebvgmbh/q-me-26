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

```bash
ssh -i ~/.ssh/id_ed25519_spielmacherei root@195.201.26.108 \
  'git clone https://github.com/itebvgmbh/q-me-26.git /opt/q-me && bash /opt/q-me/deploy/setup-server.sh q-me.spielmacherei.de'
```

Wird das Repository später privat, braucht der Server einen eigenen Deploy-Key
(der vorhandene gehört zu Spielmacherei, GitHub erlaubt einen Key nur pro
Repository) und `git -C /opt/q-me remote set-url origin git@…`.

Das Skript installiert `uv` (Python 3.13 für das Backend), legt Konto, Dienst und
`/etc/q-me.env` an, baut die Web-App, startet das Backend und ergänzt die
Caddyfile. Als Backend-Port nimmt es den ersten freien ab 8090; auf dem
Spielmacherei-Server ist 8090 belegt, dort läuft Q-ME auf 8091.

Zum Schluss den Schlüssel einspielen (vom eigenen Rechner aus):

```bash
scp -i ~/.ssh/id_ed25519_spielmacherei service-account.json \
  root@195.201.26.108:/etc/q-me/firebase-service-account.json
ssh -i ~/.ssh/id_ed25519_spielmacherei root@195.201.26.108 \
  'chown root:q-me /etc/q-me/firebase-service-account.json && chmod 640 /etc/q-me/firebase-service-account.json && systemctl restart q-me'
```

## Aktualisieren

```bash
bash /opt/q-me/deploy/update.sh
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
