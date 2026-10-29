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
  $umgebung = ssh -o BatchMode=yes $server 'systemctl show q-me -p Environment' 2>&1 | Out-String
  if ($umgebung -match 'TZ=Europe/Berlin') { Write-Host 'Zeitzone: Backend rechnet jetzt in deutscher Zeit.' -ForegroundColor Green } else { Write-Host 'Zeitzone ist NICHT gesetzt. Ausgabe vom Server:' -ForegroundColor Red; Write-Host $umgebung; return }
  ssh -o BatchMode=yes $server 'journalctl -u q-me -n 300 --no-pager | grep -q Scheduler.autostarted'
  if ($LASTEXITCODE -eq 0) { Write-Host 'Frueher dran: Hintergrunddienst laeuft (prueft alle 5 Minuten).' -ForegroundColor Green } else { Write-Host 'Frueher dran: Hintergrunddienst laeuft NICHT. Meist fehlt der Firebase-Schluessel (Block "Schluessel einspielen").' -ForegroundColor Yellow }
}
```

Der Block meldet zum Schluss auch, ob der Hintergrunddienst für „Früher dran“
läuft. Er startet mit dem Backend automatisch, sobald der Firebase-Schlüssel da ist,
und prüft alle 5 Minuten. Sofort geprüft wird zusätzlich nach jeder Absage,
Verschiebung und Annahme. Jeder frei gewordene Platz geht zuerst exklusiv an die
Person, die als Nächste in der Reihe steht, und erst nach Ablauf der Frist an die
nächste. Abweichend einstellbar in `/etc/q-me.env`:
`QME_SCHEDULER_INTERVAL=<Sekunden>` (mindestens 60), `QME_SCHEDULER_AUTOSTART=0`
zum Abschalten, `QME_OFFER_HOLD_MINUTES` (Frist je Angebot, Standard 15) und
`QME_OFFER_LEAD_MINUTES` (ein angebotener Platz liegt mindestens so weit in der
Zukunft, Standard 15).

Holt `main`, installiert Abhängigkeiten, baut die Web-App in ein neues Verzeichnis
und tauscht sie erst nach erfolgreichem Build aus. Danach startet es das Backend
neu und prüft es. Einen anderen Branch ausrollen: `BRANCH=<name> bash …`.

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
Erinnerung. Er startet zusammen mit „Früher dran“, sobald der Firebase-Schlüssel da ist.

- **Web-Push:** Die Schlüssel (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) erzeugt `update.sh` beim ersten Lauf
  selbst und schreibt sie nach `/etc/q-me.env`. Nichts zu tun. Auf dem iPhone gehen Push-Nachrichten nur aus
  der App vom Home-Bildschirm; dort bietet die Nummernseite die E-Mail an.
- **Push an die iPhone/iPad-App:** über Firebase Cloud Messaging mit demselben Dienstkonto wie Firestore
  (`app/libs/fcm.py`), kein weiterer Schlüssel auf dem Server. Was dafür bei Apple und in Firebase
  einzurichten ist, steht in `mobile/README.md`.
- **E-Mail:** braucht `RESEND_API_KEY` (Abschnitt „Schlüssel eintragen“). Links in E-Mails zeigen auf
  `PUBLIC_URL` (Standard `https://dranzeit.de`, kein Geheimnis, in `/etc/q-me.env` änderbar), das Logo im Kopf
  der Mails ebenso (`/img/mail/logo.png`, neu erzeugen mit `node dev/mail-logo.cjs`). Auch „Passwort vergessen“
  läuft über Resend (`app/apis/password_reset`, Link auf `/passwort-neu`); ohne Schlüssel verschickt Firebase
  seine eigene englische Mail von `…firebaseapp.com`, die bei Microsoft 365 gern im Spam landet.
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
Firestore-Transaktion zwei Hilfsdokumente fort (Erklärung: `frontend/src/utils/firestore/schedule.ts`):

- `schedules/{staffId}_{YYYY-MM-DD}` – belegte Zeiten der Person an dem Tag (nur Termin-IDs und Uhrzeiten)
- `shop_days/{shopId}_{YYYY-MM-DD}` – an dem Tag vergebene Nummern des Ladens

Seit 23.10.2026 dazu je Termin seine öffentliche Kurzfassung `public_appointments/{Termin-ID}` (Zeit, Person,
Leistung, Status, Nummer – keine Namen, Kontakte, Konten; `frontend/src/utils/firestore/public-appointments.ts`).
Platzsuche, Nummernseite und Wartezimmer-Bildschirm lesen ohne Anmeldung nur sie. Das Backend legt sie beim ersten
Start für alle Termine an (Log „Kurzfassungen der Termine angelegt“, danach Vermerk `meta/public_appointments`) und
gleicht sie laufend ab (Log „Kurzfassungen der Termine: … angeglichen“, `backend/app/libs/public_appointments.py`).

Nichts einzurichten: Die Firestore-Regeln (`firestore.rules`, Abschnitt „Firestore-Regeln“ unten) lassen beide
Sammlungen für jeden zu – auch Nummer ziehen ohne Konto schreibt dort. Werden die Regeln einmal verschärft, müssen
beide für jeden schreibbar bleiben, der buchen darf (also auch ohne Anmeldung), sonst schlägt jede Buchung fehl.
Ein Vorschlag:

```
match /schedules/{id} {
  allow read: if true;
  allow create, update: if request.resource.data.keys().hasOnly(['shopId', 'staffId', 'day', 'slots', 'updatedAt'])
    && id == request.resource.data.staffId + '_' + request.resource.data.day;
}
match /shop_days/{id} {
  allow read: if true;
  allow create, update: if request.resource.data.keys().hasOnly(['shopId', 'day', 'codes', 'updatedAt'])
    && id == request.resource.data.shopId + '_' + request.resource.data.day;
}
```

Dokumente vergangener Tage löscht das Backend einmal am Tag (zusammen mit dem Datenschutz-Aufräumen). Termine von
vor der Umstellung stehen nicht in der Belegung; die prüft die App wie bisher vor dem Speichern. Browserfenster,
die schon vor dem Update offen waren, buchen bis zum Neuladen noch ohne Sperre.

## Firestore-Regeln

Die Sicherheitsregeln der Datenbank stehen in `firestore.rules` (Hauptordner des Repos, mit Begründung je Regel).
Eingespielt werden sie **nur von Hand in der Firebase-Konsole** – ein `git pull` oder Ausrollen ändert an den
Regeln nichts. Geprüft werden sie im Emulator (`dev/regeln`, läuft auf GitHub bei jeder Änderung).

Fassung 2026-10-28 (Kopfzeile `// Fassung:` in `firestore.rules`):
- Lesen bleibt offen, wo Buchen und Nummer ziehen ohne Anmeldung es brauchen (Läden, Personen ohne Kontaktdaten,
  Leistungen, Pausen, Kurzfassung der Termine, Belegung, Tagesnummern).
- Termine selbst (Name, Handynummer, E-Mail, Konto) lesen nur Inhaber, Team und das eigene Konto; E-Mail und Telefon
  der Personen im Team (`shops/{id}/staff_contacts`) nur der Inhaber.
- Schreiben nur, wer zum Laden gehört: Inhaber oder Person im Team. Ohne Anmeldung/als Kunde nur Nummer ziehen,
  buchen und den eigenen Termin absagen. Eine Nummer ohne Konto zurückgeben oder übernehmen geht über das Backend,
  mit dem Schlüssel aus dem Link der Nummernseite.
- Kundenliste nur für Inhaber und Team, Profile nur für das eigene Konto, Angebote „Früher dran“ nur für das eigene.
- Tarif-Felder am Laden nur das Backend; `meta`, `push_subscriptions`, `team_push_subscriptions`, `staff-invitations`,
  `verzeichnis` sind zu. Die Merker für Nachrichten ans Team (`teamNotice` …) am Termin setzt nur das Backend.

**Team** erkennen die Regeln an einem Vermerk `shops/{shopId}/members/{uid}`. Ihn setzt das Backend beim Annehmen
einer Einladung und gleicht ihn bei jedem Start mit den Personen ab (`backend/app/libs/team.py`, im Log „Team-Vermerke
abgeglichen“). Deshalb gilt: **erst ausrollen, dann einspielen** – sonst sehen Personen im Team die Kundenliste
nicht. Ein `git pull` bringt die Vermerke nicht mit; sie entstehen beim ersten Start des Dienstes. Ebenso beim ersten
Start mit Fassung 2026-10-23.2: die Kurzfassungen der Termine (Log „Kurzfassungen der Termine angelegt“) und der
Umzug von E-Mail und Telefon der Personen zu den Kontaktdaten des Ladens (Log „Kontaktdaten des Teams umgezogen“).
Fehlen sie, sieht die Nummernseite ältere Nummern nicht. Browserfenster, die seit vor dem Ausrollen offen sind (etwa
der Tresen), nach dem Einspielen einmal neu laden.

### Einspielen

1. Firebase-Konsole öffnen: https://console.firebase.google.com/project/qmedata-7c79e/firestore/rules
2. Im Regel-Editor **Strg+A, Strg+C** (die alten Regeln landen in der Zwischenablage).
3. Diesen Block in PowerShell einfügen. Er sichert die alten Regeln nach `Downloads\firestore-regeln-alt-….txt`,
   holt die neuen von GitHub (Branch `bildschirm`) und legt sie in die Zwischenablage:

```powershell
& { $alt = Get-Clipboard -Raw; if (-not $alt -or $alt -notmatch 'service cloud\.firestore') { Write-Host 'In der Zwischenablage stehen keine Firestore-Regeln. Im Regel-Editor erst Strg+A, Strg+C, dann diesen Block noch einmal.' -ForegroundColor Red; return }; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; $web = New-Object Net.WebClient; $web.Encoding = [Text.Encoding]::UTF8; try { $neu = $web.DownloadString('https://raw.githubusercontent.com/itebvgmbh/q-me-26/bildschirm/firestore.rules') } catch { Write-Host "Neue Regeln nicht geladen: $($_.Exception.Message)" -ForegroundColor Red; return }; if ($neu -notmatch 'service cloud\.firestore' -or $neu -notmatch '// Fassung: (\S+)') { Write-Host 'Die geladene Datei sieht nicht wie die Regeln aus. Abgebrochen, nichts geaendert.' -ForegroundColor Red; return }; $fassung = $Matches[1]; if ($alt -match '// Fassung: (\S+)' -and $Matches[1] -eq $fassung) { Write-Host "Die Fassung $fassung ist schon eingespielt. Nichts zu tun." -ForegroundColor Green; return }; $downloads = Join-Path $env:USERPROFILE 'Downloads'; $sicherung = Join-Path $downloads ('firestore-regeln-alt-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.txt'); [IO.File]::WriteAllText($sicherung, $alt, (New-Object Text.UTF8Encoding $false)); Write-Host "Alte Regeln gesichert: $sicherung" -ForegroundColor Green; $datei = Join-Path $downloads 'firestore-regeln-neu.rules'; [IO.File]::WriteAllText($datei, $neu, (New-Object Text.UTF8Encoding $false)); Set-Clipboard -Value $neu; Write-Host "Neue Regeln in der Zwischenablage (Fassung $fassung, Kopie: $datei)." -ForegroundColor Green; Write-Host 'Jetzt im Regel-Editor: Strg+A, Strg+V, Veroeffentlichen.' -ForegroundColor Green }
```

4. Im Regel-Editor **Strg+A, Strg+V**, dann **Veröffentlichen**. Meldet der Editor einen Fehler, nicht
   veröffentlichen (die alten Regeln gelten dann weiter). Bis die neuen überall wirken, kann es eine Minute dauern.

### Prüfen

- Auf dranzeit.de als Inhaber unter „Mein Laden“ etwas ändern und speichern; im privaten Fenster (ohne Anmeldung)
  eine Nummer ziehen und auf der Nummernseite wieder absagen.
- Im privaten Fenster: Nummer ziehen, Seite schließen, über den Link wieder öffnen und zurückgeben; am Tresen
  stehen Name und Handynummer, auf dem Wartezimmer-Bildschirm nur Nummern.
- Claude: `node dev/e2e/regeln-live.cjs` (alles OK, sobald die Regeln wirken; vorher FEHL), dazu `regeln.cjs`,
  `fruehester-platz.cjs`, `schlange-tresen.cjs`, `gleichzeitig.cjs`, `seiten.cjs`, `tarife.cjs`, `laden-gesperrt.cjs`,
  `leistungen-kunden.cjs` (Kundenliste), `team-einladen.cjs` (Team), `durchlauf-warteschlange.cjs`.
- Der Block oben ist mit Attrappen getestet: `powershell -NoProfile -File dev/powershell/regeln-einspielen.test.ps1`.

### Zurücknehmen

Klemmt danach etwas (Speichern im Laden, Buchen, Nummer ziehen), die alten Regeln wieder einspielen. Der Block holt
die gesicherte Datei aus `Downloads` (Vorschlag: die neueste) in die Zwischenablage:

```powershell
& { $downloads = Join-Path $env:USERPROFILE 'Downloads'; $vorschlag = Get-ChildItem -Path $downloads -Filter 'firestore-regeln-alt-*.txt' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; $hinweis = if ($vorschlag) { " [Enter = $($vorschlag.Name)]" } else { '' }; $eingabe = (Read-Host "Gesicherte Regeln (Datei, Drag & Drop geht)$hinweis").Trim().Trim('"').Trim("'"); $pfad = if ($eingabe) { $eingabe } elseif ($vorschlag) { $vorschlag.FullName } else { '' }; if (-not $pfad -or -not (Test-Path -LiteralPath $pfad)) { Write-Host "Datei nicht gefunden: $pfad" -ForegroundColor Red; return }; $alt = [IO.File]::ReadAllText($pfad, [Text.Encoding]::UTF8); if ($alt -notmatch 'service cloud\.firestore') { Write-Host 'Die Datei enthaelt keine Firestore-Regeln. Abgebrochen.' -ForegroundColor Red; return }; Set-Clipboard -Value $alt; Write-Host "Alte Regeln aus $pfad in der Zwischenablage." -ForegroundColor Green; Write-Host 'Jetzt im Regel-Editor: Strg+A, Strg+V, Veroeffentlichen.' -ForegroundColor Green }
```

Dann im Regel-Editor **Strg+A, Strg+V, Veröffentlichen**. Die Konsole führt außerdem einen Verlauf der
veröffentlichten Fassungen; auch daraus lässt sich die alte wieder veröffentlichen.

Ändern sich die Regeln später: `firestore.rules` und die Tests in `dev/regeln` zusammen anpassen, auf GitHub grün
werden lassen, dann wie oben einspielen.

## Speicher-Regeln

Logos der Läden und Fotos der Personen liegen im Firebase-Speicher (Storage). Wer dort hochladen darf, steht in
`storage.rules` (Hauptordner des Repos). Wie bei den Firestore-Regeln gilt: **nur von Hand in der Firebase-Konsole**
einspielen, ein `git pull` oder Ausrollen ändert daran nichts. Geprüft im Emulator (`dev/regeln/speicher.test.mjs`,
läuft auf GitHub mit den Firestore-Regeln).

Fassung 2026-10-29 (Kopfzeile `// Fassung:` in `storage.rules`):
- Hochladen, Ersetzen und Löschen nur der Inhaber des Ladens, nur in `shop-logos/<Laden>/` und
  `staff-profile-images/<Laden>/`, nur Bilder bis 2 MB.
- Ansehen geht ohne Anmeldung (Buchungsseite, Wartezimmer-Bildschirm), Auflisten nicht. Alles andere ist zu.

Die Regeln fragen in Firestore nach, wem der Laden gehört. Beim ersten Veröffentlichen fragt die Konsole deshalb, ob
der Speicher Firestore lesen darf – **zustimmen**, sonst klappt kein Hochladen mehr.

### Einspielen (Speicher)

1. Firebase-Konsole öffnen: https://console.firebase.google.com/project/qmedata-7c79e/storage/rules
2. Im Regel-Editor **Strg+A, Strg+C** (die alten Regeln landen in der Zwischenablage).
3. Diesen Block in PowerShell einfügen. Er sichert die alten Regeln nach `Downloads\speicher-regeln-alt-….txt`,
   holt die neuen von GitHub (Branch `bildschirm`) und legt sie in die Zwischenablage:

```powershell
& { $alt = Get-Clipboard -Raw; if (-not $alt -or $alt -notmatch 'service firebase\.storage') { Write-Host 'In der Zwischenablage stehen keine Speicher-Regeln. Im Regel-Editor unter Storage erst Strg+A, Strg+C, dann diesen Block noch einmal.' -ForegroundColor Red; return }; [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; $web = New-Object Net.WebClient; $web.Encoding = [Text.Encoding]::UTF8; try { $neu = $web.DownloadString('https://raw.githubusercontent.com/itebvgmbh/q-me-26/bildschirm/storage.rules') } catch { Write-Host "Neue Regeln nicht geladen: $($_.Exception.Message)" -ForegroundColor Red; return }; if ($neu -notmatch 'service firebase\.storage' -or $neu -notmatch '// Fassung: (\S+)') { Write-Host 'Die geladene Datei sieht nicht wie die Speicher-Regeln aus. Abgebrochen, nichts geaendert.' -ForegroundColor Red; return }; $fassung = $Matches[1]; if ($alt -match '// Fassung: (\S+)' -and $Matches[1] -eq $fassung) { Write-Host "Die Fassung $fassung ist schon eingespielt. Nichts zu tun." -ForegroundColor Green; return }; $downloads = Join-Path $env:USERPROFILE 'Downloads'; $sicherung = Join-Path $downloads ('speicher-regeln-alt-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.txt'); [IO.File]::WriteAllText($sicherung, $alt, (New-Object Text.UTF8Encoding $false)); Write-Host "Alte Regeln gesichert: $sicherung" -ForegroundColor Green; $datei = Join-Path $downloads 'speicher-regeln-neu.rules'; [IO.File]::WriteAllText($datei, $neu, (New-Object Text.UTF8Encoding $false)); Set-Clipboard -Value $neu; Write-Host "Neue Regeln in der Zwischenablage (Fassung $fassung, Kopie: $datei)." -ForegroundColor Green; Write-Host 'Jetzt im Regel-Editor: Strg+A, Strg+V, Veroeffentlichen.' -ForegroundColor Green }
```

4. Im Regel-Editor **Strg+A, Strg+V**, dann **Veröffentlichen** und der Frage nach dem Zugriff auf Firestore
   zustimmen. Meldet der Editor einen Fehler, nicht veröffentlichen (die alten Regeln gelten dann weiter).

Prüfen: auf dranzeit.de als Inhaber unter „Laden“ → „Mein Laden“ ein Logo hochladen. Claude:
`node dev/e2e/bilder-hochladen.cjs` (Logo und Foto im Testladen hochladen, ansehen, wieder löschen). Der Block oben ist
mit Attrappen getestet: `powershell -NoProfile -File dev/powershell/speicher-regeln-einspielen.test.ps1`.

Zurücknehmen: im Regel-Editor den Verlauf öffnen (Uhr-Symbol links) und die vorige Fassung veröffentlichen – oder
`Downloads\speicher-regeln-alt-….txt` öffnen, alles kopieren, im Editor einfügen und veröffentlichen.

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

**Rufnummer zuordnen:** Im Betreiber-Bereich den Laden öffnen. Im Abschnitt „Telefon-Assistent“ die Nummer
eintragen, die bei der Plattform ankommt. Pro Laden gibt es eine Nummer. Gespeichert wird sie in
`telefon_leitungen/{+49…}`, nur das Backend liest das. Wird der Laden gelöscht, wird seine Nummer wieder frei.
Ohne Telefon (Probe im Browser der Plattform) geht statt der Nummer die Laden-ID, aber nur für Läden mit
zugeordneter Nummer.

**Was ein Anruf anlegt:** Termine und Nummern wie bei einer Buchung ohne Konto, also mit Tagesnummer, Name und
Telefonnummer des Anrufers, gekennzeichnet mit `source: "telefon"`. Sie stehen ganz normal im Kalender, in der
Schlange und auf dem Bildschirm. Ein Platz geht dabei nur einmal weg, auch wenn gleichzeitig online oder am
Tresen gebucht wird (`backend/app/libs/buchung.py`).

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
3. **Firebase Console** → Authentication → Settings → Autorisierte Domains: `dranzeit.de` und
   `www.dranzeit.de` eintragen (sonst scheitert die Google-Anmeldung).
4. **Resend** → Domains → `dranzeit.de` hinzufügen, die SPF/DKIM-Einträge beim Domain-Anbieter eintragen.

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
QME_ADMIN_EMAILS=a@example.com,b@example.com   # E-Mail des Firebase-Kontos, mehrere mit Komma
QME_ADMIN_UIDS=…                               # alternativ die Firebase-UID
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

Gründe, Protokoll und Sicherungen liegen **nicht** in Firestore (dort ist alles ohne Anmeldung lesbar), sondern im
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
- **Übernahme per Code** (für den Brief an den Salon): Im Eintrag unten „Code erzeugen“. Der Code (z. B.
  `ABCDE-FGHJK`, 180 Tage gültig) und der Link `https://dranzeit.de/uebernehmen#code=…` samt QR-Code werden nur
  in diesem Moment gezeigt; gespeichert ist nur ein Hash. Mit dem Code richtet der Salon seinen Laden vorausgefüllt
  ein (Name, Adresse, Zeiten, Preise der Seite), und die Seite gehört ihm danach **ohne Bestätigung hier**; dazu
  bekommt er einen Gründerplatz, solange frei. Ohne Code („Seite übernehmen“ auf der Seite) füllt der Assistent
  genauso vor, verbunden wird aber erst über „Übernahme bestätigen“. Ein neuer Code macht den alten ungültig.
- **Vom Salon entfernt**: Jede Seite hat unten „Eintrag entfernen“ für den Salon selbst (Widerspruch). Die Seite
  geht sofort offline; Grund und Kontakt stehen im Protokoll (nicht in Firestore).
- **Wünsche**: „Das wünsch ich mir“ auf der Seite zählt mit (je Person und Tag einmal) – Liste nach Wünschen für den
  Vertrieb.

Probelauf ohne Speichern (zeigt, ob Google-Textsuche und Claude gehen und was aus einer Webseite wird):

```bash
cd /opt/q-me/backend && .venv/bin/python ../deploy/verzeichnis-probe.py --suche "Friseur Tegel" --anlegen 2
```

Voraussetzungen: `GOOGLE_MAPS_API_KEY` mit **Places API (New)** (wie der Einrichtungsassistent; die Textsuche kostet je
Seite mit 20 Treffern ein paar Cent), `ANTHROPIC_API_KEY`, Caddy mit den Pfaden `/friseur` und `/barbershop`
(`python3 /opt/q-me/deploy/caddy-domain.py dranzeit.de --redirect-from www.dranzeit.de q-me.spielmacherei.de dranzeit.com www.dranzeit.com`
erneut ausführen; bis dahin leitet die App auf `/routes/seo/friseur/…` um). Die Sammlung `verzeichnis` schreibt nur
das Backend; im Browser ist sie zu, sobald die Firestore-Regeln eingespielt sind (Abschnitt „Firestore-Regeln“).

## Konten aufräumen

`deploy/konten-aufraeumen.py` (Erklärung im Kopf der Datei): erst eine Liste aller Konten und Läden, dann wird nur
gelöscht, was ausdrücklich genannt ist. Ein Konto löschen heißt dasselbe wie „Konto löschen“ im Profil; Läden gehen
nur mit, wenn sie selbst genannt sind. Der Laden ITEBV GmbH, Betreiber-Konten und Läden mit laufendem Abo sind
geschützt. Vor dem Löschen legt das Skript eine Sicherung unter `/root/dranzeit-konten/` an (nur für root).

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
