# Test fuer den Block "Speicher-Regeln -> Einspielen (Speicher)" aus deploy/README.md (Windows PowerShell 5.1 und 7):
#   powershell -NoProfile -File dev/powershell/speicher-regeln-einspielen.test.ps1
# Zwischenablage und Downloads sind nachgebildet, die neuen Regeln kommen aus der lokalen storage.rules statt von GitHub.
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$readme = [IO.File]::ReadAllText((Join-Path $repo 'deploy\README.md'), [Text.Encoding]::UTF8)
$abschnitt = $readme.Substring($readme.IndexOf('### Einspielen (Speicher)'))
$block = [regex]::Match($abschnitt, '(?s)```powershell\r?\n(.*?)\r?\n```').Groups[1].Value
if (-not $block) { throw 'Block nicht gefunden' }
$regeln = Join-Path $repo 'storage.rules'
$block = $block.Replace('https://raw.githubusercontent.com/itebvgmbh/q-me-26/bildschirm/storage.rules', ([Uri]$regeln).AbsoluteUri)

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('speicher-test-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $tmp 'Downloads') | Out-Null
$echtesProfil = $env:USERPROFILE
$env:USERPROFILE = $tmp
$global:Ablage = ''
function global:Get-Clipboard { param([switch]$Raw) $global:Ablage }
function global:Set-Clipboard { param($Value) $global:Ablage = $Value }

$neu = [IO.File]::ReadAllText($regeln, [Text.Encoding]::UTF8)
$fehler = 0
$faelle = [ordered]@{
  'leere Zwischenablage'           = @{ Ablage = ''; Erwartet = 'keine Speicher-Regeln'; Sicherung = $false }
  'Firestore- statt Speicher-Regeln' = @{ Ablage = "service cloud.firestore { match /{d=**} { allow read: if true; } }"; Erwartet = 'keine Speicher-Regeln'; Sicherung = $false }
  'alte Speicher-Regeln'           = @{ Ablage = "rules_version = '2';`nservice firebase.storage { match /b/{bucket}/o { match /{allPaths=**} { allow read, write: if request.auth != null; } } }"; Erwartet = 'Neue Regeln in der Zwischenablage'; Sicherung = $true }
  'neue Fassung schon eingespielt' = @{ Ablage = $neu; Erwartet = 'schon eingespielt'; Sicherung = $false }
}
try {
  foreach ($name in $faelle.Keys) {
    $fall = $faelle[$name]
    Get-ChildItem (Join-Path $tmp 'Downloads') | Remove-Item -Force
    $global:Ablage = $fall.Ablage
    $ausgabe = & { & ([scriptblock]::Create($block)) } 6>&1 | Out-String
    $sicherung = @(Get-ChildItem (Join-Path $tmp 'Downloads') -Filter 'speicher-regeln-alt-*.txt').Count -gt 0
    $ok = $ausgabe -match [regex]::Escape($fall.Erwartet) -and $sicherung -eq $fall.Sicherung
    if ($fall.Erwartet -eq 'Neue Regeln in der Zwischenablage') { $ok = $ok -and $global:Ablage -eq $neu }
    if (-not $ok) { $fehler++ }
    Write-Host ("{0} {1}" -f $(if ($ok) { 'OK  ' } else { 'FEHL' }), $name) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
    if (-not $ok) { Write-Host $ausgabe }
  }
} finally {
  $env:USERPROFILE = $echtesProfil
  Remove-Item -Recurse -Force $tmp
}
if ($fehler) { exit 1 }
