# Test fuer die Bloecke in mobile/README.md (Team-ID, GoogleService-Info.plist, App-Store-Connect-Schluessel),
# Windows PowerShell 5.1 und 7:
#   powershell -NoProfile -File dev/powershell/ios-app.test.ps1
# GitHub CLI und der Ordner Downloads sind nachgebildet; Werte gehen nur per Pipe an "gh secret set".
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $PSScriptRoot 'Attrappen.ps1')
$readme = [IO.File]::ReadAllText((Join-Path $repo 'mobile\README.md'), [Text.Encoding]::UTF8)
function Get-Block([string]$ueberschrift) {
  $abschnitt = $readme.Substring($readme.IndexOf($ueberschrift))
  $text = [regex]::Match($abschnitt, '(?s)```powershell\r?\n(.*?)\r?\n```').Groups[1].Value
  if (-not $text) { throw "Block unter '$ueberschrift' nicht gefunden" }
  [ScriptBlock]::Create($text)
}

$global:Gh = @{ Exit = 0; Secrets = @(); Variable = ''; Aufrufe = New-Object System.Collections.ArrayList }
function global:gh {
  $eingabe = @($input) -join "`n"
  $befehl = $args -join ' '
  [void]$global:Gh.Aufrufe.Add(@{ Befehl = $befehl; Eingabe = $eingabe })
  if ($befehl -like 'secret list*') { $global:LASTEXITCODE = 0; return ($global:Gh.Secrets -join "`n") }
  if ($befehl -like 'variable get*') { $global:LASTEXITCODE = 0; return $global:Gh.Variable }
  $global:LASTEXITCODE = $global:Gh.Exit
  if ($global:Gh.Exit -ne 0) { return }
  if ($befehl -like 'secret set*') { $global:Gh.Secrets += [string]$args[2] }
  if ($befehl -like 'variable set*') { $global:Gh.Variable = [string]$args[-1] }
}

$heim = Join-Path ([IO.Path]::GetTempPath()) ("ios-app-test-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $heim 'Downloads') | Out-Null
$altHeim = $env:USERPROFILE
$env:USERPROFILE = $heim
$plist = "<?xml version=`"1.0`" encoding=`"UTF-8`"?>`n<plist><dict><key>BUNDLE_ID</key><string>de.dranzeit.app</string><key>API_KEY</key><string>AIzaGeheim123</string></dict></plist>"
$fremd = $plist.Replace('de.dranzeit.app', 'de.andere.app')
$p8 = "-----BEGIN PRIVATE KEY-----`nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgGEHEIM`n-----END PRIVATE KEY-----"
[IO.File]::WriteAllText((Join-Path $heim 'Downloads\GoogleService-Info.plist'), $plist)
[IO.File]::WriteAllText((Join-Path $heim 'Downloads\GoogleService-Info (1).plist'), $fremd)
(Get-Item (Join-Path $heim 'Downloads\GoogleService-Info (1).plist')).LastWriteTime = (Get-Date).AddDays(-1)
[IO.File]::WriteAllText((Join-Path $heim 'Downloads\AuthKey_ABCDE12345.p8'), $p8)

$team = Get-Block '### 1. Apple Developer Program'
$google = Get-Block '### 3. Push'
$asc = Get-Block '### 4. '
$faelle = [ordered]@{
  'Team-ID'                     = @{ Block = $team; Antworten = @(' abcde12345 '); Erwartet = 'Fertig: APPLE_TEAM_ID = ABCDE12345'; Variable = 'ABCDE12345' }
  'Team-ID falsch'              = @{ Block = $team; Antworten = @('ABC'); Erwartet = 'sieht nicht wie eine Team-ID'; Variable = '' }
  'Team-ID gh nicht angemeldet' = @{ Block = $team; Antworten = @('ABCDE12345'); Erwartet = 'gh auth status'; Variable = ''; Exit = 1 }
  'Plist aus Downloads'         = @{ Block = $google; Antworten = @(''); Erwartet = 'Fertig: IOS_GOOGLE_SERVICE_INFO'; Secrets = @{ IOS_GOOGLE_SERVICE_INFO = 'AIzaGeheim123' } }
  'Plist per Drag and Drop'     = @{ Block = $google; Antworten = @("`"$heim\Downloads\GoogleService-Info.plist`""); Erwartet = 'Fertig: IOS_GOOGLE_SERVICE_INFO'; Secrets = @{ IOS_GOOGLE_SERVICE_INFO = 'AIzaGeheim123' } }
  'Plist andere App'            = @{ Block = $google; Antworten = @("$heim\Downloads\GoogleService-Info (1).plist"); Erwartet = 'gehoert nicht zur App'; Secrets = @{} }
  'Plist fehlt'                 = @{ Block = $google; Antworten = @("$heim\nichts.plist"); Erwartet = 'Datei nicht gefunden'; Secrets = @{} }
  'API-Schluessel'              = @{ Block = $asc; Antworten = @('abcde12345', '69a6de70-03db-47e3-e053-5b8c7c11a4d1', ''); Erwartet = 'Fertig: ASC_KEY_ID, ASC_ISSUER_ID und ASC_KEY_P8'; Secrets = @{ ASC_KEY_ID = 'ABCDE12345'; ASC_ISSUER_ID = '69a6de70-03db-47e3-e053-5b8c7c11a4d1'; ASC_KEY_P8 = 'GEHEIM' } }
  'API-Schluessel falsche Issuer' = @{ Block = $asc; Antworten = @('ABCDE12345', 'xyz'); Erwartet = 'sieht nicht wie eine Issuer-ID'; Secrets = @{} }
  'API-Schluessel Datei fehlt'  = @{ Block = $asc; Antworten = @('ZZZZZ99999', '69a6de70-03db-47e3-e053-5b8c7c11a4d1', ''); Erwartet = 'Datei nicht gefunden'; Secrets = @{} }
  'API-Schluessel keine p8'     = @{ Block = $asc; Antworten = @('ABCDE12345', '69a6de70-03db-47e3-e053-5b8c7c11a4d1', "$heim\Downloads\GoogleService-Info.plist"); Erwartet = 'keine .p8-Datei'; Secrets = @{} }
  'API-Schluessel gh scheitert' = @{ Block = $asc; Antworten = @('ABCDE12345', '69a6de70-03db-47e3-e053-5b8c7c11a4d1', ''); Erwartet = 'ASC_KEY_ID nicht gesetzt'; Secrets = @{}; Exit = 1 }
}
$fehler = 0
try {
  foreach ($name in $faelle.Keys) {
    $f = $faelle[$name]
    Set-QmeAttrappe -Antworten $f.Antworten
    $global:Gh.Exit = 0; if ($f.Exit) { $global:Gh.Exit = $f.Exit }
    $global:Gh.Secrets = @(); $global:Gh.Variable = ''; $global:Gh.Aufrufe.Clear()
    $ausgabe = & $f.Block 6>&1 | Out-String
    $probleme = @()
    if ($ausgabe -notmatch [regex]::Escape($f.Erwartet)) { $probleme += "Meldung '$($f.Erwartet)' fehlt" }
    if ($f.ContainsKey('Variable') -and $global:Gh.Variable -ne $f.Variable) { $probleme += "Variable '$($global:Gh.Variable)' statt '$($f.Variable)'" }
    if ($f.Secrets) {
      $gesetzt = @($global:Gh.Aufrufe | Where-Object { $_.Befehl -like 'secret set*' })
      if ($f.Secrets.Count -eq 0 -and $gesetzt.Count -gt 0 -and -not $f.Exit) { $probleme += 'Secret gesetzt, obwohl abgebrochen' }
      foreach ($secret in $f.Secrets.Keys) {
        $aufruf = $gesetzt | Where-Object { $_.Befehl -like "secret set $secret *" } | Select-Object -First 1
        if (-not $aufruf) { $probleme += "$secret nicht gesetzt"; continue }
        if ($aufruf.Befehl -match '--body') { $probleme += "$secret als Argument statt per Pipe" }
        if ($aufruf.Eingabe -notmatch [regex]::Escape($f.Secrets[$secret])) { $probleme += "$secret mit falschem Inhalt: '$($aufruf.Eingabe)'" }
      }
    }
    if ($ausgabe -match 'AIzaGeheim|GEHEIM') { $probleme += 'Geheimnis steht in der Ausgabe' }
    if ($probleme) { $fehler++; Write-Host "FEHL $name`: $($probleme -join '; ')" -ForegroundColor Red; Write-Host $ausgabe } else { Write-Host "OK   $name" -ForegroundColor Green }
  }
} finally {
  $env:USERPROFILE = $altHeim
  Remove-Item -Recurse -Force $heim
}
if ($fehler) { Write-Host "$fehler Fall/Faelle fehlgeschlagen" -ForegroundColor Red; exit 1 }
Write-Host "$($faelle.Count) Faelle bestanden" -ForegroundColor Green
$global:LASTEXITCODE = 0
