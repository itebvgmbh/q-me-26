# Attrappen zum Testen von PowerShell-Bloecken fuer den Nutzer - ohne den Server anzufassen.
# Laeuft in Windows PowerShell 5.1 und PowerShell 7. Beispiel: dev/powershell/Beispiel.ps1
#
#   . .\dev\powershell\Attrappen.ps1
#   Set-QmeAttrappe -Antworten @('', 'j') -Ssh ([ordered]@{ 'echo q-me-ok' = 'q-me-ok'; 'update.sh' = @{ Ausgabe = 'Fertig.'; Exit = 0 } }) -Fehlt @('claude')
#   . .\mein-block.ps1
#
# -Antworten: was Read-Host der Reihe nach "eingibt"
# -Ssh:       Teil des Server-Befehls -> Ausgabe (Text) oder @{ Ausgabe = ...; Exit = n }; erster Treffer gilt
# -Fehlt:     Programme, die Get-Command als "nicht installiert" meldet (z. B. git, claude)
# Get-QmeAufrufe zeigt danach, welche ssh/scp-Befehle der Block abgesetzt haette.

$global:QmeAttrappe = @{ Antworten = New-Object System.Collections.Queue; Ssh = [ordered]@{}; Fehlt = @(); Aufrufe = New-Object System.Collections.ArrayList }

function global:Set-QmeAttrappe {
  param([string[]]$Antworten = @(), $Ssh = [ordered]@{}, [string[]]$Fehlt = @())
  $global:QmeAttrappe.Antworten.Clear()
  foreach ($a in $Antworten) { $global:QmeAttrappe.Antworten.Enqueue($a) }
  $global:QmeAttrappe.Ssh = $Ssh
  $global:QmeAttrappe.Fehlt = $Fehlt
  $global:QmeAttrappe.Aufrufe.Clear()
}

function global:Get-QmeAufrufe { $global:QmeAttrappe.Aufrufe }

function global:Read-Host {
  param($Prompt)
  $a = ''
  if ($global:QmeAttrappe.Antworten.Count -gt 0) { $a = $global:QmeAttrappe.Antworten.Dequeue() }
  Write-Host "[Frage] $Prompt -> '$a'" -ForegroundColor DarkGray
  return $a
}

function global:ssh {
  $befehl = [string]$args[-1]
  [void]$global:QmeAttrappe.Aufrufe.Add("ssh $befehl")
  Write-Host "[ssh] $befehl" -ForegroundColor DarkGray
  foreach ($muster in $global:QmeAttrappe.Ssh.Keys) {
    if ($befehl -like "*$muster*") {
      $r = $global:QmeAttrappe.Ssh[$muster]
      if ($r -is [hashtable]) { $global:LASTEXITCODE = [int]$r.Exit; return $r.Ausgabe }
      $global:LASTEXITCODE = 0
      return $r
    }
  }
  $global:LASTEXITCODE = 0
}

function global:scp {
  [void]$global:QmeAttrappe.Aufrufe.Add("scp $($args -join ' ')")
  Write-Host "[scp] $($args -join ' ')" -ForegroundColor DarkGray
  $global:LASTEXITCODE = 0
}

# Programme als "fehlt" melden; alles andere wie gewohnt
function global:Get-Command {
  [CmdletBinding()]
  param([Parameter(Position = 0)][string]$Name)
  if ($global:QmeAttrappe.Fehlt -contains $Name) { return $null }
  Microsoft.PowerShell.Core\Get-Command -Name $Name -ErrorAction SilentlyContinue
}
