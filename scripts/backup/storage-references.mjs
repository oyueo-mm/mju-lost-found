import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Validate actual bytes AND the manifest, including private bucket metadata.
// No filenames or personal data are printed by this helper.
export function verifyStorageReferences(dir, references) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "storage/objects.json"), "utf8"));
  let missing = 0;
  for (const [bucket, names] of Object.entries(references)) {
    const meta = manifest.buckets.find((b) => b.id === bucket);
    if (names.length && (!meta || (bucket !== "post-images" && meta.public !== false))) {
      missing += names.length;
      continue;
    }
    for (const name of new Set(names)) {
      if (typeof name !== "string" || name.includes("\\") || name.split("/").some((s) => !s || s === "." || s === "..")) { missing++; continue; }
      const object = manifest.objects[bucket]?.find((o) => o.path === name);
      const file = path.join(dir, "storage", bucket, name);
      if (!object || !fs.existsSync(file) || createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== object.sha256) missing++;
    }
  }
  return missing;
}
