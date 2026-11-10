// Prevent an inherited shell/CI secret from reaching an unmocked driver in a unit test.
import "./install-guard.mjs";
for (const key of ["DATABASE_URL", "DIRECT_URL", "SUPABASE_SERVICE_ROLE_KEY", "MJU_DB_OPERATION", "MJU_DB_APPROVAL_REFERENCE"]) {
  delete process.env[key];
}
