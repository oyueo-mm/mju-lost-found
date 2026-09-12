import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// app_settings 는 자주 안 바뀌므로 짧게 캐시한다.
let cache = null; // { value, at }
const TTL = 30_000;

export async function getBetaOpen() {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  try {
    const { data } = await createAdminClient()
      .from("app_settings")
      .select("beta_open")
      .eq("id", 1)
      .maybeSingle();
    const value = data?.beta_open ?? true;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // 테이블 없거나 조회 실패 → 기존 동작(허용) 유지
    return cache?.value ?? true;
  }
}

export async function setBetaOpen(open, byUserId) {
  const { error } = await createAdminClient()
    .from("app_settings")
    .update({
      beta_open: !!open,
      updated_at: new Date().toISOString(),
      updated_by: byUserId || null,
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  cache = { value: !!open, at: Date.now() };
}

export function bustSettingsCache() {
  cache = null;
}
