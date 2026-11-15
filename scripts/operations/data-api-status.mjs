// HTTP status only; never prints keys, response bodies or connection strings.
import { assertScriptSupabaseAccess } from "../../src/lib/db/accessPolicy.mjs";
const target = assertScriptSupabaseAccess(process.env);
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("Service credential missing");
const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (base.protocol !== "https:" || base.username || base.password || base.search) throw new Error("Unexpected Storage origin");
const response = await fetch(new URL("/rest/v1/", base), { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000), redirect: "error" });
await response.body?.cancel();
console.log(JSON.stringify({ target, status: response.status, remainsUnavailable: response.status === 503 }));
if (response.status !== 503) process.exitCode = 1;
