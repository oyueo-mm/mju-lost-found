# Weekly Production backup: backup -> seal (encrypt) -> remove plaintext ->
# keep the newest $Keep weekly archives. Writes a log next to the archives and
# shows a message box when anything fails (Task Scheduler also records the
# non-zero exit code). Meant for Windows Task Scheduler on the operator's PC;
# see docs/operations.md §5 for registering it.
#
# Needs: BACKUP_PASSPHRASE in the user's environment (not in this file), the
# repository at $Repo with its local .env (Production), PostgreSQL client in $PgBin.
param(
  [string]$Repo = "C:\proj_claude\mju-lost-found-vercel",
  [string]$Out = "$env:USERPROFILE\mju-lost-found-backups",
  [string]$PgBin = "C:\msys64\ucrt64\bin",
  [string]$ProjectRef = "tmifqt",
  [string]$EnvFile = ".env",
  [int]$Keep = 4,
  [switch]$Quiet
)
$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyy-MM-dd"
$name = "weekly-$stamp"
$log = Join-Path $Out "weekly-backup.log"
New-Item -ItemType Directory -Force $Out | Out-Null
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content -Encoding utf8 $log }
try {
  if (-not $env:BACKUP_PASSPHRASE) { throw "BACKUP_PASSPHRASE is not set" }
  Set-Location $Repo
  $env:PG_BIN = $PgBin
  Log "start $name"
  $dir = Join-Path $Out $name
  # Through cmd so a warning on stderr is logged, not treated as a failure.
  cmd /c "node --env-file=$EnvFile scripts/backup/backup.mjs `"$dir`" --expect $ProjectRef >> `"$log`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "backup.mjs failed ($LASTEXITCODE)" }
  cmd /c "node scripts/backup/seal.mjs seal `"$dir`" --remove-plain >> `"$log`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "seal.mjs failed ($LASTEXITCODE)" }
  # Retention: only weekly-*.tar.enc are pruned; named backups (e.g. pre-migration) are never touched.
  Get-ChildItem $Out -Filter "weekly-*.tar.enc" | Sort-Object Name -Descending | Select-Object -Skip $Keep | ForEach-Object {
    Remove-Item $_.FullName -Force
    Log "pruned $($_.Name)"
  }
  Log "done $name"
} catch {
  Log "FAILED: $($_.Exception.Message)"
  if ($Quiet) { exit 1 }
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("MJU Find 주간 백업 실패: $($_.Exception.Message)`n로그: $log", "MJU Find 백업") | Out-Null
  exit 1
}
