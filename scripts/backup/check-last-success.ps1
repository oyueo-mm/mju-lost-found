# Independent backup watchdog: alerts when the newest RESTORE-VERIFIED backup
# is too old -- also when the backup task never ran at all (PC off, task
# disabled, scheduler problem), which the backup job itself cannot report.
# It looks at the archives' own verified markers, not only at the status file.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\check-last-success.ps1 [-MaxAgeHours 36] [-Quiet]
param(
  [string]$Out = "$env:USERPROFILE\mju-lost-found-backups",
  [int]$MaxAgeHours = 36,
  [switch]$Quiet
)
$ErrorActionPreference = "Stop"
$log = Join-Path $Out "backup-watchdog.log"
function Log($m) { "$(Get-Date -Format s) $m" | Add-Content -Encoding utf8 $log }

$newest = $null
foreach ($f in Get-ChildItem -Path $Out -Filter "auto-*.tar.enc.verified.json" -File -ErrorAction SilentlyContinue) {
  $archive = $f.FullName -replace "\.verified\.json$", ""
  if (-not (Test-Path $archive)) { continue }
  $at = $f.LastWriteTime
  try { $at = [datetime](Get-Content -Raw $f.FullName | ConvertFrom-Json).verifiedAt } catch {}
  if (-not $newest -or $at -gt $newest.At) { $newest = [pscustomobject]@{ At = $at; Name = (Split-Path $archive -Leaf) } }
}
$status = $null
$statusFile = Join-Path $Out "backup-status.json"
if (Test-Path $statusFile) { try { $status = Get-Content -Raw $statusFile | ConvertFrom-Json } catch {} }

$ageHours = if ($newest) { [math]::Round(((Get-Date) - $newest.At).TotalHours, 1) } else { [double]::PositiveInfinity }
if ($ageHours -le $MaxAgeHours) {
  Log "ok: newest verified backup $($newest.Name), $ageHours h old"
  exit 0
}
$lastAttempt = if ($status -and $status.lastAttemptAt) { $status.lastAttemptAt } else { "기록 없음" }
$lastError = if ($status -and $status.lastError) { $status.lastError } else { "-" }
$what = if ($newest) { "마지막 검증된 백업: $($newest.Name) ($ageHours 시간 전)" } else { "검증된 자동 백업이 하나도 없습니다" }
$text = "MJU Find 백업 경고: $MaxAgeHours 시간 넘게 새 백업이 검증되지 않았습니다.`n$what`n마지막 시도: $lastAttempt`n마지막 오류: $lastError`n로그: $(Join-Path $Out 'backup.log')"
Log "ALERT: $($text -replace "`n", ' | ')"
if (-not $Quiet) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($text, "MJU Find 백업 감시") | Out-Null
}
exit 1
