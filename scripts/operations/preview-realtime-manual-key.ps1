# Preserve the original Preview-only operator command.
param(
  [ValidateSet('Prepare','Copy','Verify','CheckClipboardSupport')]
  [string]$Action = 'Prepare',
  [switch]$ConfirmPreview,
  [ValidateRange(10,300)][int]$ClearAfterSeconds = 120
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmPreview) { throw 'Preview-only confirmation is required.' }
& (Join-Path $PSScriptRoot 'realtime-manual-key.ps1') -Action $Action -ConfirmPreview -ClearAfterSeconds $ClearAfterSeconds
exit $LASTEXITCODE
