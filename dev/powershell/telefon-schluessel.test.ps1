# Test fuer den Block "Telefon-Assistent -> Zugangsschluessel erzeugen" aus deploy/README.md (Windows PowerShell 5.1 und 7):
#   powershell -NoProfile -File dev/powershell/telefon-schluessel.test.ps1
# Server, curl.exe, Zwischenablage und Warten sind nachgebildet.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $PSScriptRoot 'Attrappen.ps1')
$readme = [IO.File]::ReadAllText((Join-Path $repo 'deploy\README.md'), [Text.Encoding]::UTF8)
$abschnitt = $readme.Substring($readme.IndexOf('## Telefon-Assistent (Probelauf)'))
$text = [regex]::Match($abschnitt, '(?s)```powershell\r?\n(.*?)\r?\n```').Groups[1].Value
if (-not $text) { throw 'Block nicht gefunden' }
$block = [ScriptBlock]::Create($text)

$global:Ablage = ''
$global:CurlAntwort = '401'
function global:Set-Clipboard { param($Value) $global:Ablage = $Value }
function global:Start-Sleep { param($Seconds) }
function global:curl.exe { $global:CurlAntwort }

$gut = { [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c QME_TELEFON_TOKEN /opt' = '2'; '/etc/q-me.env' = '0'
                     'bash /opt/q-me/deploy/set-secret.sh' = @{ Ausgabe = 'QME_TELEFON_TOKEN gesetzt (43 Zeichen), Backend neu gestartet.'; Exit = 0 }; 'journalctl' = 'Log' } }
$faelle = [ordered]@{
  'neu eintragen'            = @{ Ssh = (& $gut); Antworten = @(); Curl = '401'; Erwartet = 'Fertig'; Gesetzt = $true }
  'Server noch alt'          = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c QME_TELEFON_TOKEN /opt' = '0' }; Antworten = @(); Curl = '401'; Erwartet = 'noch nicht'; Gesetzt = $false }
  'keine Verbindung'         = @{ Ssh = [ordered]@{ 'echo q-me-ok' = @{ Ausgabe = 'Permission denied (publickey).'; Exit = 255 } }; Antworten = @(); Curl = '401'; Erwartet = 'Verbindung pruefen'; Gesetzt = $false }
  'schon da, nicht ersetzen' = @{ Ssh = (& $gut); Antworten = @('n'); Curl = '401'; Erwartet = 'Nichts geaendert'; Gesetzt = $false; Vorhanden = $true }
  'schon da, ersetzen'       = @{ Ssh = (& $gut); Antworten = @('j'); Curl = '401'; Erwartet = 'Fertig'; Gesetzt = $true; Vorhanden = $true }
  'Setzen scheitert'         = @{ Ssh = (& $gut); Antworten = @(); Curl = '401'; Erwartet = 'konnte nicht gesetzt'; Gesetzt = $false; SetzenExit = 3 }
  'Schnittstelle antwortet nicht' = @{ Ssh = (& $gut); Antworten = @(); Curl = '503'; Erwartet = "Status '503'"; Gesetzt = $true }
}
$fehler = 0
foreach ($name in $faelle.Keys) {
  $f = $faelle[$name]
  if ($f.Vorhanden) { $f.Ssh['/etc/q-me.env'] = '1' }
  if ($f.SetzenExit) { $f.Ssh['bash /opt/q-me/deploy/set-secret.sh'] = @{ Ausgabe = 'Kein Wert angekommen'; Exit = $f.SetzenExit } }
  Set-QmeAttrappe -Antworten $f.Antworten -Ssh $f.Ssh
  $global:Ablage = ''
  $global:CurlAntwort = $f.Curl
  $ausgabe = & $block 6>&1 | Out-String
  $setzen = @(Get-QmeAufrufe | Where-Object { $_ -like '*set-secret.sh QME_TELEFON_TOKEN*' })
  $probleme = @()
  if ($ausgabe -notmatch [regex]::Escape($f.Erwartet)) { $probleme += "Meldung '$($f.Erwartet)' fehlt" }
  if ($f.Gesetzt) {
    if ($setzen.Count -ne 1 -or $setzen[0] -notmatch 'per Pipe: 43 Zeichen') { $probleme += "Schluessel nicht per Pipe gesetzt: $setzen" }
    if ($global:Ablage -notmatch '^[A-Za-z0-9_-]{43}$') { $probleme += "Zwischenablage: '$($global:Ablage)'" }
  } elseif (-not $f.SetzenExit -and $setzen.Count -ne 0) { $probleme += 'Schluessel gesetzt, obwohl abgebrochen' }
  if (-not $f.Gesetzt -and $global:Ablage) { $probleme += 'Zwischenablage gefuellt, obwohl nichts gesetzt' }
  if ($ausgabe -match '[A-Za-z0-9_-]{43}') { $probleme += 'Schluessel steht in der Ausgabe' }
  if ($probleme) { $fehler++; Write-Host "FEHL $name`: $($probleme -join '; ')" -ForegroundColor Red; Write-Host $ausgabe } else { Write-Host "OK   $name" -ForegroundColor Green }
}
if ($fehler) { Write-Host "$fehler Fall/Faelle fehlgeschlagen" -ForegroundColor Red; exit 1 }
Write-Host "$($faelle.Count)/$($faelle.Count) bestanden" -ForegroundColor Green
