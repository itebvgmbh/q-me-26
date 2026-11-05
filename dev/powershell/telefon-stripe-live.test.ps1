# Test fuer den Block "Live einrichten" unter "Telefon-Assistent als Zusatz (eigenes Abo)" in deploy/README.md
# (Windows PowerShell 5.1 und 7):
#   powershell -NoProfile -File dev/powershell/telefon-stripe-live.test.ps1
# Server und Warten sind nachgebildet.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $PSScriptRoot 'Attrappen.ps1')
$readme = [IO.File]::ReadAllText((Join-Path $repo 'deploy\README.md'), [Text.Encoding]::UTF8)
$abschnitt = $readme.Substring($readme.IndexOf('### Telefon-Assistent als Zusatz (eigenes Abo)'))
$text = [regex]::Match($abschnitt, '(?s)```powershell\r?\n(.*?)\r?\n```').Groups[1].Value
if (-not $text) { throw 'Block nicht gefunden' }
$block = [ScriptBlock]::Create($text)
function global:Start-Sleep { param($Seconds) }

$gut = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c ensure_telefon' = "2`n1"; 'is-active' = 'active'
                   'stripe-setup.py https://dranzeit.de --telefon' = @{ Ausgabe = "Stripe`nMeter angelegt: dranzeit_telefon_minuten`nFertig."; Exit = 0 } }
$faelle = [ordered]@{
  'anlegen'               = @{ Ssh = $gut; Antworten = @('ja'); Erwartet = 'Fertig: Der Telefon-Assistent'; Setup = 1 }
  'ja mit Anfuehrung'     = @{ Ssh = $gut; Antworten = @('"Ja"'); Erwartet = 'Fertig: Der Telefon-Assistent'; Setup = 1 }
  'nein'                  = @{ Ssh = $gut; Antworten = @('nein'); Erwartet = 'nichts angelegt'; Setup = 0 }
  'leer'                  = @{ Ssh = $gut; Antworten = @(''); Erwartet = 'nichts angelegt'; Setup = 0 }
  'keine Verbindung'      = @{ Ssh = [ordered]@{ 'echo q-me-ok' = @{ Ausgabe = 'Permission denied'; Exit = 255 } }; Antworten = @('ja'); Erwartet = 'Verbindung pruefen'; Setup = 0 }
  'Server noch alt'       = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c ensure_telefon' = "0`n1" }; Antworten = @('ja'); Erwartet = 'Erst ausrollen'; Setup = 0 }
  'kein Live-Schluessel'  = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c ensure_telefon' = "2`n0" }; Antworten = @('ja'); Erwartet = 'kein Live-Schluessel'; Setup = 0 }
  'Stripe meldet Fehler'  = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c ensure_telefon' = "2`n1"; 'stripe-setup.py' = @{ Ausgabe = 'Stripe: Invalid API Key'; Exit = 1 } }; Antworten = @('ja'); Erwartet = 'Einrichtung fehlgeschlagen'; Setup = 1 }
  'abweichende Preise'    = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c ensure_telefon' = "2`n1"; 'stripe-setup.py' = "ACHTUNG: dranzeit_telefon_minuten_monat hat andere Stufen`nFertig." }; Antworten = @('ja'); Erwartet = 'abweichende Preise'; Setup = 1 }
  'Backend laeuft nicht'  = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c ensure_telefon' = "2`n1"; 'stripe-setup.py' = 'Fertig.'; 'is-active' = 'failed' }; Antworten = @('ja'); Erwartet = 'Backend laeuft nicht'; Setup = 1 }
}
$fehler = 0
foreach ($name in $faelle.Keys) {
  $f = $faelle[$name]
  Set-QmeAttrappe -Antworten $f.Antworten -Ssh $f.Ssh
  $ausgabe = & $block 6>&1 | Out-String
  $setup = @(Get-QmeAufrufe | Where-Object { $_ -like '*python /opt/q-me/deploy/stripe-setup.py*' })
  $probleme = @()
  if ($ausgabe -notmatch [regex]::Escape($f.Erwartet)) { $probleme += "Meldung '$($f.Erwartet)' fehlt" }
  if ($setup.Count -ne $f.Setup) { $probleme += "$($setup.Count) statt $($f.Setup) Mal Setup" }
  if ($f.Setup -ge 1 -and $setup[0] -notmatch '--telefon') { $probleme += 'Setup ohne --telefon' }
  if ($f.Setup -ge 1 -and $setup[0] -match '--test') { $probleme += 'Setup mit --test statt live' }
  if ((Get-QmeAufrufe) -match '"') { $probleme += 'doppelte Anfuehrungszeichen im Server-Befehl' }
  if ($probleme) { $fehler++; Write-Host "FEHL $name`: $($probleme -join '; ')"; Write-Host $ausgabe } else { Write-Host "OK   $name" }
}
if ($fehler) { Write-Host "$fehler fehlgeschlagen"; exit 1 }
Write-Host "$($faelle.Count)/$($faelle.Count) bestanden"
