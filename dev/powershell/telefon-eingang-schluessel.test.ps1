# Test fuer den Block "Telefon-Assistent -> Eingang freischalten" aus deploy/README.md (Windows PowerShell 5.1 und 7):
#   powershell -NoProfile -File dev/powershell/telefon-eingang-schluessel.test.ps1
# Server, curl.exe und Warten sind nachgebildet.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $PSScriptRoot 'Attrappen.ps1')
$readme = [IO.File]::ReadAllText((Join-Path $repo 'deploy\README.md'), [Text.Encoding]::UTF8)
$abschnitt = $readme.Substring($readme.IndexOf('**Eingang freischalten:**'))
$text = [regex]::Match($abschnitt, '(?s)```powershell\r?\n(.*?)\r?\n```').Groups[1].Value
if (-not $text) { throw 'Block nicht gefunden' }
$block = [ScriptBlock]::Create($text)

$global:CurlAntwort = '403'
function global:Start-Sleep { param($Seconds) }
function global:curl.exe { $global:CurlAntwort }

$gut = { [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c QME_TWILIO_AUTH_TOKEN /opt' = '2'
                     'bash /opt/q-me/deploy/set-secret.sh' = @{ Ausgabe = 'gesetzt, Backend neu gestartet.'; Exit = 0 }; 'journalctl' = 'Log vom Server' } }
$twilio = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
$vapi = '12345678-aaaa-bbbb-cccc-1234567890ab'
$faelle = [ordered]@{
  'beide eintragen'    = @{ Ssh = (& $gut); Antworten = @($twilio, $vapi); Curl = '403'; Erwartet = 'Fertig'; Gesetzt = 2 }
  'Server noch alt'    = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c QME_TWILIO_AUTH_TOKEN /opt' = '0' }; Antworten = @(); Curl = '403'; Erwartet = 'noch nicht'; Gesetzt = 0 }
  'keine Verbindung'   = @{ Ssh = [ordered]@{ 'echo q-me-ok' = @{ Ausgabe = 'Permission denied (publickey).'; Exit = 255 } }; Antworten = @(); Curl = '403'; Erwartet = 'Verbindung pruefen'; Gesetzt = 0 }
  'nichts eingegeben'  = @{ Ssh = (& $gut); Antworten = @(''); Curl = '403'; Erwartet = 'Nichts eingegeben'; Gesetzt = 0 }
  'Setzen scheitert'   = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c QME_TWILIO_AUTH_TOKEN /opt' = '2'; 'bash /opt/q-me/deploy/set-secret.sh' = @{ Ausgabe = 'Kein Wert angekommen'; Exit = 3 } }; Antworten = @($twilio, $vapi); Curl = '403'; Erwartet = 'konnte nicht gesetzt'; Gesetzt = 1 }
  'Eingang antwortet nicht' = @{ Ssh = (& $gut); Antworten = @($twilio, $vapi); Curl = '503'; Erwartet = "Status '503'"; Gesetzt = 2 }
}
$fehler = 0
foreach ($name in $faelle.Keys) {
  $f = $faelle[$name]
  Set-QmeAttrappe -Antworten $f.Antworten -Ssh $f.Ssh
  $global:CurlAntwort = $f.Curl
  $ausgabe = & $block 6>&1 | Out-String
  $setzen = @(Get-QmeAufrufe | Where-Object { $_ -like '*bash /opt/q-me/deploy/set-secret.sh*' })
  $probleme = @()
  if ($ausgabe -notmatch [regex]::Escape($f.Erwartet)) { $probleme += "Meldung '$($f.Erwartet)' fehlt" }
  if ($setzen.Count -ne $f.Gesetzt) { $probleme += "$($setzen.Count) statt $($f.Gesetzt) Schluessel gesetzt: $setzen" }
  if ($f.Gesetzt -ge 1 -and $setzen[0] -notmatch 'QME_TWILIO_AUTH_TOKEN.*per Pipe: 32 Zeichen') { $probleme += "Twilio nicht per Pipe: $($setzen[0])" }
  if ($f.Gesetzt -eq 2 -and $setzen[1] -notmatch 'QME_VAPI_API_KEY.*per Pipe: 36 Zeichen') { $probleme += "Vapi nicht per Pipe: $($setzen[1])" }
  if ($ausgabe -match [regex]::Escape($twilio) -or $ausgabe -match [regex]::Escape($vapi)) { $probleme += 'Schluessel steht in der Ausgabe' }
  if ($probleme) { $fehler++; Write-Host "FEHL $name`: $($probleme -join '; ')" -ForegroundColor Red; Write-Host $ausgabe } else { Write-Host "OK   $name" -ForegroundColor Green }
}
if ($fehler) { Write-Host "$fehler Fall/Faelle fehlgeschlagen" -ForegroundColor Red; exit 1 }
Write-Host "$($faelle.Count)/$($faelle.Count) bestanden" -ForegroundColor Green
