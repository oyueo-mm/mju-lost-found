# Encrypt a backup folder, prove the ENCRYPTED file holds exactly the backup,
# then prove it restores:
#   1. seal.mjs seal <dir>             -> <dir>.tar.enc (decrypt round-trip checked)
#   2. seal.mjs unseal <dir>.tar.enc   -> a temporary copy
#   3. checksums.mjs verify <copy>     -> every file matches the backup's SHA256SUMS
#   4. with -RemovePlain: delete <dir> now -- the encrypted file is proven to hold
#      the same bytes, so a later restore-check failure never leaves plaintext
#      personal data behind (2026-11-15 change)
#   5. restore check of the copy in WSL (scripts/backup/wsl-restore-check.sh:
#      official Ubuntu PostgreSQL 18 + pgvector, throwaway cluster) -- row
#      counts and every referenced photo present
#   6. on success: <dir>.tar.enc.verified.json (what retention trusts)
# The temporary copy (personal data) is always deleted at the end. The
# passphrase comes from Windows Credential Manager (BackupSecret.psm1) and is
# given only to the seal.mjs child processes. An existing .tar.enc is never
# overwritten.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\protect.ps1 -Dir <backupDir> [-RemovePlain]
#
# Restore check only, of an archive made earlier (nothing sealed or deleted):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\protect.ps1 -Enc <file.tar.enc>
param(
  [string]$Dir = "",
  [string]$Enc = "",
  [switch]$RemovePlain,
  [string]$Repo = "",
  [string]$WslDistro = "Ubuntu",
  [string]$CredentialTarget = "MJU Find backup passphrase",
  [string]$Log = ""
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
$marker = "$enc.verified.json"
$tmp = Join-Path $env:TEMP ("mju-verify-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$copy = Join-Path $tmp "copy"
Set-Location $Repo
try {
  $env:BACKUP_PASSPHRASE = Get-BackupPassphraseText -Target $CredentialTarget
  if (-not $verifyOnly) {
    if (-not (Test-Path (Join-Path $Dir "SHA256SUMS"))) { throw "not a backup folder (no SHA256SUMS): $Dir" }
    if (Test-Path $enc) { throw "refusing to overwrite an existing archive: $enc" }
    Log "seal $Dir"
    $o = Run "node" @("scripts/backup/seal.mjs", "seal", $Dir) "seal.mjs seal"
    Log $o.Trim()
  }

  New-Item -ItemType Directory -Force $tmp | Out-Null
  Run "node" @("scripts/backup/seal.mjs", "unseal", $enc, $copy) "seal.mjs unseal" | Out-Null
  Remove-Item Env:BACKUP_PASSPHRASE
  $restored = Join-Path $copy (Split-Path $Dir -Leaf)
  $o = Run "node" @("scripts/backup/checksums.mjs", "verify", $restored) "checksums.mjs verify"
  Log "decrypted copy of $enc -- $($o.Trim())"

  if (-not $verifyOnly -and $RemovePlain) {
    Remove-Item -LiteralPath $Dir -Recurse -Force
    Log "plaintext folder removed (encrypted copy decrypts to identical files): $Dir"
  }

  Log "restore check of $enc (WSL $WslDistro)"
  $o = Run "wsl.exe" @("-d", $WslDistro, "-e", "bash", (& wsl.exe -d $WslDistro -e wslpath -a (Join-Path $Repo "scripts\backup\wsl-restore-check.sh")).Trim(), $restored, $Repo) "restore check"
  Log $o.Trim()
  if ($o -notmatch "RESTORE VERIFIED") { throw "restore not verified" }
  $tables = if ($o -match "tables: (\d+), row-count mismatches: (\d+)") { @{ tables = [int]$matches[1]; mismatches = [int]$matches[2] } } else { @{} }
  $images = if ($o -match "image paths referenced: (\d+), missing from backup: (\d+)") { @{ referenced = [int]$matches[1]; missing = [int]$matches[2] } } else { @{} }
  [pscustomobject]@{ archive = (Split-Path $enc -Leaf); verifiedAt = (Get-Date -Format o); checksums = "ok"; tables = $tables; images = $images; engine = "wsl:$WslDistro" } |
    ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $marker
  Log "RESTORE VERIFIED from the encrypted file: $enc"
} catch {
  $state = if (Test-Path $Dir) { "plaintext kept: $Dir" } else { "plaintext already removed (encrypted copy verified)" }
  Log "FAILED: $($_.Exception.Message) -- $state"
  throw
} finally {
  if (Test-Path Env:BACKUP_PASSPHRASE) { Remove-Item Env:BACKUP_PASSPHRASE }
  if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
}
