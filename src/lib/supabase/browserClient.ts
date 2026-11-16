import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Storage's public client; signed upload tokens authorize each upload.
// D3 chat uses a separate RealtimeClient and ephemeral receive token in
// realtimeBrowser.ts. Never set that token on this shared Storage client.
let _browserClient: SupabaseClient | null = null;
export function getSupabaseBrowserClient(): SupabaseClient {
  if (_browserClient) return _browserClient;
  _browserClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  );
  return _browserClient;
}
