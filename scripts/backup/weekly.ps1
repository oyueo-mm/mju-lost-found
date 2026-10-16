# Weekly Production backup: backup -> seal (encrypt) -> restore check of the
# encrypted file (protect.ps1) -> remove plaintext only if verified -> keep the
# newest $Keep weekly archives. Writes a log next to the archives and
# shows a message box when anything fails (Task Scheduler also records the
# non-zero exit code). Meant for Windows Task Scheduler on the operator's PC;
# see docs/operations.md §5 for registering it.
#
# Needs: the passphrase in Windows Credential Manager (BackupSecret.psm1,
# Set-BackupPassphrase -- never in this file or the environment), the
# repository at $Repo with its local .env (Production), PostgreSQL client and
# server (with pgvector) in $PgBin for the restore check.
param(
  [string]$Repo = "C:\proj_claude\mju-lost-found-vercel",
  [string]$Out = "$env:USERPROFILE\mju-lost-found-backups",
  [string]$PgBin = "C:\msys64\ucrt64\bin",
  [string]$ProjectRef = "tmifqt",
  [string]$EnvFile = ".env",
  [int]$Keep = 4,
  [string]$CredentialTarget = "MJU Find backup passphrase",
  [switch]$Quiet
)
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "BackupSecret.psm1") -Force
$stamp = Get-Date -Format "yyyy-MM-dd"
$name = "weekly-$stamp"
$log = Join-Path $Out "weekly-backup.log"
New-Item -ItemType Directory -Force $Out | Out-Null
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content -Encoding utf8 $log }
try {
  if (-not (Test-BackupPassphrase -Target $CredentialTarget)) { throw "backup passphrase not in Windows Credential Manager (run Set-BackupPassphrase)" }
  Set-Location $Repo
  $env:PG_BIN = $PgBin
  Log "start $name"
  $dir = Join-Path $Out $name
  # Through cmd so a warning on stderr is logged, not treated as a failure.
  cmd /c "node --env-file=$EnvFile scripts/backup/backup.mjs `"$dir`" --expect $ProjectRef >> `"$log`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "backup.mjs failed ($LASTEXITCODE)" }
  # Encrypt, restore-check the encrypted file, and only then remove the plaintext.
  & (Join-Path $PSScriptRoot "protect.ps1") -Dir $dir -RemovePlain -Repo $Repo -PgBin $PgBin -Log $log -CredentialTarget $CredentialTarget
  if (-not (Test-Path "$dir.tar.enc") -or (Test-Path $dir)) { throw "protect.ps1 did not finish (plaintext kept: $dir)" }
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
