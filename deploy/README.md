# Test-Deployment auf Hetzner

Die App läuft als zwei Container mit Docker Compose:

- **web**: Caddy liefert das gebaute React-Frontend aus, leitet `/routes/*` an das Backend weiter und holt automatisch ein Let's-Encrypt-Zertifikat für `DOMAIN`.
- **backend**: FastAPI/Uvicorn auf Port 8000, nur intern erreichbar.

## Voraussetzungen

1. **Server**: Hetzner Cloud, Ubuntu 24.04, z. B. CX22 (2 vCPU, 4 GB RAM). Der Frontend-Build braucht in der Spitze knapp 1 GB RAM, das reicht also. SSH-Key beim Anlegen hinterlegen.
2. **Domain**: Ein A-Record (z. B. `test.q-me.app`) muss auf die IPv4 des Servers zeigen, *bevor* die Container starten, sonst schlägt die Zertifikatsausstellung fehl. Ohne eigene Domain geht zum Testen `<ip-mit-bindestrichen>.sslip.io`, z. B. `203-0-113-10.sslip.io`.
3. **Firebase-Dienstkonto**: Firebase Console → Projekteinstellungen → Dienstkonten → „Neuen privaten Schlüssel generieren“. Die JSON-Datei ist ein Geheimnis und gehört nicht ins Repo.
4. **Firebase Auth**: Firebase Console → Authentication → Settings → Autorisierte Domains → Test-Domain hinzufügen. Ohne diesen Eintrag funktioniert die Google-Anmeldung nicht. Falls der Web-API-Key in der Google Cloud Console auf bestimmte HTTP-Referrer eingeschränkt ist, die Domain dort ebenfalls eintragen.

## 1. Server einrichten (einmalig)

```bash
ssh root@<SERVER_IP> 'bash -s' < deploy/setup-server.sh
```

Das Skript installiert Docker, öffnet nur die Ports 22, 80 und 443 und legt `/opt/q-me/secrets` an.

## 2. Konfiguration hochladen (einmalig)

```bash
cp .env.example .env   # DOMAIN eintragen
scp .env root@<SERVER_IP>:/opt/q-me/.env
scp <pfad>/service-account.json root@<SERVER_IP>:/opt/q-me/secrets/firebase-service-account.json
```

## 3. Deployen

### Variante A: GitHub Actions

Im Repo unter *Settings → Secrets and variables → Actions* anlegen:

| Secret | Inhalt |
|---|---|
| `HETZNER_HOST` | IP oder Hostname des Servers |
| `HETZNER_SSH_KEY` | Privater SSH-Key; der öffentliche Teil muss in `/root/.ssh/authorized_keys` stehen |
| `HETZNER_KNOWN_HOSTS` | Optional, Ausgabe von `ssh-keyscan <SERVER_IP>`. Pinnt den Host-Key; ohne dieses Secret wird der Key bei jedem Lauf ungeprüft übernommen. |

Danach unter *Actions → Deploy to Hetzner → Run workflow* starten.

### Variante B: Manuell

```bash
rsync -az --delete --exclude .git --exclude node_modules --exclude .venv \
  --exclude .env --exclude secrets/ ./ root@<SERVER_IP>:/opt/q-me/
ssh root@<SERVER_IP> 'cd /opt/q-me && docker compose up -d --build'
```

## Prüfen

```bash
ssh root@<SERVER_IP> 'cd /opt/q-me && docker compose ps && docker compose logs --tail 50'
```

- `https://<DOMAIN>/` zeigt die Startseite.
- `https://<DOMAIN>/routes/scheduler-status` antwortet ohne Login mit `{"detail":"Not authenticated"}`. Damit ist das Backend über den Proxy erreichbar.
- Meldet das Backend `No such file or directory: '/run/secrets/q-me/firebase-service-account.json'`, fehlt der Schlüssel aus Schritt 2.
