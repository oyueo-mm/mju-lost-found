# The backup passphrase in Windows Credential Manager (a "generic" credential,
# protected by DPAPI for this Windows user, stored only on this PC). Never
# printed, never written to a file or the environment by these functions.
#
#   Import-Module .\scripts\backup\BackupSecret.psm1
#   Set-BackupPassphrase      # asks twice (hidden), 16+ characters
#   Test-BackupPassphrase     # True/False only
#   Remove-BackupPassphrase
#
# Scripts read it with Get-BackupPassphraseText and hand it only to the child
# process that needs it (seal.mjs), clearing it right after.

$script:DefaultTarget = "MJU Find backup passphrase"

if (-not ("MjuFind.Cred" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace MjuFind {
  public static class Cred {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENTIAL {
      public int Flags; public int Type; public string TargetName; public string Comment;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
      public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
      public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredWriteW(ref CREDENTIAL c, int flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredReadW(string target, int type, int flags, out IntPtr c);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredDeleteW(string target, int type, int flags);
    [DllImport("advapi32.dll")]
    static extern void CredFree(IntPtr p);
    const int GENERIC = 1, PERSIST_LOCAL_MACHINE = 2;

    public static void Write(string target, IntPtr secret, int chars) {
      var c = new CREDENTIAL { Type = GENERIC, TargetName = target, UserName = "backup", Persist = PERSIST_LOCAL_MACHINE,
        CredentialBlobSize = chars * 2, CredentialBlob = secret, Comment = "MJU Find backup encryption passphrase" };
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    public static string Read(string target) {
      IntPtr p;
      if (!CredReadW(target, GENERIC, 0, out p)) return null;
      try {
        var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
        return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
      } finally { CredFree(p); }
    }
    public static bool Delete(string target) { return CredDeleteW(target, GENERIC, 0); }
  }
}
"@
}

function Set-BackupPassphrase {
  param([string]$Target = $script:DefaultTarget)
  $a = Read-Host "백업 암호 (16자 이상, 화면에 표시되지 않음)" -AsSecureString
  $b = Read-Host "한 번 더 입력" -AsSecureString
  $pa = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($a)
  $pb = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($b)
  try {
    if ($a.Length -lt 16) { throw "암호는 16자 이상이어야 합니다." }
    $same = $a.Length -eq $b.Length
    for ($i = 0; $same -and $i -lt $a.Length; $i++) {
      if ([Runtime.InteropServices.Marshal]::ReadInt16($pa, $i * 2) -ne [Runtime.InteropServices.Marshal]::ReadInt16($pb, $i * 2)) { $same = $false }
    }
    if (-not $same) { throw "두 입력이 다릅니다. 저장하지 않았습니다." }
    [MjuFind.Cred]::Write($Target, $pa, $a.Length)
    Write-Host "저장했습니다: Windows 자격 증명 관리자 > Windows 자격 증명 > '$Target' (이 PC, 이 Windows 사용자만 읽을 수 있음)"
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pa)
    [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pb)
  }
}

function Test-BackupPassphrase {
  param([string]$Target = $script:DefaultTarget)
  $s = [MjuFind.Cred]::Read($Target)
  return ($null -ne $s -and $s.Length -ge 16)
}

function Get-BackupPassphraseText {
  param([string]$Target = $script:DefaultTarget)
  $s = [MjuFind.Cred]::Read($Target)
  if ($null -eq $s) { throw "백업 암호가 자격 증명 관리자에 없습니다('$Target'). Set-BackupPassphrase로 먼저 저장하세요." }
  if ($s.Length -lt 16) { throw "저장된 백업 암호가 16자보다 짧습니다." }
  return $s
}

function Remove-BackupPassphrase {
  param([string]$Target = $script:DefaultTarget)
  if ([MjuFind.Cred]::Delete($Target)) { Write-Host "삭제했습니다: '$Target'" } else { Write-Host "없습니다: '$Target'" }
}

Export-ModuleMember -Function Set-BackupPassphrase, Test-BackupPassphrase, Get-BackupPassphraseText, Remove-BackupPassphrase
