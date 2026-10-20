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

**Resend** (`RESEND_API_KEY`, E-Mails wie Team-Einladungen und Erinnerungen): [resend.com](https://resend.com/) →
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
- **E-Mail:** braucht `RESEND_API_KEY` (Abschnitt „Schlüssel eintragen“). Links in E-Mails zeigen auf
  `PUBLIC_URL` (Standard `https://dranzeit.de`, kein Geheimnis, in `/etc/q-me.env` änderbar).
- Kunden schalten das auf ihrer Nummernseite `/nummer/<id>` ein; dorthin führt jetzt das Nummer-Ziehen.

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
   Kunden-E-Mails → Rechnungen und Belege per E-Mail einschalten.
4. **Testen:** Als Inhaber unter `/tarif` „Weiter zur Bezahlung“, Testkarte `4242 4242 4242 4242`.

```powershell
& {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: Anmeldung am Server ohne Passwort klappt in diesem Fenster nicht. Erst den Block "Verbindung pruefen" ausfuehren.' -ForegroundColor Red; return }
  $schluessel = ssh -o BatchMode=yes $server 'grep -c ^STRIPE_SECRET_KEY= /etc/q-me.env' 2>&1 | Out-String
  if ($schluessel -notmatch '^\s*1') { Write-Host 'Abbruch: STRIPE_SECRET_KEY fehlt. Erst den Block "Schluessel eintragen" ausfuehren (Option 5).' -ForegroundColor Red; return }
  $adresse = Read-Host 'Adresse der App (Enter = https://q-me.spielmacherei.de)'
  if (-not $adresse) { $adresse = 'https://q-me.spielmacherei.de' }
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

## Betreiber der App

Den Hintergrunddienst für „Früher dran“ steuern (Start/Stopp, Takt, sofort prüfen) und den Verlauf **aller**
Läden sehen darf nur der Betreiber. Inhaber sehen unter `/scheduler-control` nur den Verlauf ihrer eigenen
Läden. Wer Betreiber ist, steht in `/etc/q-me.env` (keine Geheimsache, aber nur root kann es ändern):

```bash
QME_ADMIN_EMAILS=a@example.com,b@example.com   # E-Mail des Firebase-Kontos, mehrere mit Komma
QME_ADMIN_UIDS=…                               # alternativ die Firebase-UID
```

Danach `systemctl restart q-me`. Ohne Eintrag kann niemand steuern; der Dienst startet trotzdem von selbst.

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
