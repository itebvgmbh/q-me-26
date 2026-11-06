# Test fuer den Block "PIN eBrief: Zugang eintragen" aus deploy/README.md (Windows PowerShell 5.1 und 7):
#   powershell -NoProfile -File dev/powershell/pin-zugang.test.ps1
# Server ist nachgebildet (dev/powershell/Attrappen.ps1), nichts geht raus.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $PSScriptRoot 'Attrappen.ps1')
$readme = [IO.File]::ReadAllText((Join-Path $repo 'deploy\README.md'), [Text.Encoding]::UTF8)
$abschnitt = $readme.Substring($readme.IndexOf('**PIN eBrief: Zugang eintragen:**'))
$text = [regex]::Match($abschnitt, '(?s)```powershell\r?\n(.*?)\r?\n```').Groups[1].Value
if (-not $text) { throw 'Block nicht gefunden' }
$block = [ScriptBlock]::Create($text)

$benutzer = 'dranzeit@itebv.de'
$passwort = 'Ae#7"x$ y=/+'
$b64 = { param($s) [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
$gut = { param($geheimnisDa = '1', $probe = @{ Ausgabe = 'PIN eBrief (Testumgebung): Anmeldung klappt.'; Exit = 0 })
  [ordered]@{
    'echo q-me-ok' = 'q-me-ok'
    'grep -c QME_PIN_PASSWORT_B64 /opt' = '1'
    'set-secret.sh QME_PIN_' = @{ Ausgabe = 'gesetzt (20 Zeichen), Backend neu gestartet.'; Exit = 0 }
    'grep -c ^QME_PIN_WEBHOOK_GEHEIMNIS=' = $geheimnisDa
    'openssl rand' = @{ Ausgabe = 'QME_PIN_WEBHOOK_GEHEIMNIS gesetzt (48 Zeichen), Backend neu gestartet.'; Exit = 0 }
    'pin-pruefen.py' = $probe
    'grep ^QME_PIN_WEBHOOK_GEHEIMNIS=' = 'QME_PIN_WEBHOOK_GEHEIMNIS=abc123def456'
  } }
$faelle = [ordered]@{
  'Testumgebung'           = @{ Ssh = (& $gut); Antworten = @('', $benutzer, $passwort); Erwartet = 'webhook/abc123def456'; Praefix = 'QME_PIN_TEST_'; Gesetzt = 2; Neu = 0 }
  'echter Versand, Geheimnis neu' = @{ Ssh = (& $gut '0' @{ Ausgabe = 'PIN eBrief (echter Versand): Anmeldung klappt.'; Exit = 0 }); Antworten = @('e', $benutzer, $passwort); Erwartet = 'Fertig'; Praefix = 'QME_PIN_'; Gesetzt = 2; Neu = 1 }
  'Anmeldung klappt nicht' = @{ Ssh = (& $gut '1' @{ Ausgabe = 'PIN eBrief (Testumgebung): Anmeldung klappt nicht – 401'; Exit = 1 }); Antworten = @('t', $benutzer, $passwort); Erwartet = 'Benutzer und Passwort pruefen'; Praefix = 'QME_PIN_TEST_'; Gesetzt = 2; Neu = 0 }
  'keine Verbindung'       = @{ Ssh = [ordered]@{ 'echo q-me-ok' = @{ Ausgabe = 'Permission denied (publickey).'; Exit = 255 } }; Antworten = @(); Erwartet = 'Verbindung pruefen'; Praefix = ''; Gesetzt = 0; Neu = 0 }
  'Server noch alt'        = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c QME_PIN_PASSWORT_B64 /opt' = '0' }; Antworten = @(); Erwartet = 'Aktualisieren'; Praefix = ''; Gesetzt = 0; Neu = 0 }
  'nichts eingegeben'      = @{ Ssh = (& $gut); Antworten = @('', ''); Erwartet = 'Nichts eingegeben'; Praefix = ''; Gesetzt = 0; Neu = 0 }
  'Setzen scheitert'       = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c QME_PIN_PASSWORT_B64 /opt' = '1'; 'set-secret.sh QME_PIN_' = @{ Ausgabe = 'Kein Wert angekommen'; Exit = 3 } }; Antworten = @('', $benutzer, $passwort); Erwartet = 'konnte nicht gesetzt'; Praefix = 'QME_PIN_TEST_'; Gesetzt = 1; Neu = 0 }
}
$fehler = 0
foreach ($name in $faelle.Keys) {
  $f = $faelle[$name]
  Set-QmeAttrappe -Antworten $f.Antworten -Ssh $f.Ssh
  $ausgabe = & $block 6>&1 | Out-String
  $setzen = @(Get-QmeAufrufe | Where-Object { $_ -like '*set-secret.sh QME_PIN_*' -and $_ -notlike '*openssl*' })
  $neu = @(Get-QmeAufrufe | Where-Object { $_ -like '*openssl rand*' })
  $probleme = @()
  if ($ausgabe -notmatch [regex]::Escape($f.Erwartet)) { $probleme += "Meldung '$($f.Erwartet)' fehlt" }
  if ($setzen.Count -ne $f.Gesetzt) { $probleme += "$($setzen.Count) statt $($f.Gesetzt) Werte gesetzt: $setzen" }
  if ($neu.Count -ne $f.Neu) { $probleme += "Webhook-Geheimnis $($neu.Count)-mal angelegt statt $($f.Neu)" }
  if ($f.Gesetzt -ge 1 -and $setzen[0] -notmatch ([regex]::Escape($f.Praefix + 'BENUTZER_B64') + '.*per Pipe: ' + (& $b64 $benutzer).Length + ' Zeichen')) { $probleme += "Benutzer nicht als Base64 per Pipe: $($setzen[0])" }
  if ($f.Gesetzt -eq 2 -and $setzen[1] -notmatch ([regex]::Escape($f.Praefix + 'PASSWORT_B64') + '.*per Pipe: ' + (& $b64 $passwort).Length + ' Zeichen')) { $probleme += "Passwort nicht als Base64 per Pipe: $($setzen[1])" }
  if ((& $b64 $passwort) -notmatch '^[A-Za-z0-9_-]+$') { $probleme += 'Base64 enthaelt Zeichen, die set-secret.sh ablehnt' }
  if ($ausgabe -match [regex]::Escape($passwort) -or $ausgabe -match [regex]::Escape($benutzer) -or $ausgabe -match [regex]::Escape((& $b64 $passwort))) { $probleme += 'Zugangsdaten stehen in der Ausgabe' }
  if ($probleme) { $fehler++; Write-Host "FEHL $name`: $($probleme -join '; ')" -ForegroundColor Red; Write-Host $ausgabe } else { Write-Host "OK   $name" -ForegroundColor Green }
}
if ($fehler) { Write-Host "$fehler Fall/Faelle fehlgeschlagen" -ForegroundColor Red; exit 1 }
Write-Host "$($faelle.Count)/$($faelle.Count) bestanden" -ForegroundColor Green
