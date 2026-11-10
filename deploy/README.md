# Test-Deployment auf dem Spielmacherei-Server

Q-ME läuft auf dem vorhandenen Hetzner-Server von Spielmacherei (`195.201.26.108`),
neben den anderen Projekten dort:

| Teil | Wo |
|---|---|
| Backend (FastAPI/uvicorn) | systemd-Dienst `q-me`, nur lokal auf `127.0.0.1:8091` (Port steht in `/etc/q-me.env`), Konto `q-me` |
| Web-App (gebautes React) | statische Dateien in `/opt/q-me-web` |
| HTTPS, `/routes/*` → Backend | eigener Block in der vorhandenen `/etc/caddy/Caddyfile` |
| Code | `/opt/q-me` (Git-Checkout, gehört root) |
| Konfiguration | `/etc/q-me.env` |
| Daten | PostgreSQL (Datenbank `q_me`), Bilder in `/var/lib/q-me/dateien` |

Kein Docker, kein zweiter Caddy: Die Ports 80/443 gehören dem vorhandenen Caddy.
`setup-server.sh` hängt nur einen Block an dessen Caddyfile an (mit Sicherung und
Prüfung vorher) und lädt Caddy per `reload` neu. Die anderen Seiten laufen dabei
ohne Unterbrechung weiter.

## Vorher erledigen

1. **DNS**: A-Record `q-me.spielmacherei.de` → `195.201.26.108`, dort, wo auch
   `mamie.spielmacherei.de` eingetragen ist. Ohne den Eintrag bekommt Caddy kein
   Zertifikat. Die anderen Seiten stört das nicht.

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

Firebase braucht es seit Stufe 5 von `requirements/eigene-datenbank.md` nicht mehr: Datenbank, Anmeldung und Bilder
liegen auf dem Server, `update.sh` richtet die Datenbank selbst ein.

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
  $umgebung = ssh -o BatchMode=yes $server 'systemctl show q-me -p Environment' 2>&1 | Out-String
  if ($umgebung -match 'TZ=Europe/Berlin') { Write-Host 'Zeitzone: Backend rechnet jetzt in deutscher Zeit.' -ForegroundColor Green } else { Write-Host 'Zeitzone ist NICHT gesetzt. Ausgabe vom Server:' -ForegroundColor Red; Write-Host $umgebung; return }
  ssh -o BatchMode=yes $server 'journalctl -u q-me -n 300 --no-pager | grep -q Scheduler.autostarted'
  if ($LASTEXITCODE -eq 0) { Write-Host 'Frueher dran: Hintergrunddienst laeuft (prueft alle 5 Minuten).' -ForegroundColor Green } else { Write-Host 'Frueher dran: Hintergrunddienst laeuft NICHT. Meist fehlt die Datenbank (QME_DATABASE_URL, Abschnitt Datenbank).' -ForegroundColor Yellow }
}
```

Der Block meldet zum Schluss auch, ob der Hintergrunddienst für „Früher dran“
läuft. Er startet mit dem Backend automatisch, sobald die Datenbank eingerichtet ist,
und prüft alle 5 Minuten. Sofort geprüft wird zusätzlich nach jeder Absage,
Verschiebung und Annahme. Jeder frei gewordene Platz geht zuerst exklusiv an die
Person, die als Nächste in der Reihe steht, und erst nach Ablauf der Frist an die
nächste. Abweichend einstellbar in `/etc/q-me.env`:
`QME_SCHEDULER_INTERVAL=<Sekunden>` (mindestens 60), `QME_SCHEDULER_AUTOSTART=0`
zum Abschalten, `QME_OFFER_HOLD_MINUTES` (Frist je Angebot, Standard 15) und
`QME_OFFER_LEAD_MINUTES` (ein angebotener Platz liegt mindestens so weit in der
Zukunft, Standard 15).

Holt `bildschirm` (den Live-Stand), installiert Abhängigkeiten, baut die Web-App in ein neues Verzeichnis
und tauscht sie erst nach erfolgreichem Build aus. Danach startet es das Backend
neu und prüft es. Einen anderen Branch ausrollen: `BRANCH=<name> bash …`.

## Datenbank (PostgreSQL)

Seit 04.11.2026 hat Dranzeit eine eigene Datenbank auf diesem Server. Plan und Stufen stehen in
`requirements/eigene-datenbank.md`. Seit dem Umzug am 04.11.2026 liegen alle Daten hier (Tabelle `dokumente`,
dazu `konten`, `sitzungen` und `einmal_links` für die Anmeldung).

- **Datenbank und Anmeldung:** Datenbank `q_me` im gemeinsamen PostgreSQL 16 des Servers, Rolle `q-me`. Angemeldet
  wird über den lokalen Socket ohne Passwort (peer), es gibt also kein Datenbank-Geheimnis. Die Adresse steht in
  `/etc/q-me.env` als `QME_DATABASE_URL=postgresql:///q_me?host=/var/run/postgresql`.
- **Einrichten:** `update.sh` ruft bei jedem Ausrollen `deploy/datenbank.sh einrichten` auf. Das legt Rolle,
  Datenbank, die Erweiterung `btree_gist`, den Eintrag in `/etc/q-me.env` und die nächtliche Sicherung an, falls etwas
  davon fehlt. Ist schon alles da, ändert es nichts.
- **Schema:** Änderungen gibt es nur als Alembic-Fassung in `backend/migrations/versions/`. `update.sh` spielt sie vor
  dem Neustart ein (`datenbank.sh migrieren`, läuft als Benutzer `q-me`). Schlägt das fehl, startet das Backend nicht
  neu, und der alte Stand läuft weiter. Neue Fassung: `cd backend; .venv/bin/python -m alembic revision -m "…"`.
- **Log beim Start:** Das Backend schreibt `Datenbank: erreichbar, Schema-Fassung …` oder den Grund, warum es keine
  Verbindung gibt (`journalctl -u q-me | grep Datenbank:`).
- **Sicherung:** Jede Nacht um 21:30 Uhr UTC (`/etc/cron.d/q-me-datenbank`) entsteht eine Sicherung unter
  `/var/backups/q-me/q_me-<Zeit>.dump`. Sie bleibt 14 Tage, Protokoll in `/var/log/q-me-datenbank.log`. Die Uhrzeit
  liegt vor dem Sicherungsfenster von Hetzner (22–02 Uhr UTC), sodass die Datei in derselben Nacht im Abbild des
  Servers landet. Die Hetzner-Sicherung hält 7 Tage.
- **Wiederherstellung proben:** `bash /opt/q-me/deploy/datenbank.sh probe`. Das zieht eine frische Sicherung, spielt
  sie in die Wegwerf-Datenbank `q_me_probe` ein, vergleicht Tabellen und Zeilenzahlen mit `q_me` und löscht die Probe
  wieder. Mindestens nach jeder neuen Stufe einmal laufen lassen.
- **Im Ernstfall zurückspielen** (überschreibt den heutigen Stand, vorher Backend anhalten):
  `systemctl stop q-me`, dann `runuser -u postgres -- pg_restore --clean --if-exists -d q_me < /var/backups/q-me/<Datei>`,
  dann `systemctl start q-me`.
- **Tests:** `backend/tests/test_datenbank.py` (Schema vor und zurück, Sperre gegen überlappende Termine). Die Tests
  laufen auf GitHub gegen eine Wegwerf-Datenbank (Workflow „Datenbank“). Ohne `QME_TEST_DATABASE_URL` laufen lokal nur
  die Tests der Adresse.

### Umzug von Firestore nach PostgreSQL (erledigt)

Am 04.11.2026 sind alle Daten aus Firestore in die Tabelle `dokumente` umgezogen (465 Dokumente in 36 Sammlungen),
seitdem arbeitet das Backend nur noch mit PostgreSQL (`backend/app/store/postgres.py`). Das Umzugsskript und die
Firestore-Umsetzung sind in Stufe 5 ausgebaut; in Firestore liegt nur noch die alte Kopie, bis das Firebase-Projekt
gelöscht ist (Abschnitt „Firebase-Projekt“).

### Bilder aus Firebase Storage (Stufe 5)

Ältere Logos und Fotos standen als Adresse auf `firebasestorage.googleapis.com` in den Daten. `deploy/dateiumzug.sh`
holt sie auf den Server (`/var/lib/q-me/dateien`, wie hochgeladene Bilder) und setzt die neue Adresse ein. Der Dienst
läuft dabei weiter, das Skript lässt sich beliebig oft wiederholen:

```bash
bash /opt/q-me/deploy/dateiumzug.sh probe   # nur zählen
bash /opt/q-me/deploy/dateiumzug.sh umzug   # holen und ersetzen
```

## Anmeldung (eigene Konten)

Seit Stufe 4 von `requirements/eigene-datenbank.md` meldet Dranzeit selbst an, Firebase Auth fragt die App nicht mehr.

- **Wo:** Tabellen `konten`, `sitzungen` und `einmal_links` in der Datenbank `q_me` (Schema 0003), Code in
  `backend/app/libs/anmeldung.py`, Endpunkte unter `/routes/anmeldung/…`, im Browser `frontend/src/app/auth/konto.ts`.
- **Passwörter** als Argon2id-Hash. Die Sitzung steckt im Cookie `qme_sitzung` (HttpOnly, Secure, SameSite=Lax) und
  gilt 180 Tage ab der letzten Nutzung. Links aus Mails (Passwort neu: 1 Stunde, Adresse bestätigen: 3 Tage) stehen nur
  als Hash in der Datenbank.
- **Übernahme aus Firebase:** Beim ersten Start von Stufe 4 (04.11.2026) kamen alle 8 Firebase-Konten mit derselben ID
  nach `konten`, aber ohne Passwort. Bei der ersten Anmeldung prüft das Backend das Passwort einmal bei Firebase (über
  die öffentliche Schnittstelle, ohne Firebase-Paket) und speichert es dann selbst. Gibt es das Firebase-Projekt nicht
  mehr, hilft „Passwort vergessen?“.
- **Sperren, Adresse ändern, Konten löschen:** wie bisher im Betreiber-Bereich und mit „Konten aufräumen“; beides
  arbeitet jetzt auf den eigenen Konten. Sperren meldet alle Geräte ab.
- **Ein `git pull` bringt dafür nichts Neues mit:** keine Schlüssel und keine Einstellungen. Beim ersten Ausrollen sind
  alle Geräte einmal abgemeldet (Tresen und Handys neu anmelden).

## Schlüssel eintragen (Google, Anthropic, Resend, Stripe)

Der Einrichtungsassistent (`/shop-setup`) kommt ohne Schlüssel aus – dann fragt er alles ab. Mit Schlüsseln
übernimmt er Adresse, Telefon, Webseite, Öffnungszeiten und Branche von Google und liest die Preisliste von
der Webseite des Ladens. Beide stehen in `/etc/q-me.env`, nie im Repository.

**Google Maps** (`GOOGLE_MAPS_API_KEY`): [Google Cloud Console](https://console.cloud.google.com/) →
Projekt `qmedata-7c79e` → „APIs & Dienste“ → „Bibliothek“ → **Places API (New)** aktivieren (braucht ein
Abrechnungskonto) → „Anmeldedaten“ → „Anmeldedaten erstellen“ → „API-Schlüssel“. Danach den Schlüssel
einschränken:

- Anwendungseinschränkung „IP-Adressen“: `195.201.26.108` **und** `2a01:4f8:1c18:b8d8::1` – der Server
  erreicht Google über IPv6, mit nur der IPv4-Adresse lehnt Google jede Anfrage ab.
- API-Einschränkung: nur „Places API (New)“.

Nicht den Web-Schlüssel aus der App nehmen (`AIzaSyCp…`): Der ist öffentlich.
Kosten: Suchvorschläge mit Sitzungs-Token sind frei, das Übernehmen eines Eintrags („Place Details
Enterprise“) ist bis 1.000 im Monat frei, danach rund 2 Cent.

**Anthropic** (`ANTHROPIC_API_KEY`): [console.anthropic.com](https://console.anthropic.com/) → „API Keys“ →
„Create Key“, z. B. „q-me Laden einrichten“. Ausgelesen wird mit `claude-opus-5-5`, je Preisliste rund
3–10 Cent. Günstiger (unter 1 Cent, etwas ungenauer): `QME_SETUP_MODEL=claude-haiku-5-5` in `/etc/q-me.env`.
Gilt der Schlüssel für mehrere Workspaces, lehnt Claude jede Anfrage ab („not scoped to a workspace“, steht
im Log). Dann zusätzlich die Workspace-ID eintragen (Option 3 im Block, `wrkspc_…`, zu finden unter
[Workspaces](https://platform.claude.com/settings/workspaces)) – sie ist kein Geheimnis.

**Resend** (`RESEND_API_KEY`, E-Mails wie Bestätigung der E-Mail-Adresse, Team-Einladungen und Erinnerungen): [resend.com](https://resend.com/) →
„Domains“ → `dranzeit.de` hinzufügen und die angezeigten DNS-Einträge (SPF, DKIM) beim Domain-Anbieter
eintragen, bis Resend „Verified“ zeigt. Dann „API Keys“ → „Create API Key“ mit Berechtigung „Sending access“
nur für `dranzeit.de`. Absender ist `Dranzeit <hallo@dranzeit.de>`; abweichend mit `MAIL_FROM=…` in
`/etc/q-me.env` (kein Geheimnis). Ohne Schlüssel verschickt das Backend nichts und schreibt nur ins Log.

**Stripe** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, Abo-Abrechnung der Läden): Einrichtung im Abschnitt
„Abo-Abrechnung“ weiter unten.

Eintragen: Block in PowerShell einfügen. Er fragt, welchen Schlüssel, liest ihn verdeckt ein und schickt ihn
über die Standardeingabe an `deploy/set-secret.sh` – so steht er weder im Fenster noch in einer History.
Für jeden weiteren Eintrag den Block noch einmal ausführen.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $skript = ssh -o BatchMode=yes $server 'test -f /opt/q-me/deploy/set-secret.sh && echo da' 2>&1 | Out-String
  if ($skript -notmatch 'da') { Write-Host 'Abbruch: Auf dem Server fehlt deploy/set-secret.sh. Erst den Block "Aktualisieren" ausfuehren.' -ForegroundColor Red; return }
  $wahl = Read-Host 'Was eintragen? 1 = Google Maps (Laden bei Google finden), 2 = Anthropic (Preisliste lesen), 3 = Anthropic-Workspace-ID, 4 = Resend (E-Mails), 5 = Stripe-Geheimschluessel, 6 = Stripe-Webhook-Geheimnis'
  if ($wahl -eq '1') { $name = 'GOOGLE_MAPS_API_KEY'; $muster = '^AIza[0-9A-Za-z_-]{30,}$' } elseif ($wahl -eq '2') { $name = 'ANTHROPIC_API_KEY'; $muster = '^sk-ant-[0-9A-Za-z_-]{20,}$' } elseif ($wahl -eq '3') { $name = 'ANTHROPIC_WORKSPACE_ID'; $muster = '^wrkspc_[0-9A-Za-z]{10,}$' } elseif ($wahl -eq '4') { $name = 'RESEND_API_KEY'; $muster = '^re_[0-9A-Za-z_]{20,}$' } elseif ($wahl -eq '5') { $name = 'STRIPE_SECRET_KEY'; $muster = '^(sk|rk)_(test|live)_[0-9A-Za-z]{20,}$' } elseif ($wahl -eq '6') { $name = 'STRIPE_WEBHOOK_SECRET'; $muster = '^whsec_[0-9A-Za-z]{20,}$' } else { Write-Host 'Abbruch: Bitte eine Zahl von 1 bis 6 eingeben.' -ForegroundColor Red; return }
  $geheim = Read-Host "$name einfuegen (Strg+V, wird nicht angezeigt), dann Enter" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($geheim)
  try { $wert = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ($wert -notmatch $muster) { $wert = $null; Write-Host "Abbruch: Das sieht nicht wie ein $name aus (unvollstaendig kopiert?). Nichts geaendert." -ForegroundColor Red; return }
  Write-Host "1/2 $name auf den Server schreiben und Backend neu starten ..." -ForegroundColor Cyan
  $wert | ssh -o BatchMode=yes $server ('bash /opt/q-me/deploy/set-secret.sh ' + $name)
  $ergebnis = $LASTEXITCODE
  $wert = $null
  if ($ergebnis -ne 0) { Write-Host 'Abbruch: Schluessel konnte nicht gesetzt werden, Meldung oben.' -ForegroundColor Red; return }
  Write-Host '2/2 Pruefen ...' -ForegroundColor Cyan
  Start-Sleep -Seconds 4
  $pruefung = ssh -o BatchMode=yes $server ('grep -c ^' + $name + '= /etc/q-me.env; systemctl is-active q-me') 2>&1 | Out-String
  if ($pruefung -match '^\s*1\s+active') { Write-Host "Fertig: $name ist eingetragen, das Backend laeuft." -ForegroundColor Green } else { Write-Host 'Eingetragen, aber das Backend laeuft nicht richtig. Ausgabe vom Server:' -ForegroundColor Yellow; Write-Host $pruefung; ssh -o BatchMode=yes $server 'journalctl -u q-me -n 30 --no-pager' }
}
```

Ob ein Schlüssel gesetzt ist (ohne ihn zu zeigen): `grep -c ^GOOGLE_MAPS_API_KEY= /etc/q-me.env`.
Missbrauch bremst das Backend selbst: nur angemeldete Betriebe, je Konto und Stunde höchstens 300 Suchen,
40 übernommene Einträge und 12 ausgelesene Webseiten.

## Benachrichtigungen („Gleich dran“, Erinnerungen)

Ein eigener Hintergrunddienst im Backend (`app/libs/notify_worker.py`) schickt Kunden eine Nachricht, kurz
bevor sie dran sind, und wenn der Tresen sie aufruft. Gebuchte Termine bekommen 2 Stunden vorher eine
Erinnerung. Er startet zusammen mit „Früher dran“, sobald die Datenbank eingerichtet ist.

- **Web-Push:** Die Schlüssel (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) erzeugt `update.sh` beim ersten Lauf
  selbst und schreibt sie nach `/etc/q-me.env`. Nichts zu tun. Auf dem iPhone gehen Push-Nachrichten nur aus
  der App vom Home-Bildschirm; dort bietet die Nummernseite die E-Mail an.
- **Push an die iPhone/iPad-App:** zurzeit aus. Bis Stufe 5 lief er über Firebase Cloud Messaging; künftig geht er
  direkt an Apple (APNs), dafür braucht es den APNs-Schlüssel aus dem Apple-Entwicklerkonto (`app/libs/fcm.py`,
  `mobile/README.md`). Bis dahin bekommt die App Erinnerungen per E-Mail.
- **E-Mail:** braucht `RESEND_API_KEY` (Abschnitt „Schlüssel eintragen“). Links in E-Mails zeigen auf
  `PUBLIC_URL` (Standard `https://dranzeit.de`, kein Geheimnis, in `/etc/q-me.env` änderbar), das Logo im Kopf
  der Mails ebenso (`/img/mail/logo.png`, neu erzeugen mit `node dev/mail-logo.cjs`). Auch „Passwort vergessen“
  läuft über Resend (`app/apis/password_reset`, Link auf `/passwort-neu`); ohne Schlüssel geht keine Mail raus.
- **Postfach:** `hilfe@dranzeit.de` und `hallo@dranzeit.de` sind ein freigegebenes Postfach „Dranzeit“ in
  Microsoft 365 (ITEBV GmbH). DNS dafür in der Hetzner-Zone `dranzeit.de`: MX auf
  `dranzeit-de.mail.protection.outlook.com`, SPF `include:spf.protection.outlook.com` am Domain-Namen,
  `autodiscover`. Die Resend-Einträge liegen getrennt davon auf `send.` und `resend._domainkey`.
- Kunden schalten das auf ihrer Nummernseite `/nummer/<id>` ein; dorthin führt jetzt das Nummer-Ziehen.
- **Start-Mails an Läden** (`app/libs/onboarding_mail.py`, im selben Dienst): Willkommen, eine Erinnerung zum
  Ausprobieren (2–7 Tage nach dem Anlegen, nur wenn noch nichts eingetragen ist) und „Testphase endet“ (5 Tage
  vorher, nicht bei laufendem Abo). Je Laden einmal, geprüft alle 15 Minuten, Testadressen (`@example.com`)
  ausgenommen. Antworten gehen an `hilfe@dranzeit.de` (Postfach siehe oben).

## Ein Platz nur einmal (Belegung je Person und Tag)

Seit 20.10.2026 schreibt jede Buchung, Nummer, Verschiebung, Absage und „Früher dran“-Annahme in derselben
Transaktion zwei Hilfsdokumente fort (heute im Backend, z. B. `backend/app/libs/team_termine.py`):

- `schedules/{staffId}_{YYYY-MM-DD}` – belegte Zeiten der Person an dem Tag (nur Termin-IDs und Uhrzeiten)
- `shop_days/{shopId}_{YYYY-MM-DD}` – an dem Tag vergebene Nummern des Ladens

Seit 23.10.2026 dazu je Termin seine öffentliche Kurzfassung `public_appointments/{Termin-ID}` (Zeit, Person,
Leistung, Status, Nummer – keine Namen, Kontakte, Konten; `frontend/src/utils/firestore/public-appointments.ts`).
Platzsuche, Nummernseite und Wartezimmer-Bildschirm lesen ohne Anmeldung nur sie. Das Backend legt sie beim ersten
Start für alle Termine an (Log „Kurzfassungen der Termine angelegt“, danach Vermerk `meta/public_appointments`) und
gleicht sie laufend ab (Log „Kurzfassungen der Termine: … angeglichen“, `backend/app/libs/public_appointments.py`).

Nichts einzurichten: Beide Sammlungen schreibt nur das Backend.

Dokumente vergangener Tage löscht das Backend einmal am Tag (zusammen mit dem Datenschutz-Aufräumen). Termine von
vor der Umstellung stehen nicht in der Belegung; die prüft die App wie bisher vor dem Speichern. Browserfenster,
die schon vor dem Update offen waren, buchen bis zum Neuladen noch ohne Sperre.

## Firebase-Projekt (Rest bis zur Löschung)

Seit Stufe 5 von `requirements/eigene-datenbank.md` nutzt Dranzeit Firebase nicht mehr: kein Firebase im Browser, kein
Firebase-Paket im Backend. Im Projekt `qmedata-7c79e` liegt nur noch:

- die alte Kopie der Datenbank aus der Zeit bis 04.11.2026 (Firestore, für den Browser seit der Regel-Fassung
  2026-11-04 gesperrt),
- die alten Bilder in Firebase Storage, bis `deploy/dateiumzug.sh umzug` sie geholt hat,
- die Konten mit ihren alten Passwörtern. Die braucht nur noch die erste Anmeldung eines Kontos, das sich seit
  Stufe 4 noch nicht angemeldet hat (siehe „Anmeldung“).

Löschen (Stefan, in der Firebase-Konsole → Projekteinstellungen → Projekt löschen), sobald die Bilder geholt sind und
die eigenen Konten sich einmal angemeldet haben. Wer danach noch kein neues Passwort hat, nimmt „Passwort vergessen?“.
Den Dienstkonto-Schlüssel `/etc/q-me/firebase-service-account.json` und die Zeilen `FIREBASE_*` in `/etc/q-me.env`
braucht der Server nicht mehr; sie können mit dem Projekt weg.

## Hilfe-Bereich (/hilfe)

Anleitungen, häufige Fragen und Begriffe für Läden und Kunden. Die Artikel sind Markdown-Dateien in
`backend/app/hilfe/artikel/` (Anleitung: `backend/app/hilfe/README.md`), das Backend macht daraus fertige Seiten
samt Suche und Sitemap. Neue oder geänderte Artikel kommen mit dem normalen Update.

Caddy muss `/hilfe` ans Backend geben. Das stellt `caddy-domain.py` ein, aber nur, wenn man es nach diesem Update
**einmal neu ausführt** – mit denselben Adressen wie beim Umzug (Block „Umzug auf dranzeit.de“), z. B.
`python3 /opt/q-me/deploy/caddy-domain.py dranzeit.de --redirect-from www.dranzeit.de q-me.spielmacherei.de`.
Bis dahin leitet die App `/hilfe` auf `/routes/seo/hilfe` weiter; es funktioniert also auch vorher.

## Kasten für Webseiten der Läden (/einbau)

Läden bauen unter „Mein Laden“ → „Auf deiner Webseite“ einen Kasten (iframe auf `/einbau/<Laden-ID>`), einen Knopf
oder den QR-Code als Bild auf ihrer eigenen Webseite ein (`backend/app/einbau.py`, QR-Code mit dem Paket `segno` aus
`requirements.txt`; kommt mit dem normalen Update).

Caddy muss `/einbau/*` ans Backend geben und das Einbetten aller anderen Seiten verbieten
(`Content-Security-Policy: frame-ancestors 'self'` und `X-Frame-Options: SAMEORIGIN`, Schutz vor Clickjacking). Beides
stellt `caddy-domain.py` ein – nach diesem Update **einmal neu ausführen**, mit denselben Adressen wie zuletzt, z. B.
`python3 /opt/q-me/deploy/caddy-domain.py dranzeit.de --redirect-from www.dranzeit.de q-me.spielmacherei.de dranzeit.com www.dranzeit.com`.
Bis dahin leitet die App `/einbau/…` auf `/routes/seo/einbau/…` weiter (geht, lädt aber erst die ganze App).

Prüfen: `curl -sI https://dranzeit.de/ | grep -i frame` zeigt beide Kopfzeilen, `curl -sI https://dranzeit.de/einbau/<Laden-ID>`
keine davon.

## Termin-API der Läden (/api/v1)

Programme eines Ladens (Webseite, Kasse) legen über `https://dranzeit.de/api/v1/…` Kunden, Leistungen und Termine an,
verschieben und sagen ab (`backend/app/schnittstelle`, Anforderung `requirements/termin-api.md`). Beschreibung zum
Ausprobieren: `https://dranzeit.de/api/v1/docs`. Den Schlüssel erzeugt der Inhaber unter „Laden“ → „Schnittstelle (API)“;
gespeichert wird nur sein Hash (Sammlung `api_schluessel`). Ab Tarif Solo. Kein Eintrag in `/etc/q-me.env` nötig.

Caddy muss `/api/*` ans Backend geben. Das stellt `caddy-domain.py` ein – nach diesem Update **einmal neu ausführen**,
mit denselben Adressen wie zuletzt (siehe „Kasten für Webseiten der Läden“). Bis dahin geht die API auch unter
`/routes/…` nicht, sie hängt nur unter `/api/v1`.

Prüfen: `curl -s https://dranzeit.de/api/v1/laden` antwortet mit `{"fehler": {"code": "kein_zugang", …}}`.

Webhooks (`backend/app/libs/webhooks.py`) brauchen nichts Eigenes: Beobachter und Zusteller starten mit dem Dienst
(Threads `webhooks-beobachten`, `webhooks-zustellen`), der Beobachter hört erst, wenn ein Laden einen Webhook hat.
Fehler stehen im Protokoll mit „Webhooks:“ (`journalctl -u q-me | grep Webhooks`). Die Datenbank-Sammlungen heißen
`api_webhooks`, `api_webhook_stand`, `api_webhook_zustellungen`.

## Suchmaschinen (Search Console, Seitenköpfe)

Die Domain `dranzeit.de` ist in der Google Search Console als Domain-Property per DNS bestätigt (TXT-Eintrag
`google-site-verification=…` am Apex der Hetzner-Zone; nicht löschen, sonst verliert das Konto den Zugriff).
Sitemap: `https://dranzeit.de/sitemap.xml` (Backend, `app/seo.py`), steht auch in `robots.txt`.

Die öffentlichen Seiten der App (`/`, `/features`, `/preise`, `/shop-map`, Rechtliches) bekommen beim Bauen je eine
eigene HTML-Datei mit Titel, Beschreibung, Canonical und Vorschaubild (`frontend/src/utils/seiten-kopf.ts`), alle
übrigen Adressen `app.html` ohne Canonical; in der App sind sie `noindex`. Caddy liefert sie per
`try_files {path} {path}.html {path}index.html /app.html /index.html` aus – das stellt `caddy-domain.py` ein, nach diesem Update
**einmal neu ausführen** (Adressen wie oben). Bis dahin bekommt jede Adresse `index.html` mit dem Kopf der Startseite;
die App korrigiert ihn, Google sieht also nach dem Rendern trotzdem das Richtige.

Prüfen: `curl -s https://dranzeit.de/preise | grep canonical` zeigt `https://dranzeit.de/preise`,
`curl -s https://dranzeit.de/ | grep -c ld+json` zeigt `1` (Startseite aus index.html), `curl -s https://dranzeit.de/login | grep -c canonical` zeigt `0`.

## Zwischenspeicher im Browser (Cache)

Die Bausteine unter `/assets/` tragen ihren Inhalt-Hash im Namen und dürfen ein Jahr im Browser bleiben
(`immutable`). Alles andere – vor allem die HTML-Dateien `index.html`, `app.html`, `preise.html` … – kommt mit
`Cache-Control: no-cache`: Der Browser fragt jedes Mal nach (meist nur `304`), damit nach dem Ausrollen sofort die
neuen Bausteine geladen werden. Fehlt ein Baustein (Seite vor dem Ausrollen geöffnet), antwortet Caddy ehrlich mit
`404` statt mit `app.html`; die App lädt dann einmal neu. Beides stellt `caddy-domain.py` ein – nach diesem Update
**einmal neu ausführen** (Adressen wie oben).

Prüfen: `curl -sI https://dranzeit.de/preise | grep -i cache-control` zeigt `no-cache`,
`curl -so /dev/null -w '%{http_code}' https://dranzeit.de/assets/gibts-nicht.js` zeigt `404`.
Wie groß die Bausteine je Seite sind: `node dev/bundle-groesse.cjs` (Anleitung `dev/README.md`).

## Telefon-Assistent (Probelauf)

Eine Sprach-KI nimmt Anrufe für einen Laden an. Sie nennt freie Termine und bucht sie, sagt die Wartezeit, zieht
Nummern und beantwortet Fragen. Die Anforderung steht in `requirements/telefon-assistent.md`, Konten und
Einrichtung der Plattform in [telefon-assistent.md](telefon-assistent.md). Das Backend stellt dafür
`/routes/telefon/…` bereit (`backend/app/apis/telefon`). Die Plattform meldet sich mit einem Zugangsschlüssel
an, der in `/etc/q-me.env` als `QME_TELEFON_TOKEN` steht. Ohne Schlüssel antwortet die Schnittstelle mit 503.

**Zugangsschlüssel erzeugen:** Den Block in PowerShell einfügen. Er erzeugt einen zufälligen Schlüssel, schreibt
ihn über die Standardeingabe auf den Server und legt ihn in die Zwischenablage. Von dort fügst du ihn bei der
Sprach-KI-Plattform als Geheimnis ein. Im Fenster und in der History steht er nie.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $skript = ssh -o BatchMode=yes $server 'grep -c QME_TELEFON_TOKEN /opt/q-me/deploy/set-secret.sh' 2>&1 | Out-String
  if ($skript -notmatch '^\s*[1-9]') { Write-Host 'Abbruch: Der Server kennt den Telefon-Assistenten noch nicht. Erst den Block "Aktualisieren" ausfuehren.' -ForegroundColor Red; return }
  $schon = ssh -o BatchMode=yes $server 'grep -c ^QME_TELEFON_TOKEN= /etc/q-me.env' 2>&1 | Out-String
  if ($schon -match '^\s*1') { $neu = Read-Host 'Es gibt schon einen Zugangsschluessel. Neuen erzeugen? Der alte gilt dann sofort nicht mehr (j/n)'; if ($neu -ne 'j') { Write-Host 'Nichts geaendert.' -ForegroundColor Yellow; return } }
  $bytes = New-Object byte[] 32
  $zufall = [Security.Cryptography.RandomNumberGenerator]::Create()
  $zufall.GetBytes($bytes)
  $zufall.Dispose()
  $wert = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  Write-Host '1/3 Schluessel auf den Server schreiben und Backend neu starten ...' -ForegroundColor Cyan
  $wert | ssh -o BatchMode=yes $server 'bash /opt/q-me/deploy/set-secret.sh QME_TELEFON_TOKEN'
  if ($LASTEXITCODE -ne 0) { $wert = $null; Write-Host 'Abbruch: Schluessel konnte nicht gesetzt werden, Meldung oben.' -ForegroundColor Red; return }
  Write-Host '2/3 Pruefen, ob die Schnittstelle antwortet ...' -ForegroundColor Cyan
  $status = ''
  for ($i = 0; $i -lt 10 -and $status -ne '401'; $i++) { Start-Sleep -Seconds 3; $status = (curl.exe -s -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' https://dranzeit.de/routes/telefon/laden | Out-String).Trim() }
  Set-Clipboard -Value $wert
  $wert = $null
  if ($status -eq '401') { Write-Host '3/3 Fertig: Der Schluessel ist eingetragen und liegt in der Zwischenablage. Jetzt bei der Plattform als Geheimnis einfuegen (Strg+V), danach etwas anderes kopieren.' -ForegroundColor Green } else { Write-Host "Eingetragen und in der Zwischenablage, aber die Schnittstelle antwortet mit Status '$status' statt 401. Ausgabe vom Server:" -ForegroundColor Yellow; ssh -o BatchMode=yes $server 'journalctl -u q-me -n 30 --no-pager' }
}
```

Ob ein Schlüssel gesetzt ist (ohne ihn zu zeigen): `grep -c ^QME_TELEFON_TOKEN= /etc/q-me.env`. Ein neuer Lauf
erzeugt einen neuen Schlüssel, und der alte gilt dann sofort nicht mehr. Dann muss der neue Schlüssel auch bei
der Plattform eingetragen werden.

**Eingang freischalten:** Den Block in PowerShell einfügen. Er fragt den Twilio Auth Token (Twilio-Konsole, Dashboard,
„Account Info“) und den Vapi Private Key (Vapi, „API Keys“) verdeckt ab und schreibt sie auf den Server. Danach muss
`https://dranzeit.de/routes/telefon-eingang` ohne Unterschrift mit 403 antworten.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $skript = ssh -o BatchMode=yes $server 'grep -c QME_TWILIO_AUTH_TOKEN /opt/q-me/deploy/set-secret.sh' 2>&1 | Out-String
  if ($skript -notmatch '^\s*[1-9]') { Write-Host 'Abbruch: Der Server kennt den Telefon-Eingang noch nicht. Erst den Block "Aktualisieren" ausfuehren.' -ForegroundColor Red; return }
  $eintraege = @(@('QME_TWILIO_AUTH_TOKEN', 'Twilio Auth Token (wird nicht angezeigt)'), @('QME_VAPI_API_KEY', 'Vapi Private Key (wird nicht angezeigt)'))
  foreach ($eintrag in $eintraege) {
    $geheim = Read-Host $eintrag[1] -AsSecureString
    $zeiger = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($geheim)
    $wert = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($zeiger)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($zeiger)
    if (-not $wert) { Write-Host ('Abbruch: Nichts eingegeben fuer ' + $eintrag[0] + '.') -ForegroundColor Red; return }
    $wert | ssh -o BatchMode=yes $server ('bash /opt/q-me/deploy/set-secret.sh ' + $eintrag[0])
    $ende = $LASTEXITCODE
    $wert = $null
    if ($ende -ne 0) { Write-Host ('Abbruch: ' + $eintrag[0] + ' konnte nicht gesetzt werden, Meldung oben.') -ForegroundColor Red; return }
  }
  $status = ''
  for ($i = 0; $i -lt 10 -and $status -ne '403'; $i++) { Start-Sleep -Seconds 3; $status = (curl.exe -s -o NUL -w '%{http_code}' -X POST https://dranzeit.de/routes/telefon-eingang | Out-String).Trim() }
  if ($status -eq '403') { Write-Host 'Fertig: Beide Schluessel sind eingetragen, der Eingang antwortet.' -ForegroundColor Green } else { Write-Host "Eingetragen, aber der Eingang antwortet mit Status '$status' statt 403. Ausgabe vom Server:" -ForegroundColor Yellow; ssh -o BatchMode=yes $server 'journalctl -u q-me -n 30 --no-pager' }
}
```

Ohne `QME_TWILIO_AUTH_TOKEN` antwortet der Eingang mit 503. Kein Geheimnis sind die übrigen Werte, sie stehen ebenfalls in
`/etc/q-me.env`: `QME_VAPI_ASSISTANT_ID`, `QME_VAPI_PHONE_NUMBER_ID` und `QME_TELEFON_NUMMER`, die gemeinsame Nummer, die
Läden als Ziel ihrer Umleitung sehen (ohne Pluszeichen, z. B. `4930…`).

**Laden zulassen:** Im Betreiber-Bereich den Laden öffnen, Abschnitt „Telefon-Assistent“, „Für diesen Laden freigegeben“
ankreuzen und die freien Minuten festlegen. Solange es keinen Zusatz im Tarif gibt, sieht nur ein zugelassener Laden die
Kachel „Telefon-Assistent“ unter „Laden“. Der Inhaber trägt dort seine Nummer ein, richtet die Umleitung ein und macht
einen Probeanruf.

**Eigene Nummer:** Kommt die Nummer eines Ladens bei der Umleitung nicht an, bleibt der Probeanruf aus. Dann im
Betreiber-Bereich unter „Rufnummer“ eine eigene Twilio-Nummer eintragen. Sie muss in Twilio auf denselben Eingang zeigen.
Sie steht in `telefon_leitungen/{+49…}`, nur das Backend liest das. Wird der Laden gelöscht, wird seine Nummer wieder frei.
Ohne Telefon (Probe im Browser der Plattform) gilt die gewählte Nummer dieser Zeile.

**Was ein Anruf anlegt:** Termine und Nummern wie bei einer Buchung ohne Konto, also mit Tagesnummer, Name und
Telefonnummer des Anrufers, gekennzeichnet mit `source: "telefon"`. Sie stehen ganz normal im Kalender, in der
Schlange und auf dem Bildschirm. Ein Platz geht dabei nur einmal weg, auch wenn gleichzeitig online oder am
Tresen gebucht wird (`backend/app/libs/buchung.py`).

## Ersparnis-Rechner (/rechner) und alte Vergleichsseite

Der Vergleich mit Treatwell, Planity und anderen ist nach salonlotse.de umgezogen (Repo `itebvgmbh/salonlotse`).
`/vergleich/…` leitet dauerhaft dorthin weiter (`backend/app/vergleich.py`); dafür bleibt `/vergleich` in `caddy-domain.py`.

An seiner Stelle rechnet `/rechner` (`frontend/src/pages/Rechner.tsx`) aus, was ein Laden mit Telefon-Assistent und
Nachrücken im Monat gewinnt, abzüglich Abo. Die Rechnung steht in `frontend/src/utils/ersparnis.ts`, Test ohne Browser:
`node --experimental-strip-types dev/ersparnis.test.mjs`. Preise kommen aus `utils/plans.ts` und `utils/telefon-assistent.ts`.

## Abo-Abrechnung (Stripe)

Läden schließen ihr Abo unter „Mein Tarif“ (`/tarif`) ab; bezahlt wird über Stripe Checkout, verwaltet und
gekündigt im Stripe-Kundenportal. Den Stand schreibt ein Webhook an den Laden. Erst im **Testmodus** einrichten.

1. **Schlüssel:** Stripe-Dashboard (Testmodus) → Entwickler → API-Schlüssel → „Eingeschränkten Schlüssel
   erstellen“ mit Schreibrechten für Produkte, Preise, Kunden, Checkout-Sessions, Kundenportal und
   Webhook-Endpunkte sowie Leserecht für Abonnements. (Ein `sk_test_…` geht auch, ist aber mächtiger.)
   Eintragen mit dem Block „Schlüssel eintragen“, Option 5.
2. **Einrichten:** Block unten. Er legt Produkte und Preise an (netto, Gründerpreise inklusive), den Webhook
   auf `<adresse>/routes/stripe/webhook` und das Kundenportal. Das Webhook-Geheimnis schreibt das Skript direkt
   nach `/etc/q-me.env`, es erscheint nirgends. Mehrfach ausführbar.
3. **Im Dashboard:** Einstellungen → Steuern → Registrierung Deutschland anlegen (sonst rechnet Stripe keine
   Mehrwertsteuer). Einstellungen → Zahlungsmethoden → SEPA-Lastschrift einschalten. Einstellungen →
   Kunden-E-Mails → Rechnungen und Belege per E-Mail einschalten. Rechnungsvorlage, Fußzeile, USt-IdNr. und
   Nummernkreis: Abschnitt „Rechnungen“ unten.
4. **Testen:** Als Inhaber unter `/tarif` „Weiter zur Bezahlung“, Testkarte `4242 4242 4242 4242`.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $schluessel = ssh -o BatchMode=yes $server 'grep -c ^STRIPE_SECRET_KEY= /etc/q-me.env' 2>&1 | Out-String
  if ($schluessel -notmatch '^\s*1') { Write-Host 'Abbruch: STRIPE_SECRET_KEY fehlt. Erst den Block "Schluessel eintragen" ausfuehren (Option 5).' -ForegroundColor Red; return }
  $adresse = Read-Host 'Adresse der App (Enter = https://dranzeit.de)'
  if (-not $adresse) { $adresse = 'https://dranzeit.de' }
  $adresse = $adresse.Trim().Trim('"').TrimEnd('/')
  if ($adresse -notmatch '^https://[a-z0-9.-]+$') { Write-Host 'Abbruch: Bitte eine Adresse wie https://dranzeit.de eingeben.' -ForegroundColor Red; return }
  Write-Host "Stripe fuer $adresse einrichten ..." -ForegroundColor Cyan
  $ausgabe = ssh -o BatchMode=yes $server ('cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/stripe-setup.py ' + $adresse + ' && systemctl restart q-me') 2>&1 | Out-String
  $ergebnis = $LASTEXITCODE
  Write-Host $ausgabe
  if ($ergebnis -ne 0 -or $ausgabe -notmatch 'Fertig') { Write-Host 'Abbruch: Einrichtung fehlgeschlagen, Meldung oben.' -ForegroundColor Red; return }
  Start-Sleep -Seconds 4
  $pruefung = ssh -o BatchMode=yes $server 'grep -c ^STRIPE_WEBHOOK_SECRET= /etc/q-me.env; systemctl is-active q-me' 2>&1 | Out-String
  if ($pruefung -match '^\s*1\s+active') { Write-Host 'Fertig: Stripe ist eingerichtet, das Backend laeuft.' -ForegroundColor Green } else { Write-Host 'Eingerichtet, aber etwas fehlt. Ausgabe vom Server:' -ForegroundColor Yellow; Write-Host $pruefung }
}
```

Wechsel auf echte Zahlungen: dasselbe mit dem Live-Schlüssel wiederholen. Vorher `STRIPE_WEBHOOK_SECRET` und
`STRIPE_PORTAL_CONFIG` aus `/etc/q-me.env` löschen, damit das Skript Webhook und Portal im Live-Modus neu anlegt.
Die Rechnungseinstellungen aus dem Abschnitt „Rechnungen“ im Livemodus noch einmal kontrollieren.

### Testmodus je Laden (Stripe-Sandbox)

Im Betreiber-Bereich lässt sich jeder Laden einzeln auf die Stripe-Sandbox umstellen (Laden → „Abo bei Stripe“ →
„Auf Sandbox umstellen …“). Abo abschließen, Kundenportal, Rechnungen und Kündigung laufen dann mit Testkarten,
alle anderen Läden zahlen weiter echt. Der Laden fängt ohne Abo an, der Inhaber sieht unter „Mein Tarif“ einen
Hinweis. „Zurück auf echte Zahlungen“ beendet das Sandbox-Abo und holt den Stand eines echten Abos von Stripe zurück.
Sandbox-Abos zählen nicht zum Umsatz und halten das Löschen eines Ladens nicht auf. Gespeichert in
`shops/{id}/privat/stripe_test` (`backend/app/libs/shop_privat.py`); der Webhook erkennt am Geheimnis, aus welchem
Modus eine Meldung kommt, und ändert nur Läden im selben Modus.

Einmal einrichten: den Geheimschlüssel (`sk_test_…`) der Dranzeit-Sandbox (Stripe-Dashboard → Sandbox → Entwickler →
API-Schlüssel) mit dem Block unten eintragen. Er legt dort Produkte, Preise, den Webhook (gleiche Adresse wie der
echte) und das Kundenportal an; Geheimnis und Portal landen als `STRIPE_TEST_…` in `/etc/q-me.env`. Ein Live-Schlüssel
wird an dieser Stelle nie angenommen. Mehrfach ausführbar; nur Enter behält den vorhandenen Schlüssel.

Zum Testen: Karte `4242 4242 4242 4242`, beliebiges Ablaufdatum in der Zukunft, beliebige Prüfnummer;
SEPA-Lastschrift mit der IBAN `DE89 3704 0044 0532 0130 00`.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $neu = ssh -o BatchMode=yes $server 'grep -c STRIPE_TEST_SECRET_KEY /opt/q-me/deploy/set-secret.sh' 2>&1 | Out-String
  if ($neu -notmatch '^\s*[1-9]') { Write-Host 'Abbruch: Der Server ist noch nicht auf dem Stand mit Testmodus je Laden. Erst ausrollen, dann diesen Block noch einmal.' -ForegroundColor Red; return }
  $vorhanden = ssh -o BatchMode=yes $server 'grep -c ^STRIPE_TEST_SECRET_KEY=.k_test_ /etc/q-me.env' 2>&1 | Out-String
  $frage = 'Stripe-SANDBOX-Schluessel einfuegen (sk_test_..., Strg+V, wird nicht angezeigt), dann Enter'
  if ($vorhanden -match '^\s*1') { $frage = $frage + ' - nur Enter behaelt den vorhandenen' }
  $geheim = Read-Host $frage -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($geheim)
  try { $wert = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if (-not $wert -and $vorhanden -match '^\s*1') { Write-Host '1/3 Der vorhandene Sandbox-Schluessel bleibt.' -ForegroundColor Cyan }
  elseif ($wert -notmatch '^(sk|rk)_test_[0-9A-Za-z]{20,}$') { $wert = $null; Write-Host 'Abbruch: Das ist kein Sandbox-Schluessel (er beginnt mit sk_test_ oder rk_test_). Nichts geaendert.' -ForegroundColor Red; return }
  else {
    Write-Host '1/3 Sandbox-Schluessel auf den Server schreiben ...' -ForegroundColor Cyan
    $wert | ssh -o BatchMode=yes $server 'bash /opt/q-me/deploy/set-secret.sh STRIPE_TEST_SECRET_KEY'
    $ergebnis = $LASTEXITCODE
    $wert = $null
    if ($ergebnis -ne 0) { Write-Host 'Abbruch: Schluessel konnte nicht gesetzt werden, Meldung oben.' -ForegroundColor Red; return }
  }
  $wert = $null
  Write-Host '2/3 Produkte, Preise, Webhook und Kundenportal in der Sandbox einrichten ...' -ForegroundColor Cyan
  $ausgabe = ssh -o BatchMode=yes $server 'cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/stripe-setup.py https://dranzeit.de --test && systemctl restart q-me' 2>&1 | Out-String
  $ergebnis = $LASTEXITCODE
  Write-Host $ausgabe
  if ($ergebnis -ne 0 -or $ausgabe -notmatch 'Fertig') { Write-Host 'Abbruch: Einrichtung in der Sandbox fehlgeschlagen, Meldung oben. Echte Zahlungen laufen weiter.' -ForegroundColor Red; return }
  Write-Host '3/3 Pruefen ...' -ForegroundColor Cyan
  Start-Sleep -Seconds 4
  $pruefung = ssh -o BatchMode=yes $server 'grep -c ^STRIPE_TEST_SECRET_KEY=.k_test_ /etc/q-me.env; grep -c ^STRIPE_TEST_WEBHOOK_SECRET= /etc/q-me.env; grep -c ^STRIPE_SECRET_KEY=.k_live_ /etc/q-me.env; systemctl is-active q-me' 2>&1 | Out-String
  if ($pruefung -match '^\s*1\s+1\s+1\s+active') { Write-Host 'Fertig: Die Sandbox ist eingerichtet. Im Betreiber-Bereich lassen sich Laeden jetzt auf die Sandbox umstellen, echte Zahlungen laufen weiter.' -ForegroundColor Green } else { Write-Host 'Eingerichtet, aber etwas fehlt. Ausgabe vom Server (erwartet: 1, 1, 1, active):' -ForegroundColor Yellow; Write-Host $pruefung }
}
```

### Telefon-Assistent als Zusatz (eigenes Abo)

Der Telefon-Assistent hat ein eigenes Monatsabo neben dem Tarif, mit demselben Stripe-Kunden (Entscheidung
05.11.2026, `backend/app/libs/telefon_abrechnung.py`). Auf der Rechnung stehen zwei Posten: der Grundpreis von 29 €
im Voraus und die Minuten nach Nutzung, gestaffelt (Minute 1–100 für 0 €, ab der 101. je 0,20 €). Die Minuten laufen
über den Billing Meter `dranzeit_telefon_minuten` mit der Formel „last“: Nach jedem Anruf meldet das Backend die
aufgerundeten Minuten des Monats, höchstens bis zum Kostendeckel des Ladens. Der Hintergrunddienst holt verpasste
Meldungen alle 5 Minuten nach. Der Webhook braucht dafür keine neuen Ereignisse.

`stripe-setup.py` legt Meter, die beiden Produkte und die Preise an: in der Sandbox bei jedem Lauf mit `--test`
(Block oben), im Live-Konto nur mit `--telefon` (Block unten). Ob Stripe in der Sandbox richtig rechnet, prüft
`deploy/telefon-stripe-probe.py`: Es legt einen Wegwerf-Kunden mit Testkarte an, meldet 120 und dann 148 Minuten,
erwartet in der Vorschau der Rechnung 9,60 € für die Minuten und löscht den Kunden wieder.

Zum Durchspielen im Testmodus: Laden im Betreiber-Bereich auf die Sandbox umstellen, als Inhaber unter „Tarif“ ein
Abo mit der Testkarte abschließen, dann unter „Laden“ → „Telefon-Assistent“ auf „Zubuchen“. Vor der Öffnung für alle
braucht der Laden dafür die Freigabe im Betreiber-Bereich (Laden → „Telefon-Assistent“).

**Live einrichten** (erst nach Stefans Freigabe): Der Block fragt nach und legt den Zusatz im Live-Konto an. Er
ändert nichts an den Tarifen, am Webhook und am Kundenportal.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $stand = ssh -o BatchMode=yes $server 'grep -c ensure_telefon /opt/q-me/deploy/stripe-setup.py; grep -c ^STRIPE_SECRET_KEY=.k_live_ /etc/q-me.env' 2>&1 | Out-String
  if ($stand -notmatch '^\s*[1-9]') { Write-Host 'Abbruch: Der Server ist noch nicht auf dem Stand mit dem Telefon-Assistenten als Zusatz. Erst ausrollen.' -ForegroundColor Red; return }
  if ($stand -notmatch '^\s*[1-9]\s+1') { Write-Host 'Abbruch: Auf dem Server steht kein Live-Schluessel (sk_live_ oder rk_live_). Nichts angelegt.' -ForegroundColor Red; return }
  $ok = Read-Host 'Telefon-Assistent im LIVE-Stripe anlegen: 29 EUR netto im Monat mit 100 Minuten, danach 0,20 EUR je Minute? (ja/nein)'
  if ($ok.Trim().Trim('"').ToLower() -ne 'ja') { Write-Host 'Abgebrochen, im Live-Stripe wurde nichts angelegt.' -ForegroundColor Yellow; return }
  Write-Host 'Meter, Produkte und Preise im Live-Stripe anlegen ...' -ForegroundColor Cyan
  $ausgabe = ssh -o BatchMode=yes $server 'cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/stripe-setup.py https://dranzeit.de --telefon && systemctl restart q-me' 2>&1 | Out-String
  $ergebnis = $LASTEXITCODE
  Write-Host $ausgabe
  if ($ergebnis -ne 0 -or $ausgabe -notmatch 'Fertig') { Write-Host 'Abbruch: Einrichtung fehlgeschlagen, Meldung oben. Tarife und Abos laufen weiter.' -ForegroundColor Red; return }
  if ($ausgabe -match 'ACHTUNG') { Write-Host 'Angelegt, aber Stripe hat abweichende Preise. Siehe ACHTUNG oben.' -ForegroundColor Yellow; return }
  Start-Sleep -Seconds 4
  $dienst = ssh -o BatchMode=yes $server 'systemctl is-active q-me' 2>&1 | Out-String
  if ($dienst -match 'active') { Write-Host 'Fertig: Der Telefon-Assistent laesst sich jetzt auch mit echten Zahlungen zubuchen.' -ForegroundColor Green } else { Write-Host "Angelegt, aber das Backend laeuft nicht: $dienst" -ForegroundColor Yellow }
}
```

**Für alle öffnen:** Betreiber-Bereich → Reiter „Betrieb“ → „Für alle Läden öffnen“. Bis dahin sehen nur Läden mit
Freigabe die Kachel. Vorher erledigen: Datenschutzerklärung und AGB um den Zusatz ergänzen, Vertrag zur
Auftragsverarbeitung mit Vapi, Twilio-Kundenprofil genehmigt (sonst nur 2 Anrufe gleichzeitig), Zusatz im
Live-Stripe angelegt (Block oben), im Hilfe-Artikel `backend/app/hilfe/artikel/telefon-assistent.md` den Satz
„Im Moment schalten wir den Assistenten noch einzeln frei …“ streichen.

## Rechnungen (PDF und E-Rechnung)

Läden laden ihre Rechnungen unter „Mein Tarif“ → „Rechnungen“ herunter: das **PDF**, so wie Stripe es per
E-Mail schickt, und dieselbe Rechnung als **E-Rechnung** (XRechnung 3.0, XML) für DATEV, lexoffice, sevDesk.
Aussteller ist die ITEBV GmbH; Stripe vergibt die Nummer, erzeugt das PDF und verschickt es. Backend:
`app/apis/invoices` (nur Inhaber, nur Rechnungen des eigenen Stripe-Kunden), E-Rechnung: `app/libs/invoices.py`.

Keine Steuerberatung, Stand Oktober 2026. Vor den ersten echten Rechnungen einmal mit dem Steuerbüro abgleichen.

### Pflichtangaben und was dafür in Stripe einzustellen ist

Stripe erfüllt die Pflichtangaben, wenn das Dashboard so eingestellt ist (im Test- **und** im Livemodus prüfen,
vor der ersten echten Rechnung):

| Pflichtangabe | Gesetz | Einstellung im Stripe-Dashboard |
|---|---|---|
| Name und Anschrift der ITEBV GmbH | § 14 Abs. 4 Nr. 1 UStG | Einstellungen → Unternehmen → Öffentliche Details: Name `ITEBV GmbH`, Zehntwerderweg 201A, 13469 Berlin, Adresse auf Rechnungen anzeigen |
| Name und Anschrift des Ladens | § 14 Abs. 4 Nr. 1 UStG | nichts: Checkout verlangt die Rechnungsadresse, den Firmennamen über „Ich kaufe als Unternehmen“ |
| USt-IdNr. `DE348787952` | § 14 Abs. 4 Nr. 2 UStG | Einstellungen → Billing → Rechnungen → „Steuerinformationen für Rechnungen“: anlegen und als Standard setzen |
| Ausstellungsdatum | § 14 Abs. 4 Nr. 3 UStG | automatisch |
| fortlaufende, einmalige Nummer | § 14 Abs. 4 Nr. 4 UStG | Einstellungen → Billing → Rechnungen → Nummerierung „fortlaufend für das gesamte Konto“, Präfix z. B. `DZ`. Vor der ersten Live-Rechnung festlegen, danach nicht mehr ändern |
| Menge und Art der Leistung | § 14 Abs. 4 Nr. 5 UStG | automatisch („1 × Dranzeit Laden“, Produktnamen aus `stripe-setup.py`) |
| Leistungszeitraum | § 14 Abs. 4 Nr. 6 UStG | automatisch (Abozeitraum je Position) |
| Entgelt netto nach Steuersatz, Rabatte | § 14 Abs. 4 Nr. 7 UStG | Einstellungen → Billing → Rechnungen → Standard-Artikelpreise: „Steuern nicht im Preis enthalten“ (Positionen netto wie die Preise und die E-Rechnung) |
| Steuersatz und Steuerbetrag | § 14 Abs. 4 Nr. 8 UStG | Stripe Tax mit Registrierung Deutschland (Abschnitt „Abo-Abrechnung“, Schritt 3) |
| Rechtsform, Sitz, Registergericht, HRB, Geschäftsführer | § 35a GmbHG | Einstellungen → Billing → Rechnungen → Standardfußzeile: `ITEBV GmbH · Sitz Berlin · Amtsgericht Berlin-Charlottenburg HRB 236012 B · Geschäftsführer: Stefan Tittmann · USt-IdNr. DE348787952` |

Sprache Deutsch setzt die App beim Anlegen des Kunden, Logo und Farbe stehen unter Einstellungen → Branding.
Kontrolle: Dashboard → Rechnungen → eine Testrechnung öffnen → PDF ansehen.

**Kleinbetragsrechnungen** (bis 250 € brutto, § 33 UStDV) brauchen weniger Angaben. Das sind alle
Monatsrechnungen (höchstens 70,21 €) und die Jahresrechnungen von Solo und Gründer-Laden (je 226,10 €).

**Kunden in anderen EU-Ländern** mit USt-IdNr. (z. B. Österreich): Stripe Tax berechnet 0 % (Reverse Charge).
Auf die Rechnung gehören dann beide USt-IdNr. und der Hinweis „Steuerschuldnerschaft des
Leistungsempfängers“, ausgestellt bis zum 15. des Folgemonats (§ 14a Abs. 1 und 5 UStG). Mit einer
Testrechnung an einen österreichischen Testkunden prüfen, dass der Hinweis auf dem PDF steht; die E-Rechnung
enthält ihn immer. Diese Umsätze gehören in die Zusammenfassende Meldung (§ 18a UStG). Gibt ein EU-Kunde
keine USt-IdNr. an, behandelt Stripe ihn wie einen Privatkunden.

### E-Rechnung

- Seit 1.1.2025 muss jedes Unternehmen in Deutschland E-Rechnungen **empfangen** können.
- **Ausstellen** müssen sie Unternehmen für Unternehmen, wenn beide in Deutschland sitzen: 2026 ist ein PDF noch
  erlaubt. 2027 nur noch, wenn der Gesamtumsatz der ITEBV GmbH **2026** höchstens 800.000 € betrug, sonst gilt
  die Pflicht ab 1.1.2027. Ab **1.1.2028** gilt sie für alle (§ 14 Abs. 1 und § 27 Abs. 38 UStG).
- Kleinbetragsrechnungen bis 250 € sind dauerhaft ausgenommen. Bei Dranzeit betrifft die Pflicht also nur die
  Jahresrechnungen **Laden (464,10 €)** und **Team (702,10 €)** und Rechnungen, die durch Tarifwechsel über
  250 € kommen.
- Zulässig sind Formate nach EN 16931: **XRechnung** oder **ZUGFeRD ab 2.0.1** (nicht die Profile MINIMUM und
  BASIC-WL). Ein PDF allein ist keine E-Rechnung, und Stripe erzeugt keine. Die App baut die XRechnung deshalb
  aus denselben Stripe-Daten wie das PDF (Nummer, Datum, Kunde, Positionen, Zeitraum, Steuer). Weichen beide
  voneinander ab, gilt das XML.
- Übermitteln per Download aus einem Kundenportal ist zulässig (BMF-Schreiben zur E-Rechnung). Genau das ist
  „Mein Tarif“ → „Rechnungen“. Das PDF aus der Stripe-E-Mail ist eine inhaltsgleiche Zweitschrift.
- Keine E-Rechnung gibt es für 0-€-Rechnungen (Testphase), stornierte Rechnungen und andere Steuerfälle als
  19 % und Reverse Charge (z. B. Kunden außerhalb der EU). Für die gilt die Pflicht auch nicht.

Die Angaben zur ITEBV GmbH in der XRechnung stehen in `backend/app/libs/invoices.py` (`SELLER`). Sie müssen zu
den öffentlichen Details in Stripe und zu `frontend/src/constants/legal.ts` passen. Prüfen gegen die
offiziellen Regeln (XML-Schema, EN 16931, XRechnung 3.0.2 der KoSIT) geht ohne Java mit
`dev/e-rechnung-pruefen.py`, auch mit einer unter „Mein Tarif“ geladenen Datei (Anleitung im Kopf des Skripts).

### Aufbewahren

Die ITEBV GmbH muss jede Rechnung **8 Jahre** aufbewahren (§ 14b UStG, § 147 AO), eine E-Rechnung im
Originalformat (XML), unveränderbar und auffindbar (GoBD). Stripe hält die Rechnungen vor, ist aber kein
Archiv im Sinne der GoBD: regelmäßig exportieren (Dashboard → Rechnungen → Exportieren, oder über die
Buchhaltung des Steuerbüros), ab Pflichtbeginn die XRechnungen der Jahresrechnungen mit. Die E-Rechnung
hängt nicht vom Zahlungsstand ab: Wer sie mehrmals lädt, bekommt dieselbe Datei. Läden sehen unter
„Mein Tarif“ bis zu 120 Rechnungen zurück, ältere im Stripe-Kundenportal.

## Umzug auf dranzeit.de

Vorher von Hand (in dieser Reihenfolge):

1. **Domains kaufen:** `dranzeit.de` und `www.dranzeit.de` (dazu am besten `.com`, `.app`, `.at`, `.ch`, `.eu`).
2. **DNS** beim Domain-Anbieter: A-Record `dranzeit.de` und `www.dranzeit.de` → `195.201.26.108`,
   AAAA-Record beider Namen → `2a01:4f8:1c18:b8d8::1`. Warten, bis der Block unten „DNS stimmt“ meldet.
3. **Resend** → Domains → `dranzeit.de` hinzufügen, die SPF/DKIM-Einträge beim Domain-Anbieter eintragen.

Dann den Block einfügen. Er prüft DNS, setzt den Dranzeit-Block in der gemeinsamen Caddyfile (alte Adresse
leitet weiter, Stadtseiten und Sitemap gehen ans Backend), stellt `PUBLIC_URL` um, richtet bei vorhandenem
Stripe-Schlüssel den Webhook auf die neue Adresse um und prüft, dass `https://dranzeit.de` antwortet.
Ohne Umzug, nur Stadtseiten auf der alten Adresse: `python3 /opt/q-me/deploy/caddy-domain.py q-me.spielmacherei.de`.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  foreach ($name in @('dranzeit.de', 'www.dranzeit.de')) { $ip = (Resolve-DnsName $name -Type A -ErrorAction SilentlyContinue | Where-Object { $_.Type -eq 'A' } | Select-Object -First 1).IPAddress; if ($ip -ne '195.201.26.108') { Write-Host "Abbruch: $name zeigt noch nicht auf den Server (gefunden: $ip). DNS-Eintrag pruefen und spaeter noch einmal." -ForegroundColor Red; return } }
  Write-Host 'DNS stimmt. 1/4 Caddy umstellen ...' -ForegroundColor Cyan
  $caddy = ssh -o BatchMode=yes $server 'python3 /opt/q-me/deploy/caddy-domain.py dranzeit.de --redirect-from www.dranzeit.de q-me.spielmacherei.de' 2>&1 | Out-String
  Write-Host $caddy
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Caddy wurde nicht umgestellt, Meldung oben. Die anderen Seiten laufen unveraendert.' -ForegroundColor Red; return }
  Write-Host '2/4 Adresse fuer Links in E-Mails setzen ...' -ForegroundColor Cyan
  ssh -o BatchMode=yes $server 'sed -i /^PUBLIC_URL=/d /etc/q-me.env && echo PUBLIC_URL=https://dranzeit.de >> /etc/q-me.env && systemctl restart q-me'
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: PUBLIC_URL konnte nicht gesetzt werden.' -ForegroundColor Red; return }
  Write-Host '3/4 Stripe-Webhook umziehen (falls eingerichtet) ...' -ForegroundColor Cyan
  $stripe = ssh -o BatchMode=yes $server 'grep -c ^STRIPE_SECRET_KEY= /etc/q-me.env' 2>&1 | Out-String
  if ($stripe -match '^\s*1') { $ausgabe = ssh -o BatchMode=yes $server 'cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/stripe-setup.py https://dranzeit.de && systemctl restart q-me' 2>&1 | Out-String; Write-Host $ausgabe; if ($ausgabe -notmatch 'Fertig') { Write-Host 'Achtung: Stripe-Webhook nicht umgezogen, Meldung oben. Der Rest ist umgestellt.' -ForegroundColor Yellow } } else { Write-Host '    Stripe noch nicht eingerichtet, uebersprungen.' }
  Write-Host '4/4 Pruefen (das Zertifikat kann beim ersten Aufruf ein paar Sekunden dauern) ...' -ForegroundColor Cyan
  $ok = $false
  for ($i = 0; $i -lt 10 -and -not $ok; $i++) { try { $antwort = Invoke-WebRequest -Uri 'https://dranzeit.de/' -UseBasicParsing -TimeoutSec 10; $ok = ($antwort.StatusCode -eq 200) } catch { Start-Sleep -Seconds 3 } }
  if ($ok) { Write-Host 'Fertig: https://dranzeit.de laeuft, die alte Adresse leitet weiter.' -ForegroundColor Green } else { Write-Host 'https://dranzeit.de antwortet noch nicht. In einer Minute im Browser pruefen; Caddy-Log: journalctl -u caddy -n 50' -ForegroundColor Yellow }
}
```

## Betreiber der App

Den Hintergrunddienst für „Früher dran“ steuern (Start/Stopp, Takt, sofort prüfen) und den Verlauf **aller**
Läden sehen darf nur der Betreiber. Inhaber sehen unter `/scheduler-control` nur den Verlauf ihrer eigenen
Läden. Wer Betreiber ist, steht in `/etc/q-me.env` (keine Geheimsache, aber nur root kann es ändern):

```bash
QME_ADMIN_EMAILS=a@example.com,b@example.com   # E-Mail des Kontos, mehrere mit Komma
QME_ADMIN_UIDS=…                               # alternativ die Konto-ID
```

Danach `systemctl restart q-me`. Ohne Eintrag kann niemand steuern; der Dienst startet trotzdem von selbst.

### Betreiber-Bereich (/betreiber)

Wer Betreiber ist, sieht im Konto-Menü (Handy: im Menü) den Punkt **Betreiber-Bereich**. Dort:

- **Übersicht**: Läden, Testphasen, zahlende Läden, Monatsumsatz netto aus Abos, offene Zahlungen, Gründerplätze,
  Konten. Testläden, Konten aus Testskripten und die eigenen (ITEBV GmbH, Betreiber) zählen nicht mit.
- **Läden** und **Konten**: Liste mit Suche und Filtern; ein Klick öffnet Stand und Eingriffe.
- **Betrieb**: was eingerichtet ist (Stripe Test/Live, Webhook, Resend, Hintergrunddienst) – nur ja/nein.
- **Protokoll**: jeder Eingriff mit Grund, wer, wann, vorher/nachher.

Eingriffe: Testphase setzen, Gründerplatz vergeben/entziehen, Tarif ohne Stripe bis zu einem Datum freischalten
(Feld `grant`, Regel in `backend/app/libs/plans.py`), Abo mit Stripe abgleichen oder die Verknüpfung lösen (z. B.
Sandbox-Kunden vor dem Live-Start), Laden sperren (nicht auffindbar, nichts buchbar, Inhaber und Team abgemeldet –
Betreiber-Konten nie), Konto sperren, Anmelde-Adresse ändern, Passwort-Mail, Bestätigungs-Mail, Löschen wie
`konten-aufraeumen.py` (Probelauf, Namen eintippen, Sicherung). Kündigen, Erstatten und Gutschriften gehen im
Stripe-Dashboard; die Laden-Ansicht verlinkt den Kunden dort.

Gründe, Protokoll und Sicherungen liegen **nicht** in der Datenbank der App, sondern im
Datenordner des Dienstes: `/opt/q-me/backend/.local_data/betreiber/` (`protokoll.jsonl`, `sicherungen/`,
`gesperrte-konten.json`, nur für den Dienst lesbar). Ein `git pull` bringt diese Dateien nicht mit und löscht sie nicht.

### Salon-Verzeichnis (Reiter Verzeichnis, Seiten unter /friseur und /barbershop)

Friseure und Barbershops, die (noch) nicht bei Dranzeit sind, bekommen eine eigene Seite mit Adresse, Telefon,
Webseite, Öffnungszeiten, Preisen und kurzem Text – buchen geht dort nicht. Dazu Seiten je Stadt, Bezirk und Ortsteil
(`/friseur/berlin`, `/friseur/berlin-pankow`, `/friseur/berlin-prenzlauer-berg`, `/barbershop/…`). Jeder echte Laden
bekommt automatisch auch eine solche Seite, mit Nummer ziehen und Termin buchen.

- **Finden**: Suche bei Google („Friseur Tegel“), Treffer ankreuzen, „Ausgewählte anlegen“. Gespeichert wird nur,
  was auf der **eigenen Webseite** des Salons steht (Impressum, Preise, Zeiten; Claude macht daraus auch den Text),
  von Google nur die Place-ID – mehr erlauben Googles Bedingungen nicht. Salons nur mit Instagram, Treatwell usw.:
  „Von Hand“ mit selbst geprüften Angaben.
- **Prüfen und veröffentlichen**: Neue Einträge sind Entwürfe. Text, Zeiten und Preise ansehen, dann
  „Speichern und veröffentlichen“. Erst dann ist die Seite erreichbar und steht in der Sitemap. Seiten mit wenig
  Inhalt (keine Zeiten, keine Preise, kein Text) bekommen `noindex`.
- **Übernahme**: Meldet sich ein Salon aus dem Verzeichnis bei Dranzeit an, steht oben „Übernahme bestätigen“
  (gleiche Google-Place-ID, sonst ähnlicher Name mit gleicher PLZ oder Lage). Bestätigen macht die Seite zur Seite
  des Ladens, die Adresse bleibt. „Nicht derselbe“ gibt dem Laden eine eigene Seite.
- **Brief an den Salon**: Direkt nach „Code erzeugen“ steht dort „Brief als PDF“: eine A4-Seite mit Anschrift fürs
  Umschlagfenster (DIN 5008 Form B, einmal drucken, zweimal falzen, DL-Umschlag), Code, QR-Code und Gründerangebot.
  Nur für veröffentlichte Seiten mit Anschrift; wer seine Seite entfernt hat, bekommt keinen. Der Brief zeigt die Wünsche
  ab 3 und die freien Gründerplätze von diesem Moment. Text und Blatt: `backend/app/libs/brief.py`, Muster ohne Firebase:
  `python dev/brief-muster.py`. Der Versand ist noch Handarbeit (Stufe 2: Briefdienst per API).
- **Übernahme per Code** (für den Brief an den Salon): Im Eintrag unten „Code erzeugen“. Der Code (z. B.
  `ABCDE-FGHJK`, 180 Tage gültig) und der Link `https://dranzeit.de/uebernehmen#code=…` samt QR-Code werden nur
  in diesem Moment gezeigt; gespeichert ist nur ein Hash. Mit dem Code richtet der Salon seinen Laden vorausgefüllt
  ein (Name, Adresse, Zeiten, Preise der Seite), und die Seite gehört ihm danach **ohne Bestätigung hier**; dazu
  bekommt er einen Gründerplatz, solange frei. Ein neuer Code macht den alten ungültig. Zu jeder Übernahme bekommen die
  Adressen aus `QME_ADMIN_EMAILS` eine Mail.
- **Übernahme ohne Brief**: „Seite übernehmen“ auf der Seite führt zuerst zum Nachweis per E-Mail
  (`backend/app/libs/uebernahme_mail.py`, Regel wie beim Entfernen): Liegt die Adresse an der Domain der Salon-Webseite oder
  steht sie dort, geht ein Link mit Code an sie (7 Tage), ab da läuft alles wie mit dem Brief. Der Code aus dem Brief gilt
  daneben weiter. Passt die Adresse nicht, ändert sich nichts, und zu jeder Anfrage kommt eine Mail an `QME_ADMIN_EMAILS`
  (Antworten gehen an die angegebene Adresse). Wer keine passende Adresse hat, kann den Laden trotzdem vorausgefüllt
  einrichten; verbunden wird dann erst über „Übernahme bestätigen“. Gleiche Angaben beweisen dabei nichts, sie stammen aus
  der Seite: vorher die Nummer von der Seite anrufen.
- **Vom Salon entfernt**: Jede Seite hat unten „Eintrag entfernen“ für den Salon selbst (Widerspruch), mit Nachweis
  (`backend/app/libs/entfernen.py`): Liegt die angegebene Adresse an der Domain der Salon-Webseite oder steht sie auf
  deren Start-, Impressums- oder Kontaktseite, geht ein Link dorthin (24 Stunden); erst damit geht die Seite offline.
  Passt die Adresse nicht, bleibt die Seite online. Zu jeder Anfrage und jeder Entfernung bekommen die Adressen aus
  `QME_ADMIN_EMAILS` eine Mail. „Nur Angaben korrigieren“ schickt nur diese Mail. Adresse und Grund stehen im Protokoll
  (nicht in der Datenbank der App). Offline nehmen von Hand und Zurückholen geht hier im Reiter.
- **Wünsche**: „Das wünsch ich mir“ auf der Seite zählt mit (je Person und Tag einmal) – Liste nach Wünschen für den
  Vertrieb.

Probelauf ohne Speichern (zeigt, ob Google-Textsuche und Claude gehen und was aus einer Webseite wird):

```bash
cd /opt/q-me/backend && .venv/bin/python ../deploy/verzeichnis-probe.py --suche "Friseur Tegel" --anlegen 2
```

„Eintrag entfernen“ echt durchspielen, ohne dass ein Salon Post bekommt: `deploy/verzeichnis-testeintrag.py` legt einen
Eintrag mit der Webseite itebv.de an (`anlegen`, `status`, `loeschen`). Eine Adresse @itebv.de passt dann zum Eintrag.

Voraussetzungen: `GOOGLE_MAPS_API_KEY` mit **Places API (New)** (wie der Einrichtungsassistent; die Textsuche kostet je
Seite mit 20 Treffern ein paar Cent), `ANTHROPIC_API_KEY`, Caddy mit den Pfaden `/friseur` und `/barbershop`
(`python3 /opt/q-me/deploy/caddy-domain.py dranzeit.de --redirect-from www.dranzeit.de q-me.spielmacherei.de dranzeit.com www.dranzeit.com`
erneut ausführen; bis dahin leitet die App auf `/routes/seo/friseur/…` um). Die Sammlung `verzeichnis` schreibt nur
das Backend.

### Briefe an Salons (Reiter Briefe, PIN eBrief)

Anforderung: `requirements/briefversand.md`. Im Reiter „Briefe“ wählt der Betreiber Salons aus und schickt sie auf einem von
zwei Wegen:

- **Als PDF (ohne Zugang):** Sammel-PDF laden, bei PIN eBrief hochladen (farbig, einseitig, nach je einer Seite trennen),
  danach „Hochgeladen“ klicken.
- **Über PIN (mit Zugang):** Dranzeit schickt jeden Brief selbst (`app/libs/briefdienst.py`). Standard ist der
  **Testmodus**: Alles geht an die Testumgebung von PIN, nichts wird gedruckt, die Salons bleiben unverändert. Umschalten
  im Reiter „Briefe“ unter Einstellungen.

Den Zugang (Benutzer und Passwort für die API) vergibt der PIN-Support (support@ebrief.de, 030 577978-800). Er kann für
Testumgebung und echten Versand verschieden sein. Die Daten liegen Base64-kodiert in `/etc/q-me.env`
(`QME_PIN_TEST_BENUTZER_B64` und `QME_PIN_TEST_PASSWORT_B64` bzw. `QME_PIN_BENUTZER_B64` und `QME_PIN_PASSWORT_B64`), damit
auch Passwörter mit Sonderzeichen durch `set-secret.sh` kommen.

**PIN eBrief: Zugang eintragen:** Den Block in PowerShell einfügen. Er fragt, ob es um die Testumgebung oder den echten
Versand geht, und fragt Benutzer und Passwort verdeckt ab. Danach legt er beim ersten Mal das Geheimnis für den Webhook
an, prüft die Anmeldung bei PIN (ohne einen Brief zu schicken) und zeigt die Webhook-Adresse, die du dem PIN-Support
schickst.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $skript = ssh -o BatchMode=yes $server 'grep -c QME_PIN_PASSWORT_B64 /opt/q-me/deploy/set-secret.sh' 2>&1 | Out-String
  if ($skript -notmatch '^\s*[1-9]') { Write-Host 'Abbruch: Der Server kennt den Versand ueber PIN noch nicht. Erst den Block "Aktualisieren" ausfuehren.' -ForegroundColor Red; return }
  $wahl = Read-Host 'Zugang fuer die Testumgebung (t) oder fuer den echten Versand (e)? [t]'
  $art = 'test'
  $praefix = 'QME_PIN_TEST_'
  if ($wahl -match '^\s*[eE]') { $art = 'echt'; $praefix = 'QME_PIN_' }
  $eintraege = @(@('BENUTZER_B64', "Benutzername von PIN eBrief ($art, wird nicht angezeigt)"), @('PASSWORT_B64', "Passwort von PIN eBrief ($art, wird nicht angezeigt)"))
  foreach ($eintrag in $eintraege) {
    $geheim = Read-Host $eintrag[1] -AsSecureString
    $zeiger = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($geheim)
    $wert = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($zeiger)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($zeiger)
    if (-not $wert) { Write-Host ('Abbruch: Nichts eingegeben fuer ' + $praefix + $eintrag[0] + '.') -ForegroundColor Red; return }
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($wert)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $wert = $null
    $b64 | ssh -o BatchMode=yes $server ('bash /opt/q-me/deploy/set-secret.sh ' + $praefix + $eintrag[0])
    $ende = $LASTEXITCODE
    $b64 = $null
    if ($ende -ne 0) { Write-Host ('Abbruch: ' + $praefix + $eintrag[0] + ' konnte nicht gesetzt werden, Meldung oben.') -ForegroundColor Red; return }
  }
  $vorhanden = ssh -o BatchMode=yes $server 'grep -c ^QME_PIN_WEBHOOK_GEHEIMNIS= /etc/q-me.env' 2>&1 | Out-String
  if ($vorhanden -notmatch '^\s*[1-9]') { ssh -o BatchMode=yes $server 'openssl rand -hex 24 | bash /opt/q-me/deploy/set-secret.sh QME_PIN_WEBHOOK_GEHEIMNIS'; if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Das Geheimnis fuer den Webhook konnte nicht angelegt werden, Meldung oben.' -ForegroundColor Red; return } }
  $probe = ssh -o BatchMode=yes $server ('cd /opt/q-me/backend && .venv/bin/python ../deploy/pin-pruefen.py ' + $art) 2>&1 | Out-String
  $probeEnde = $LASTEXITCODE
  Write-Host $probe.Trim()
  if ($probeEnde -ne 0) { Write-Host 'Eingetragen, aber die Anmeldung bei PIN klappt nicht. Benutzer und Passwort pruefen und den Block noch einmal ausfuehren.' -ForegroundColor Yellow; return }
  $zeile = ssh -o BatchMode=yes $server 'grep ^QME_PIN_WEBHOOK_GEHEIMNIS= /etc/q-me.env' 2>&1 | Out-String
  $adresse = 'https://dranzeit.de/routes/briefdienst/webhook/' + ($zeile.Trim() -replace '^QME_PIN_WEBHOOK_GEHEIMNIS=', '')
  Write-Host 'Fertig. Diese Webhook-Adresse an support@ebrief.de schicken (fuer Status-Meldungen zu deinen Auftraegen):' -ForegroundColor Green
  Write-Host $adresse
}
```

Ohne Webhook fragt Dranzeit den Stand der Briefe alle 6 Stunden selbst ab (Hintergrunddienst, `app/apis/schedulers`);
Rückläufer (`DOCUMENT_SENT_BACK`) sperren den Salon wie der Knopf „Unzustellbar“. Den Zugang später noch einmal prüfen:

```bash
cd /opt/q-me/backend && .venv/bin/python ../deploy/pin-pruefen.py test
```

Nicht mit `git pull`: Konto bei PIN eBrief, AVV mit PIN, Guthaben bzw. Zahlart, der API-Zugang vom Support und das
Eintragen der Webhook-Adresse durch den Support.

## Konten aufräumen

**Nur die Wegwerf-Konten der Testskripte?** Dafür reicht der Betreiber-Bereich: Reiter „Läden“ oder „Konten“ →
**„Testkonten aufräumen …“**. Er zeigt im Probelauf alle Konten mit Testadresse (`@example.com` u. ä.) samt ihren Läden
und verwaiste Testläden, und löscht genau diese Liste nach dem Eintippen von „löschen“ – mit derselben Sicherung und
Nachprüfung wie unten. Betreiber, Konten bei der ITEBV GmbH und Läden mit laufendem Abo bleiben (stehen mit Grund im Dialog).

`deploy/konten-aufraeumen.py` (Erklärung im Kopf der Datei): erst eine Liste aller Konten und Läden, dann wird nur
gelöscht, was ausdrücklich genannt ist. Ein Konto löschen heißt dasselbe wie „Konto löschen“ im Profil; Läden gehen
nur mit, wenn sie selbst genannt sind. Der Laden ITEBV GmbH, Betreiber-Konten und Läden mit laufendem Abo sind
geschützt. Vor dem Löschen legt das Skript eine Sicherung unter `/var/lib/q-me/konten/` an (nur für den Dienst lesbar). Es läuft als Benutzer `q-me` mit der Umgebung des Dienstes, liest also PostgreSQL und die eigenen Konten.

**1. Liste** (ändert nichts). Speichert sie in `Downloads` und in der Zwischenablage:

```powershell
& {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $server = 'root@195.201.26.108'
  $optionen = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
  $schluessel = Join-Path $env:USERPROFILE '.ssh\id_ed25519_spielmacherei'
  if (Test-Path -LiteralPath $schluessel) { $optionen = @('-i', $schluessel) + $optionen }
  $verbindung = ssh @optionen $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" aus deploy/README.md ausfuehren.' -ForegroundColor Red; return }
  $stand = ssh @optionen $server 'test -f /opt/q-me/deploy/konten-aufraeumen.py && echo da' 2>&1 | Out-String
  if ($stand -notmatch 'da') { Write-Host 'Abbruch: Auf dem Server fehlt deploy/konten-aufraeumen.py. Erst den Block "Aktualisieren" aus deploy/README.md ausfuehren.' -ForegroundColor Red; return }
  Write-Host 'Lese alle Konten und Laeden (aendert nichts, dauert etwa eine halbe Minute) ...' -ForegroundColor Cyan
  $text = ssh @optionen $server 'cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/konten-aufraeumen.py liste' 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $text -notmatch 'Nummern gemerkt') { Write-Host 'Abbruch: Die Liste konnte nicht erstellt werden. Meldung vom Server:' -ForegroundColor Red; Write-Host $text; return }
  $ordner = Join-Path $env:USERPROFILE 'Downloads'
  if (-not (Test-Path -LiteralPath $ordner)) { $ordner = $env:USERPROFILE }
  $datei = Join-Path $ordner ('dranzeit-konten-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.txt')
  [System.IO.File]::WriteAllText($datei, $text, (New-Object System.Text.UTF8Encoding $true))
  Write-Host $text
  $text | Set-Clipboard
  Write-Host "Fertig: Liste gespeichert in $datei und in der Zwischenablage. Geaendert wurde nichts." -ForegroundColor Green
  Write-Host 'Jetzt Claude sagen, was bleibt und was weg soll (z. B. "behalten K2, K7, L1 - Rest weg"), oder die Liste dort einfuegen.' -ForegroundColor Green
}
```

**2. Löschen** mit den Nummern aus der letzten Liste (`K1-K4,K7,L2`). Erst ein Probelauf, gelöscht wird nur nach `ja`:

```powershell
& {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $server = 'root@195.201.26.108'
  $optionen = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
  $schluessel = Join-Path $env:USERPROFILE '.ssh\id_ed25519_spielmacherei'
  if (Test-Path -LiteralPath $schluessel) { $optionen = @('-i', $schluessel) + $optionen }
  $verbindung = ssh @optionen $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" aus deploy/README.md ausfuehren.' -ForegroundColor Red; return }
  $eingabe = Read-Host 'Was soll weg? Nummern aus der Liste, z. B. K1-K4,K7,L2'
  $auswahl = ($eingabe.Trim().Trim('"').Trim("'").Trim() -replace '\s*-\s*', '-' -replace '[\s;]+', ',' -replace ',+', ',').Trim(',').ToUpper()
  if ($auswahl -notmatch '^[KL]\d+(-[KL]?\d+)?(,[KL]\d+(-[KL]?\d+)?)*$') { Write-Host "Abbruch: '$eingabe' verstehe ich nicht. Beispiel: K1-K4,K7,L2" -ForegroundColor Red; return }
  Write-Host "1/2 Probelauf fuer $auswahl (aendert nichts) ..." -ForegroundColor Cyan
  $probe = ssh @optionen $server ('cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/konten-aufraeumen.py loeschen ' + $auswahl) 2>&1 | Out-String
  $ergebnis = $LASTEXITCODE
  Write-Host $probe
  if ($ergebnis -ne 0 -or $probe -notmatch 'Probelauf') { Write-Host 'Abbruch: Der Probelauf meldet ein Problem (oben). Nichts geloescht.' -ForegroundColor Red; return }
  if ((Read-Host 'Genau das loeschen? Vorher legt der Server eine Sicherung an. Zum Bestaetigen ja eingeben') -ne 'ja') { Write-Host 'Nichts geloescht.' -ForegroundColor Yellow; return }
  Write-Host '2/2 Sichern, loeschen, nachpruefen ...' -ForegroundColor Cyan
  $lauf = ssh @optionen $server ('cd /opt/q-me/backend && .venv/bin/python /opt/q-me/deploy/konten-aufraeumen.py loeschen ' + $auswahl + ' --ausfuehren') 2>&1 | Out-String
  $ergebnis = $LASTEXITCODE
  Write-Host $lauf
  if ($ergebnis -eq 0 -and $lauf -match 'alles Ausgew.+hlte ist weg') { Write-Host 'Fertig: geloescht und nachgeprueft. Sicherung siehe oben (auf dem Server, nur fuer root).' -ForegroundColor Green } else { Write-Host 'Achtung: Das Loeschen ist nicht sauber durchgelaufen, Meldung oben. Claude die Ausgabe schicken.' -ForegroundColor Red }
}
```

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
curl -s https://dranzeit.de/routes/scheduler-status
# → {"detail":"Not authenticated"}: Caddy und Backend sind verbunden
```

Meldet das Backend `Datenbank: nicht erreichbar`, ist PostgreSQL aus oder `QME_DATABASE_URL` fehlt (Abschnitt
„Datenbank (PostgreSQL)“).

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
