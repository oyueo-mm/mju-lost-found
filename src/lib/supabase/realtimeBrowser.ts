"use client";
import { RealtimeClient } from "@supabase/realtime-js";
// Ephemeral per-room transport. Never shares Storage/Auth state or secrets.
export function createChatRealtimeClient(): RealtimeClient {
  return new RealtimeClient(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1`, {
    params: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
    heartbeatIntervalMs: 25000,
    reconnectAfterMs: attempts=>Math.min(30000,5000*2**Math.min(attempts-1,3)),
  });
}
