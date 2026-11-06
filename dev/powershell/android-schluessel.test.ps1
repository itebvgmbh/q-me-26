# Test fuer den Block "Upload-Schluessel anlegen" aus android/README.md (Windows PowerShell 5.1 und 7):
#   powershell -NoProfile -File dev/powershell/android-schluessel.test.ps1
# keytool und gh sind nachgebildet; der Schluessel landet in einem Temp-Ordner.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $PSScriptRoot 'Attrappen.ps1')
$readme = [IO.File]::ReadAllText((Join-Path $repo 'android\README.md'), [Text.Encoding]::UTF8)
$abschnitt = $readme.Substring($readme.IndexOf('## Upload-Schl'))
$text = [regex]::Match($abschnitt, '(?s)```powershell\r?\n(.*?)\r?\n```').Groups[1].Value
if (-not $text) { throw 'Block nicht gefunden' }
if ($text -match '\r?\n\s*\r?\n') { throw 'Leerzeile im Block' }
$block = [ScriptBlock]::Create($text)

$global:GhAufrufe = New-Object System.Collections.ArrayList
$global:KeytoolExit = 0
$global:GhExit = 0
function global:keytool {
  [void]$global:QmeAttrappe.Aufrufe.Add("keytool $($args -join ' ')")
  $i = [array]::IndexOf($args, '-keystore')
  if ($global:KeytoolExit -eq 0) { [IO.File]::WriteAllBytes($args[$i + 1], [byte[]](1, 2, 3, 4)) }
  $global:LASTEXITCODE = $global:KeytoolExit
}
function global:gh {
  $eingabe = @($input) -join ''
  [void]$global:GhAufrufe.Add("gh $($args -join ' ')|$eingabe")
  $global:LASTEXITCODE = $global:GhExit
  if ($args[1] -eq 'list') { "ANDROID_UPLOAD_KEYSTORE`t2026-10-27`nANDROID_UPLOAD_PASSWORD`t2026-10-27" }
}

$ordner = Join-Path ([IO.Path]::GetTempPath()) ("android-schluessel-test-" + [guid]::NewGuid())
$faelle = [ordered]@{
  'neu anlegen und hinterlegen'   = @{ Datei = 'neu\a.jks'; Erwartet = 'Fertig'; Keytool = 1; Gh = 3 }
  'Pfad per Drag & Drop'          = @{ Datei = 'mit leer\b.jks'; Anfuehrung = $true; Erwartet = 'Fertig'; Keytool = 1; Gh = 3 }
  'Schluessel schon da'           = @{ Datei = 'da.jks'; Vorhanden = $true; Erwartet = 'der wird genommen'; Keytool = 0; Gh = 3 }
  'Java fehlt'                    = @{ Datei = 'c.jks'; Fehlt = @('keytool'); Erwartet = 'Java fehlt'; Keytool = 0; Gh = 0 }
  'keytool abgebrochen'           = @{ Datei = 'd.jks'; KeytoolExit = 1; Erwartet = 'nicht angelegt'; Keytool = 1; Gh = 0 }
  'gh fehlt'                      = @{ Datei = 'e.jks'; Fehlt = @('gh'); Erwartet = 'gh (GitHub CLI) fehlt'; Keytool = 1; Gh = 0 }
  'gh scheitert'                  = @{ Datei = 'f.jks'; GhExit = 1; Erwartet = 'nicht in GitHub hinterlegt'; Keytool = 1; Gh = 1 }
}
$fehler = 0
try {
  foreach ($name in $faelle.Keys) {
    $f = $faelle[$name]
    $pfad = Join-Path $ordner $f.Datei
    if ($f.Vorhanden) { New-Item -ItemType Directory -Force -Path (Split-Path $pfad) | Out-Null; [IO.File]::WriteAllBytes($pfad, [byte[]](9, 9)) }
    $antwort = $pfad
    if ($f.Anfuehrung) { $antwort = '"' + $pfad + '"' }
    $fehlt = @()
    if ($f.Fehlt) { $fehlt = $f.Fehlt }
    Set-QmeAttrappe -Antworten @($antwort) -Fehlt $fehlt
    $global:GhAufrufe.Clear()
    $global:KeytoolExit = 0
    if ($f.KeytoolExit) { $global:KeytoolExit = $f.KeytoolExit }
    $global:GhExit = 0
    if ($f.GhExit) { $global:GhExit = $f.GhExit }
    $ausgabe = & $block 6>&1 | Out-String
    $keytool = @(Get-QmeAufrufe | Where-Object { $_ -like 'keytool*' })
    $probleme = @()
    if ($ausgabe -notmatch [regex]::Escape($f.Erwartet)) { $probleme += "Meldung '$($f.Erwartet)' fehlt" }
    if ($keytool.Count -ne $f.Keytool) { $probleme += "keytool $($keytool.Count)x statt $($f.Keytool)x" }
    if ($keytool.Count -and $keytool[0] -notmatch '-alias upload .*-dname CN=ITEBV GmbH, O=ITEBV GmbH, C=DE') { $probleme += "keytool-Aufruf: $($keytool[0])" }
    if ($global:GhAufrufe.Count -ne $f.Gh) { $probleme += "gh $($global:GhAufrufe.Count)x statt $($f.Gh)x: $($global:GhAufrufe -join ' / ')" }
    if ($f.Gh -ge 1) {
      $erwartet = [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfad))
      if ($global:GhAufrufe[0] -ne "gh secret set ANDROID_UPLOAD_KEYSTORE --repo itebvgmbh/q-me-26|$erwartet") { $probleme += "Schluessel nicht per Pipe: $($global:GhAufrufe[0])" }
    }
    if ($f.Gh -ge 2 -and $global:GhAufrufe[1] -ne 'gh secret set ANDROID_UPLOAD_PASSWORD --repo itebvgmbh/q-me-26|') { $probleme += "Passwort-Aufruf: $($global:GhAufrufe[1])" }
    if ($f.Vorhanden -and ([IO.File]::ReadAllBytes($pfad) -join ',') -ne '9,9') { $probleme += 'vorhandener Schluessel ueberschrieben' }
    if ($probleme) { $fehler++; Write-Host "FEHL $name`: $($probleme -join '; ')" -ForegroundColor Red; Write-Host $ausgabe } else { Write-Host "OK   $name" -ForegroundColor Green }
  }
} finally {
  Remove-Item -Recurse -Force $ordner -ErrorAction SilentlyContinue
}
if ($fehler) { Write-Host "$fehler Fall/Faelle fehlgeschlagen" -ForegroundColor Red; exit 1 }
Write-Host 'Alle Faelle bestanden' -ForegroundColor Green
