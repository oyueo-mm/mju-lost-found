# Encrypt a backup folder and prove the ENCRYPTED file restores, before the
# plaintext may go:
#   1. seal.mjs seal <dir>              -> <dir>.tar.enc (round-trip checked)
#   2. seal.mjs unseal <dir>.tar.enc    -> a temporary copy
#   3. verify-restore.mjs on that copy, in a throwaway local PostgreSQL cluster
#      (row counts, every referenced photo present)
#   4. only with -RemovePlain and only after "RESTORE VERIFIED": delete <dir>
# The temporary copy and cluster (personal data) are always deleted at the end.
# The passphrase comes from Windows Credential Manager (BackupSecret.psm1) and
# is given only to the seal.mjs child processes.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\protect.ps1 -Dir <backupDir> [-RemovePlain]
#
# Restore check only, of an archive made earlier (nothing sealed or deleted;
# the quarterly check, or before removing older copies):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\protect.ps1 -Enc <file.tar.enc>
param(
  [string]$Dir = "",
  [string]$Enc = "",
  [switch]$RemovePlain,
  [string]$Repo = "",
  [string]$PgBin = "C:\msys64\ucrt64\bin",
  [string]$CredentialTarget = "MJU Find backup passphrase",
  [string]$Log = "",
  [int]$Port = 55439
)
$ErrorActionPreference = "Stop"
if (-not $Repo) { $Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
Import-Module (Join-Path $PSScriptRoot "BackupSecret.psm1") -Force
$verifyOnly = [bool]$Enc
if ($verifyOnly) {
  if ($Dir -or $RemovePlain) { throw "-Enc checks an existing archive only (no -Dir / -RemovePlain)" }
  $Enc = (Resolve-Path $Enc).Path
  $Dir = $Enc -replace "\.tar\.enc$", ""
} else {
  if (-not $Dir) { throw "give -Dir <backupDir> (encrypt + check) or -Enc <file.tar.enc> (check only)" }
  $Dir = (Resolve-Path $Dir).Path.TrimEnd("\")
}
if (-not $Log) { $Log = Join-Path (Split-Path $Dir -Parent) "protect-backup.log" }
function Log($m) { $line = "$(Get-Date -Format s) $m"; $line | Add-Content -Encoding utf8 $Log; Write-Host $line }
function Run($exe, [string[]]$argv, $what) {
  # Windows PowerShell turns a native program's stderr into errors under
  # "Stop"; judge by the exit code instead.
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { $out = & $exe @argv 2>&1 | Out-String } finally { $ErrorActionPreference = $prev }
  if ($LASTEXITCODE -ne 0) { throw "$what failed ($LASTEXITCODE): $($out.Trim())" }
  return $out
}

$enc = if ($verifyOnly) { $Enc } else { "$Dir.tar.enc" }
$tmp = Join-Path $env:TEMP ("mju-verify-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$cluster = Join-Path $tmp "pg"
$copy = Join-Path $tmp "copy"
$pg = $null
Set-Location $Repo
try {
  $env:BACKUP_PASSPHRASE = Get-BackupPassphraseText -Target $CredentialTarget
  if (-not $verifyOnly) {
    if (-not (Test-Path (Join-Path $Dir "SHA256SUMS"))) { throw "not a backup folder (no SHA256SUMS): $Dir" }
    Log "seal $Dir"
    $o = Run "node" @("scripts/backup/seal.mjs", "seal", $Dir) "seal.mjs seal"
    Log $o.Trim()
  }

  Log "restore check of $enc"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  Run "node" @("scripts/backup/seal.mjs", "unseal", $enc, $copy) "seal.mjs unseal" | Out-Null
  Remove-Item Env:BACKUP_PASSPHRASE
  $restored = Join-Path $copy (Split-Path $Dir -Leaf)
  Run (Join-Path $PgBin "initdb.exe") @("-D", $cluster, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale") "initdb" | Out-Null
  $pg = Start-Process -FilePath (Join-Path $PgBin "postgres.exe") -ArgumentList @("-D", "`"$cluster`"", "-p", "$Port", "-c", "listen_addresses=127.0.0.1") -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 30; $i++) { & (Join-Path $PgBin "pg_isready.exe") -h 127.0.0.1 -p $Port | Out-Null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 1 }
  Run (Join-Path $PgBin "createdb.exe") @("-h", "127.0.0.1", "-p", "$Port", "-U", "postgres", "verify") "createdb" | Out-Null
  $env:PG_BIN = $PgBin
  $env:VERIFY_DATABASE_URL = "postgresql://postgres@127.0.0.1:$Port/verify"
  $o = Run "node" @("scripts/backup/verify-restore.mjs", $restored) "verify-restore.mjs"
  Log $o.Trim()
  if ($o -notmatch "RESTORE VERIFIED") { throw "restore not verified" }
  Log "RESTORE VERIFIED from the encrypted file: $enc"

  if ($verifyOnly) {
    # check only: nothing sealed, nothing deleted
  } elseif ($RemovePlain) {
    Remove-Item -LiteralPath $Dir -Recurse -Force
    Log "plaintext folder removed: $Dir"
  } else {
    Log "plaintext folder kept (no -RemovePlain): $Dir"
  }
} catch {
  Log "FAILED: $($_.Exception.Message) -- nothing deleted"
  throw
} finally {
  if (Test-Path Env:BACKUP_PASSPHRASE) { Remove-Item Env:BACKUP_PASSPHRASE }
  Remove-Item Env:VERIFY_DATABASE_URL -ErrorAction SilentlyContinue
  if ($pg -and -not $pg.HasExited) {
    & (Join-Path $PgBin "pg_ctl.exe") -D $cluster stop -m fast 2>&1 | Out-Null
    if (-not $pg.HasExited) { Stop-Process -Id $pg.Id -Force }
  }
  if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}
