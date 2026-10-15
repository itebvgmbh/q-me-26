# Beispiel: einen Block in mehreren Faellen durchspielen.  pwsh -File dev/powershell/Beispiel.ps1
. (Join-Path $PSScriptRoot 'Attrappen.ps1')
$block = {
  $server = 'root@195.201.26.108'
  $verbindung = ssh -o BatchMode=yes -o ConnectTimeout=10 $server 'echo q-me-ok' 2>&1 | Out-String
  if ($verbindung -notmatch 'q-me-ok') { Write-Host 'Abbruch: keine Verbindung' -ForegroundColor Red; return }
  $stand = ssh -o BatchMode=yes $server 'git -C /opt/q-me log --oneline -1' 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Write-Host 'Abbruch: Abfrage fehlgeschlagen' -ForegroundColor Red; return }
  Write-Host "Server-Stand: $stand" -ForegroundColor Green
}
$faelle = [ordered]@{
  'alles gut'          = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'git -C' = '8e810b9 Merge (#5)' }
  'keine Verbindung'   = [ordered]@{ 'echo q-me-ok' = @{ Ausgabe = 'Permission denied (publickey).'; Exit = 255 } }
  'Abfrage scheitert'  = [ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'git -C' = @{ Ausgabe = 'fatal: not a git repository'; Exit = 128 } }
}
foreach ($name in $faelle.Keys) {
  Write-Host "===== $name" -ForegroundColor Cyan
  Set-QmeAttrappe -Ssh $faelle[$name]
  & $block
}
