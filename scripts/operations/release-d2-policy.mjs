export const D2_MIGRATIONS = [
  "20261122000000_image_embedding_jobs", "20261122010000_image_job_rls",
  "20261122020000_image_job_cache", "20261122030000_image_job_fence",
  "20261122040000_image_job_protocol",
];
export const LEGACY_DRAIN_SECONDS = 330; // Fluid Hobby maximum 300s + margin
// Documented in docs/THANK_NOTES.md; original Git e112c02, LF/CRLF only.
// History validation only. This SQL is never scheduled or applied by D2.
export const PREVIEW_HISTORICAL_MIGRATIONS = {
  "20261102000000_identity_access_purpose": ["b7a8718f390fc758f3f2cb329929c70cbcec160a477ad2f9d4da128725a8870f", "ace493646e6f69c5946a2b3d8b24461fb59bebb20a6d21485f4bfdbbcb9eac8d"],
};

export function checkD2Migrations(localChecksums, history, historicalChecksums = {}) {
  const applied = new Set();
  for (const row of history) {
    if (row.rolled_back) continue;
    if (!row.applied) throw new Error("Unfinished migration exists");
    const allowed = localChecksums[row.migration_name] ?? historicalChecksums[row.migration_name];
    if (!allowed) throw new Error("Database migration absent from checkout");
    if (!allowed.includes(row.checksum)) throw new Error("Migration checksum differs");
    applied.add(row.migration_name);
  }
  const pending = Object.keys(localChecksums).filter(name => !applied.has(name)).sort();
  if (pending.some(name => !D2_MIGRATIONS.includes(name))) throw new Error("Only D2 migrations may be pending");
  return pending;
}
