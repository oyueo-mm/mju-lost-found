import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifyStorageReferences } from "./storage-references.mjs";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function backup(isPublic = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mju-evidence-test-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "storage/report-evidence/reports/1"), { recursive: true });
  const bytes = Buffer.from("evidence fixture");
  fs.writeFileSync(path.join(dir, "storage/report-evidence/reports/1/0.jpg"), bytes);
  fs.writeFileSync(path.join(dir, "storage/objects.json"), JSON.stringify({
    buckets: [{ id: "report-evidence", public: isPublic }],
    objects: { "report-evidence": [{ path: "reports/1/0.jpg", sha256: createHash("sha256").update(bytes).digest("hex") }] },
  }));
  return dir;
}
describe("restore evidence reference validation", () => {
  it("requires private bucket metadata and matching backed-up bytes", () => {
    const dir = backup();
    expect(verifyStorageReferences(dir, { "report-evidence": ["reports/1/0.jpg"] })).toBe(0);
    fs.writeFileSync(path.join(dir, "storage/report-evidence/reports/1/0.jpg"), "corrupted");
    expect(verifyStorageReferences(dir, { "report-evidence": ["reports/1/0.jpg"] })).toBe(1);
  });
  it("rejects missing evidence, public evidence buckets, and path traversal", () => {
    expect(verifyStorageReferences(backup(), { "report-evidence": ["reports/1/1.jpg"] })).toBe(1);
    expect(verifyStorageReferences(backup(true), { "report-evidence": ["reports/1/0.jpg"] })).toBe(1);
    expect(verifyStorageReferences(backup(), { "report-evidence": ["../outside"] })).toBe(1);
  });
  it("supports pre-migration backups without an evidence bucket", () => {
    expect(verifyStorageReferences(backup(), { "report-evidence": [] })).toBe(0);
  });
});
