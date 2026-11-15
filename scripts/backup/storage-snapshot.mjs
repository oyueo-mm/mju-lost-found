import { createHash } from "node:crypto";
export function assertSnapshotObjects(before, after) {
  const live = new Map(after.map(o => [o.id, o]));
  for (const old of before) {
    const current = live.get(old.id);
    if (!current || old.version !== current.version || String(old.updated_at) !== String(current.updated_at) || old.name !== current.name || old.bucket_id !== current.bucket_id) throw new Error("Snapshot Storage inventory changed; backup incomplete");
  }
}
export function assertSnapshotBytes(object, bytes) {
  if (object.size !== undefined && Number(object.size) !== bytes.length) throw new Error("Snapshot Storage object size changed");
  // Supabase metadata eTag is normally an MD5. If present in this form,
  // detect same-size replacement/cached bytes as well as metadata changes.
  const etag = object.etag?.replaceAll('"', '');
  if (etag && /^[a-f0-9]{32}$/i.test(etag) && createHash("md5").update(bytes).digest("hex") !== etag.toLowerCase()) throw new Error("Snapshot Storage object checksum changed");
}
