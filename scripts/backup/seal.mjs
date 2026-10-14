// Encrypts a backup folder into one file (tar + AES-256-GCM), or back.
//
//   BACKUP_PASSPHRASE=... node scripts/backup/seal.mjs seal   <backupDir>   [--remove-plain]
//   BACKUP_PASSPHRASE=... node scripts/backup/seal.mjs unseal <file.tar.enc> <outDir>
//
// Format: "MJUB1" | salt(16) | iv(12) | ciphertext | tag(16). The key is
// scrypt(passphrase, salt). `seal` decrypts its own output once and compares
// a SHA-256 of the archive before (optionally) deleting the plaintext folder.
// The passphrase never touches disk here; keep it in a password manager --
// without it the backup cannot be restored.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAGIC = Buffer.from("MJUB1");
const [mode, src, dest] = process.argv.slice(2);
const passphrase = process.env.BACKUP_PASSPHRASE ?? "";
if (passphrase.length < 16) throw new Error("set BACKUP_PASSPHRASE (16+ characters)");
const key = (salt) => scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const tarBin = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";

function decryptTo(file, out) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 5).equals(MAGIC)) throw new Error("not a sealed backup");
  const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(salt), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(buf.subarray(33, buf.length - 16)), decipher.final()]);
  fs.writeFileSync(out, plain);
  return plain;
}

if (mode === "seal") {
  const dir = path.resolve(src);
  if (!fs.existsSync(path.join(dir, "SHA256SUMS"))) throw new Error("not a backup folder (no SHA256SUMS)");
  const tarFile = `${dir}.tar`;
  execFileSync(tarBin, ["-cf", tarFile, "-C", path.dirname(dir), path.basename(dir)]);
  const plain = fs.readFileSync(tarFile);
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(salt), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const out = `${dir}.tar.enc`;
  fs.writeFileSync(out, Buffer.concat([MAGIC, salt, iv, enc, cipher.getAuthTag()]), { mode: 0o600 });
  const check = decryptTo(out, `${tarFile}.check`);
  const same = createHash("sha256").update(check).digest("hex") === createHash("sha256").update(plain).digest("hex");
  fs.rmSync(`${tarFile}.check`, { force: true });
  fs.rmSync(tarFile, { force: true });
  if (!same) throw new Error("round-trip check failed -- plaintext kept");
  console.log(`sealed: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)}MB, round-trip verified)`);
  if (process.argv.includes("--remove-plain")) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`plaintext folder removed: ${dir}`);
  }
} else if (mode === "unseal") {
  if (!dest) throw new Error("usage: seal.mjs unseal <file.tar.enc> <outDir>");
  fs.mkdirSync(dest, { recursive: true });
  const tarFile = path.join(dest, "backup.tar");
  decryptTo(src, tarFile);
  execFileSync(tarBin, ["-xf", tarFile, "-C", dest]);
  fs.rmSync(tarFile, { force: true });
  console.log(`unsealed into ${dest}`);
} else {
  throw new Error("usage: seal.mjs seal <backupDir> [--remove-plain] | unseal <file.tar.enc> <outDir>");
}
