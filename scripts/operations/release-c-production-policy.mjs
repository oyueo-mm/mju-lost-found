const RELEASE_C = "20261121000000_report_snapshot";

export function checkReleaseCMigrations(local, history, checksum) {
  const applied = new Set();
  for (const row of history) {
    if (row.rolled_back) continue;
    if (!row.applied) throw new Error("Unfinished migration exists");
    if (!local.includes(row.migration_name)) throw new Error("Database migration absent from this checkout");
    if (row.migration_name === RELEASE_C && row.checksum !== checksum) throw new Error("Release C migration checksum differs");
    applied.add(row.migration_name);
  }
  const pending = local.filter((name) => !applied.has(name)).sort();
  if (pending.length && (pending.length !== 1 || pending[0] !== RELEASE_C)) throw new Error("Only release C may be pending");
  return pending;
}
