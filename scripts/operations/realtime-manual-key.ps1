# Local key preparation and controlled dashboard paste for a confirmed project.
# No Supabase/Vercel writes; no private value is printed or stored plaintext.
param(
  [ValidateSet('Prepare','Copy','Verify','CheckClipboardSupport')]
  [string]$Action = 'Prepare',
  [switch]$ConfirmPreview,
  [switch]$ConfirmProduction,
  [ValidateRange(10,300)][int]$ClearAfterSeconds = 120
)
$ErrorActionPreference = 'Stop'
if ([bool]$ConfirmPreview -eq [bool]$ConfirmProduction) { throw 'Confirm exactly one Realtime project.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$environment = if ($ConfirmProduction) { 'Production' } else { 'Preview' }
$project = if ($ConfirmProduction) { 'tmifqtyxojtuoejxjrng' } else { 'swqvlihgupranzfzjevb' }
$file = Join-Path $repo ('.vercel\realtime-{0}-manual.dpapi' -f $environment.ToLowerInvariant())
$entropy = [Text.Encoding]::UTF8.GetBytes("MJU Find $environment Realtime manual v1")
Add-Type -AssemblyName System.Security

function Read-LocalRealtimeKey {
  $cipher = [Convert]::FromBase64String([IO.File]::ReadAllText($file))
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $value = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
  if ($value.version -ne 1 -or $value.project -cne $project -or $value.key.kty -cne 'EC' -or $value.key.crv -cne 'P-256' -or $value.key.alg -cne 'ES256' -or $value.key.kid -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'Invalid project checkpoint.' }
  foreach ($name in @('d','x','y')) { if ($value.key.$name -notmatch '^[A-Za-z0-9_-]{43}$') { throw 'Invalid key field.' } }
  return $value
}

function New-SensitiveClipboardData([string]$text) {
  Add-Type -AssemblyName System.Windows.Forms
  $data = New-Object Windows.Forms.DataObject
  $data.SetData([Windows.Forms.DataFormats]::UnicodeText,$text)
  # Microsoft-defined registered formats: no OS clipboard history/cloud sync.
  foreach ($format in @('CanIncludeInClipboardHistory','CanUploadToCloudClipboard','ExcludeClipboardContentFromMonitorProcessing')) {
    $stream = New-Object IO.MemoryStream
    $stream.Write([byte[]]@(0,0,0,0),0,4)
    $stream.Position = 0
    $data.SetData($format,$stream)
  }
  return $data
}

$state = $null
$keyJson = $null
try {
  if ($Action -eq 'CheckClipboardSupport') {
    $data = New-SensitiveClipboardData 'non-secret clipboard capability test'
    foreach ($format in @('CanIncludeInClipboardHistory','CanUploadToCloudClipboard','ExcludeClipboardContentFromMonitorProcessing')) {
      if (-not $data.GetDataPresent($format)) { throw 'Clipboard exclusion format unavailable.' }
      $bytes = $data.GetData($format).ToArray()
      if ($bytes.Length -ne 4 -or [BitConverter]::ToUInt32($bytes,0) -ne 0) { throw 'Unexpected clipboard format value.' }
    }
    [pscustomobject]@{action=$Action; supported=$true; clipboardModified=$false} | ConvertTo-Json -Compress
    exit 0
  }
  if ($Action -eq 'Prepare' -and -not (Test-Path -LiteralPath $file)) {
    if ($ConfirmPreview -and (Test-Path -LiteralPath (Join-Path $repo '.vercel\realtime-preview-registration.dpapi'))) { throw 'An API registration checkpoint already exists; preserve it and review first.' }
    Push-Location $repo
    try {
      # The child result is captured in memory; it is never written to stdout.
      $json = @'
import {generateKeyPair,exportJWK,jwtVerify,SignJWT} from 'jose';
import {randomUUID} from 'node:crypto';
const project=process.argv[2];
if (!['swqvlihgupranzfzjevb','tmifqtyxojtuoejxjrng'].includes(project)) throw new Error('Invalid project');
const pair=await generateKeyPair('ES256',{extractable:true});
const token=await new SignJWT({purpose:'local-key-check'}).setProtectedHeader({alg:'ES256'}).sign(pair.privateKey);
await jwtVerify(token,pair.publicKey,{algorithms:['ES256']});
process.stdout.write(JSON.stringify({version:1,project,key:{...await exportJWK(pair.privateKey),alg:'ES256',kid:randomUUID()}}));
'@ | & node --input-type=module - $project
      if ($LASTEXITCODE -ne 0 -or -not $json) { throw 'Local key generation failed.' }
      $cipher = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($json),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
      [IO.Directory]::CreateDirectory((Split-Path $file -Parent)) | Out-Null
      # CreateNew refuses to overwrite any existing key, including a race.
      $stream = [IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      try { $bytes=[Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String($cipher));$stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
      $json = $null
    } finally { Pop-Location }
  }
  if (-not (Test-Path -LiteralPath $file)) { throw 'Prepare the local key first.' }
  $state = Read-LocalRealtimeKey
  if ($Action -eq 'Verify') {
    $jwks = Invoke-RestMethod -Uri "https://$project.supabase.co/auth/v1/.well-known/jwks.json" -Method Get -TimeoutSec 20
    $match = @($jwks.keys | Where-Object {$_.kid -ceq $state.key.kid -and $_.kty -ceq 'EC' -and $_.crv -ceq 'P-256' -and $_.alg -ceq 'ES256' -and $_.x -ceq $state.key.x -and $_.y -ceq $state.key.y})
    [pscustomobject]@{action=$Action; project=$project; publicKid=$state.key.kid; publishedKeyMatches=($match.Count -eq 1); keyStatusVerified=$false; cloudWrites=$false} | ConvertTo-Json -Compress
    if ($match.Count -ne 1) { exit 2 }
  } elseif ($Action -eq 'Copy') {
    if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') { throw 'Run PowerShell with -STA for clipboard access.' }
    $keyJson = $state.key | ConvertTo-Json -Compress
    $data = New-SensitiveClipboardData $keyJson
    [Windows.Forms.Clipboard]::SetDataObject($data,$true)
    [pscustomobject]@{action=$Action; project=$project; publicKid=$state.key.kid; copied=$true; clearAfterSeconds=$ClearAfterSeconds} | ConvertTo-Json -Compress
    # Keep this terminal open while pasting. Ctrl+C also enters finally.
    $expiresAt = [DateTime]::UtcNow.AddSeconds($ClearAfterSeconds)
    try { while ([DateTime]::UtcNow -lt $expiresAt) { Start-Sleep -Seconds 1 } }
    finally {
      $finished = $false
      for ($retry=0; $retry -lt 5 -and -not $finished; $retry++) {
        try {
          if ([Windows.Forms.Clipboard]::ContainsText() -and [Windows.Forms.Clipboard]::GetText() -ceq $keyJson) { [Windows.Forms.Clipboard]::Clear() }
          $finished = $true
        } catch { [Threading.Thread]::Sleep(100) }
      }
      if (-not $finished) { Write-Warning 'Clipboard is locked. Replace its contents manually; automatic clearing could not be confirmed.' }
    }
  } else {
    [pscustomobject]@{action=$Action; project=$project; publicKid=$state.key.kid; encryptedLocalKeyReady=$true; remoteChanges=$false} | ConvertTo-Json -Compress
  }
} catch {
  Write-Error 'Local manual-key operation stopped. Private diagnostics suppressed; no cloud settings changed.'
  exit 1
} finally {
  $state = $null
  $keyJson = $null
}
