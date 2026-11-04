# Test fuer den Block "Testmodus je Laden (Stripe-Sandbox)" aus deploy/README.md (Windows PowerShell 5.1 und 7):
#   powershell -NoProfile -File dev/powershell/stripe-sandbox.test.ps1
# Server und Warten sind nachgebildet.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $PSScriptRoot 'Attrappen.ps1')
$readme = [IO.File]::ReadAllText((Join-Path $repo 'deploy\README.md'), [Text.Encoding]::UTF8)
$abschnitt = $readme.Substring($readme.IndexOf('### Testmodus je Laden (Stripe-Sandbox)'))
$text = [regex]::Match($abschnitt, '(?s)```powershell\r?\n(.*?)\r?\n```').Groups[1].Value
if (-not $text) { throw 'Block nicht gefunden' }
$block = [ScriptBlock]::Create($text)
function global:Start-Sleep { param($Seconds) }

$sandbox = 'sk_test_' + ('A1b2C3d4' * 4)
$gut = { param($vorhanden = '0') [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c STRIPE_TEST_SECRET_KEY /opt' = '2'; 'is-active' = "1`n1`n1`nactive"
                     'grep -c ^STRIPE_TEST_SECRET_KEY=.k_test_ /etc' = $vorhanden
                     'set-secret.sh STRIPE_TEST_SECRET_KEY' = @{ Ausgabe = 'gesetzt'; Exit = 0 }
                     'stripe-setup.py https://dranzeit.de --test' = @{ Ausgabe = "Stripe-Sandbox`nWebhook angelegt`nFertig."; Exit = 0 } } }
$faelle = [ordered]@{
  'eintragen'             = @{ Ssh = (& $gut); Antworten = @($sandbox); Erwartet = 'Fertig: Die Sandbox ist eingerichtet'; Gesetzt = 1; Setup = 1 }
  'vorhandenen behalten'  = @{ Ssh = (& $gut '1'); Antworten = @(''); Erwartet = 'vorhandene Sandbox-Schluessel bleibt'; Gesetzt = 0; Setup = 1 }
  'leer ohne vorhandenen' = @{ Ssh = (& $gut); Antworten = @(''); Erwartet = 'kein Sandbox-Schluessel'; Gesetzt = 0; Setup = 0 }
  'Live-Schluessel'       = @{ Ssh = (& $gut); Antworten = @('sk_live_' + ('x' * 30)); Erwartet = 'kein Sandbox-Schluessel'; Gesetzt = 0; Setup = 0 }
  'keine Verbindung'      = @{ Ssh = [ordered]@{ 'echo q-me-ok' = @{ Ausgabe = 'Permission denied'; Exit = 255 } }; Antworten = @(); Erwartet = 'Verbindung pruefen'; Gesetzt = 0; Setup = 0 }
  'Server noch alt'       = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c STRIPE_TEST_SECRET_KEY /opt' = '0' }; Antworten = @($sandbox); Erwartet = 'Erst ausrollen'; Gesetzt = 0; Setup = 0 }
  'Setzen scheitert'      = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c STRIPE_TEST_SECRET_KEY /opt' = '2'; 'grep -c ^STRIPE_TEST' = '0'; 'set-secret.sh' = @{ Ausgabe = 'Kein Wert'; Exit = 3 } }; Antworten = @($sandbox); Erwartet = 'konnte nicht gesetzt'; Gesetzt = 1; Setup = 0 }
  'Stripe meldet Fehler'  = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c STRIPE_TEST_SECRET_KEY /opt' = '2'; 'grep -c ^STRIPE_TEST' = '0'; 'set-secret.sh' = @{ Ausgabe = 'gesetzt'; Exit = 0 }; 'stripe-setup.py' = @{ Ausgabe = 'Stripe: Invalid API Key'; Exit = 1 } }; Antworten = @($sandbox); Erwartet = 'Einrichtung in der Sandbox fehlgeschlagen'; Gesetzt = 1; Setup = 1 }
  'Pruefung unvollstaendig' = @{ Ssh = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'grep -c STRIPE_TEST_SECRET_KEY /opt' = '2'; 'is-active' = "1`n0`n1`nactive"; 'grep -c ^STRIPE_TEST' = '0'; 'set-secret.sh' = 'gesetzt'; 'stripe-setup.py' = 'Fertig.' }; Antworten = @($sandbox); Erwartet = 'etwas fehlt'; Gesetzt = 1; Setup = 1 }
}
$fehler = 0
foreach ($name in $faelle.Keys) {
  $f = $faelle[$name]
  Set-QmeAttrappe -Antworten $f.Antworten -Ssh $f.Ssh
  $ausgabe = & $block 6>&1 | Out-String
  $setzen = @(Get-QmeAufrufe | Where-Object { $_ -like '*bash /opt/q-me/deploy/set-secret.sh*' })
  $setup = @(Get-QmeAufrufe | Where-Object { $_ -like '*stripe-setup.py*' })
  $probleme = @()
  if ($ausgabe -notmatch [regex]::Escape($f.Erwartet)) { $probleme += "Meldung '$($f.Erwartet)' fehlt" }
  if ($setzen.Count -ne $f.Gesetzt) { $probleme += "$($setzen.Count) statt $($f.Gesetzt) Mal gesetzt" }
  if ($setup.Count -ne $f.Setup) { $probleme += "$($setup.Count) statt $($f.Setup) Mal Setup" }
  if ($f.Gesetzt -ge 1 -and $setzen[0] -notmatch "STRIPE_TEST_SECRET_KEY.*per Pipe: $($sandbox.Length) Zeichen") { $probleme += "Schluessel nicht per Pipe: $($setzen[0])" }
  if ($f.Setup -ge 1 -and $setup[0] -notmatch '--test') { $probleme += 'Setup ohne --test' }
  if ($ausgabe -match [regex]::Escape($sandbox)) { $probleme += 'Schluessel steht in der Ausgabe' }
  if ((Get-QmeAufrufe) -match '"') { $probleme += 'doppelte Anfuehrungszeichen im Server-Befehl' }
  if ($probleme) { $fehler++; Write-Host "FEHL $name`: $($probleme -join '; ')"; Write-Host $ausgabe } else { Write-Host "OK   $name" }
}
if ($fehler) { Write-Host "$fehler fehlgeschlagen"; exit 1 }
Write-Host "$($faelle.Count)/$($faelle.Count) bestanden"
