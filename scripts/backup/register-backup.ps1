# Registers (or replaces) the backup tasks for the CURRENT Windows user and
# removes the old weekly task:
#   "MJU Find daily backup"    daily at -At, and 10 minutes after logon; a run
#                              missed while the PC was off starts when it is
#                              next available; never two at once.
#   "MJU Find backup watchdog" daily at -WatchAt, and 2 hours after logon:
#                              alerts if no restore-verified backup in 36 h.
# Both run only while the user is logged on (the backup passphrase lives in
# that user's Windows Credential Manager). No administrator rights needed.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\register-backup.ps1
param(
  [string]$At = "04:00",
  [string]$WatchAt = "13:00",
  [switch]$AllowDevCheckout
)
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "BackupSecret.psm1") -Force
# Register only from the dedicated backup worktree (branch ops/backup), never
# from a development checkout whose branch changes all the time:
#   git worktree add -b ops/backup C:\proj_claude\mju-find-backup-ops <commit>
# (setup and update steps: docs/operations.md, "백업 전용 작업 트리").
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$branch = (& git -C $repoRoot rev-parse --abbrev-ref HEAD 2>$null)
if ($branch -ne "ops/backup" -and -not $AllowDevCheckout) {
  throw "register from the ops/backup worktree (this checkout is on '$branch'); see docs/operations.md"
}
foreach ($required in ".env.operations-production", "node_modules\pg", "node_modules\@supabase\supabase-js", "node_modules\dotenv") {
  if (-not (Test-Path (Join-Path $repoRoot $required))) { throw "missing in ${repoRoot}: $required (see docs/operations.md)" }
}
if (-not (Test-BackupPassphrase)) { throw "먼저 Set-BackupPassphrase로 백업 암호를 저장하세요." }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
$ps = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File"

$backupLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
$backupLogon.Delay = "PT10M"
Register-ScheduledTask -TaskName "MJU Find daily backup" -Force -Principal $principal -Settings $settings `
  -Action (New-ScheduledTaskAction -Execute "powershell.exe" -Argument "$ps `"$(Join-Path $PSScriptRoot 'scheduled.ps1')`"") `
  -Trigger @((New-ScheduledTaskTrigger -Daily -At $At), $backupLogon) | Out-Null

$watchLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
$watchLogon.Delay = "PT2H"
Register-ScheduledTask -TaskName "MJU Find backup watchdog" -Force -Principal $principal -Settings $settings `
  -Action (New-ScheduledTaskAction -Execute "powershell.exe" -Argument "$ps `"$(Join-Path $PSScriptRoot 'check-last-success.ps1')`"") `
  -Trigger @((New-ScheduledTaskTrigger -Daily -At $WatchAt), $watchLogon) | Out-Null

if (Get-ScheduledTask -TaskName "MJU Find weekly backup" -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName "MJU Find weekly backup" -Confirm:$false
  "removed old task: MJU Find weekly backup"
}
Get-ScheduledTask -TaskName "MJU Find daily backup", "MJU Find backup watchdog" |
  Select-Object TaskName, State, @{ n = "NextRun"; e = { (Get-ScheduledTaskInfo $_).NextRunTime } }
