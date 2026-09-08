import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Phase N: pulled out of src/lib/images/supabaseBrowser.ts (which now
// imports this instead of declaring its own private singleton) so the new
// chat Realtime subscription hook can reuse the exact same client rather
// than opening a second one -- a single browser tab only ever needs one
// Supabase client instance. Client-safe: NEXT_PUBLIC_SUPABASE_ANON_KEY is
// designed by Supabase to be public (same category as a Firebase web
// config), and authorizes nothing here on its own -- see this file's two
// callers for what each actually relies on for real authorization (a
// short-lived signed upload token for Storage; nothing at all for
// Broadcast, which is why every payload sent over it must stay content-
// free -- see chat/realtimeAdmin.ts's own comment).
let _browserClient: SupabaseClient | null = null;
export function getSupabaseBrowserClient(): SupabaseClient {
  if (_browserClient) return _browserClient;
  _browserClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
  return _browserClient;
}
