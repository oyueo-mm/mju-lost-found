# Registers (or replaces) the weekly backup task for the CURRENT Windows user:
# every Sunday 04:00, run weekly.ps1; if the PC was off then, run as soon as it
# can. It runs only while this user is signed in (Windows Credential Manager,
# where the passphrase is kept, is unlocked by the sign-in), with normal
# rights, at most 2 hours. Run it yourself once; it changes nothing else.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\register-weekly.ps1
param(
  [string]$TaskName = "MJU Find weekly backup",
  [string]$Script = "",
  [string]$At = "04:00"
)
$ErrorActionPreference = "Stop"
if (-not $Script) { $Script = Join-Path $PSScriptRoot "weekly.ps1" }
Import-Module (Join-Path $PSScriptRoot "BackupSecret.psm1") -Force
if (-not (Test-BackupPassphrase)) { throw "먼저 Set-BackupPassphrase로 백업 암호를 저장하세요." }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Script`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, @{ n = "NextRun"; e = { (Get-ScheduledTaskInfo $_).NextRunTime } }
