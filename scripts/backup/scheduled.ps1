# Scheduled Production backup (daily): backup -> seal -> checksum-verified copy
# -> plaintext removed -> WSL restore check -> retention.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\scheduled.ps1 [-Force] [-Quiet]
#
# - Production is read through the approval launcher with the standing,
#   backup-only reference (scripts/db/approvalPolicy.mjs): the launcher refuses
#   any other script or argument shape with that reference.
# - pg_dump/pg_restore are the signed EDB Windows build (Smart App Control
#   blocks the unsigned MSYS2 ones); the restore check runs in WSL.
# - One run at a time (named mutex); a day that already has a restore-verified
#   archive is skipped unless -Force.
# - Status: <Out>\backup-status.json (last attempt / last verified success),
#   log: <Out>\backup.log. Failures pop up a message without blocking the task.
# - Retention (7 daily / 4 weekly / 3 monthly, retention.mjs) prunes only
#   verified auto-* archives, and only after THIS run was restore-verified.
param(
  # The checkout this script itself lives in -- the dedicated backup worktree
  # (C:\proj_claude\mju-find-backup-ops, branch ops/backup), so switching
  # branches in the development checkout never changes the backup code.
  [string]$Repo = "",
  [string]$Out = "$env:USERPROFILE\mju-lost-found-backups",
  [string]$PgBin = "$env:USERPROFILE\pgsql-edb\18.7\pgsql\bin",
  [string]$ProjectRef = "tmifqt",
  [string]$Reference = "WEEKLY-BACKUP-STANDING",
  [string]$WslDistro = "Ubuntu",
  [string]$CredentialTarget = "MJU Find backup passphrase",
  [switch]$Force,
  [switch]$Quiet
)
$ErrorActionPreference = "Stop"
if (-not $Repo) { $Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
Import-Module (Join-Path $PSScriptRoot "BackupSecret.psm1") -Force
New-Item -ItemType Directory -Force $Out | Out-Null
$log = Join-Path $Out "backup.log"
$statusFile = Join-Path $Out "backup-status.json"
$stamp = Get-Date -Format "yyyy-MM-dd"
$name = "auto-$stamp"
$dir = Join-Path $Out $name
$enc = "$dir.tar.enc"
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content -Encoding utf8 $log }
function Read-Status { if (Test-Path $statusFile) { try { return Get-Content -Raw $statusFile | ConvertFrom-Json } catch {} }; return [pscustomobject]@{} }
function Save-Status($fields) {
  $s = Read-Status
  foreach ($k in $fields.Keys) { $s | Add-Member -NotePropertyName $k -NotePropertyValue $fields[$k] -Force }
  $s | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $statusFile
}
function Notify($text) {
  if ($Quiet) { return }
  # A separate process, so the scheduled task finishes (and releases its lock)
  # while the message waits for the user.
  $escaped = $text.Replace("'", "''")
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @("-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('$escaped', 'MJU Find 백업') | Out-Null")
}

$mutex = New-Object System.Threading.Mutex($false, "Local\MJUFindScheduledBackup")
if (-not $mutex.WaitOne(0)) { Log "skip: another backup run is in progress"; exit 0 }
try {
  Set-Location $Repo
  $codeBranch = (& git -C $Repo rev-parse --abbrev-ref HEAD 2>$null)
  $codeCommit = (& git -C $Repo rev-parse --short HEAD 2>$null)
  Save-Status @{ lastAttemptAt = (Get-Date -Format o); lastAttemptName = $name; codeRepo = $Repo; codeBranch = $codeBranch; codeCommit = $codeCommit }
  if (-not $Force -and (Test-Path "$enc.verified.json")) { Log "skip: $name is already restore-verified"; exit 0 }
  Log "start $name (code $codeBranch@$codeCommit in $Repo)"
  if ($codeBranch -ne "ops/backup") { Log "warning: not running from the ops/backup worktree" }
  if (-not (Test-BackupPassphrase -Target $CredentialTarget)) { throw "backup passphrase not in Windows Credential Manager (run Set-BackupPassphrase)" }
  foreach ($tool in "pg_dump", "pg_restore") {
    $exe = Join-Path $PgBin "$tool.exe"
    if (-not (Test-Path $exe)) { throw "$tool not found in $PgBin" }
    & $exe --version *> $null
    if ($LASTEXITCODE -ne 0) { throw "$tool cannot run ($LASTEXITCODE) -- blocked or broken: $exe" }
  }

  if (Test-Path $enc) {
    # An earlier run today sealed but did not finish the restore check.
    Log "existing unverified archive $name.tar.enc -- restore check only"
    & (Join-Path $PSScriptRoot "protect.ps1") -Enc $enc -Repo $Repo -WslDistro $WslDistro -Log $log -CredentialTarget $CredentialTarget
  } else {
    if (Test-Path $dir) {
      # Left over by an interrupted run: incomplete or unchecked plaintext.
      Remove-Item -LiteralPath $dir -Recurse -Force
      Log "removed leftover plaintext folder from an interrupted run: $dir"
    }
    $env:PG_BIN = $PgBin
    # cmd's redirection keeps the log UTF-8 (PowerShell 5.1's *>> would append UTF-16).
    cmd /c "node scripts/db/approved-operation.mjs --confirm-production --approval-reference $Reference -- scripts/backup/backup.mjs `"$dir`" --expect $ProjectRef >> `"$log`" 2>&1"
    $code = $LASTEXITCODE
    if ($code -ne 0) {
      if (Test-Path $dir) { Remove-Item -LiteralPath $dir -Recurse -Force; Log "removed incomplete plaintext folder: $dir" }
      throw "backup.mjs failed ($code)"
    }
    & (Join-Path $PSScriptRoot "protect.ps1") -Dir $dir -RemovePlain -Repo $Repo -WslDistro $WslDistro -Log $log -CredentialTarget $CredentialTarget
  }
  if (-not (Test-Path "$enc.verified.json")) { throw "restore check did not finish: $name" }
  if (Test-Path $dir) { throw "plaintext still present: $dir" }
  $sizeMB = [math]::Round((Get-Item $enc).Length / 1MB, 1)
  Save-Status @{ lastSuccessAt = (Get-Date -Format o); lastSuccessName = "$name.tar.enc"; lastSuccessSizeMB = $sizeMB; lastError = $null }

  # Retention -- only now that this run is verified.
  $plan = (& node scripts/backup/retention.mjs plan $Out --today $stamp) | ConvertFrom-Json
  foreach ($file in $plan.prune) {
    $path = Join-Path $Out $file
    if ($file -notmatch '^auto-\d{4}-\d{2}-\d{2}\.tar\.enc$') { continue }
    Remove-Item -LiteralPath $path -Force
    if (Test-Path "$path.verified.json") { Remove-Item -LiteralPath "$path.verified.json" -Force }
    Log "pruned $file (retention 7 daily / 4 weekly / 3 monthly)"
  }
  Log "done $name ($sizeMB MB, restore verified; kept $($plan.keep.Count) managed archives)"
} catch {
  $msg = $_.Exception.Message
  Log "FAILED: $msg"
  Save-Status @{ lastFailureAt = (Get-Date -Format o); lastError = $msg }
  Notify "MJU Find 자동 백업 실패: $msg`n로그: $log"
  exit 1
} finally {
  if (Test-Path Env:PG_BIN) { Remove-Item Env:PG_BIN }
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
