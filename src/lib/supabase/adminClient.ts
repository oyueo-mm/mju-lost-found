import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Phase N: pulled out of src/lib/images/supabaseAdmin.ts (which now
// imports this instead of declaring its own private singleton) so the new
// chat Realtime broadcaster (chat/realtimeAdmin.ts) can reuse the same
// server-only client rather than opening a second one.
//
// Server-only -- SUPABASE_SERVICE_ROLE_KEY bypasses Row Level Security
// entirely, so this module must never be imported from a "use client"
// file or any code that ends up in the browser bundle. The browser-facing
// counterpart is src/lib/supabase/browserClient.ts, which only ever holds
// the public anon key.

if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  // Same "warn but don't crash at import time" pattern as src/lib/db/prisma.ts
  // -- lets a DATABASE_URL/SUPABASE-less build or test run still import this
  // module; the real failure surfaces lazily on first actual use instead.
  console.warn(
    "[supabase-admin] SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is not set. " +
      "Storage and chat Realtime operations will fail until both are configured (see .env.example).",
  );
}

let _admin: SupabaseClient | null = null;
export function getSupabaseAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
  return _admin;
}
