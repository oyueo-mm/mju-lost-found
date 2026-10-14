"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { recordActiveDay } from "@/lib/metrics/record";

// 운영 통계 활성 이용자: marks today (KST) as an active day for the signed-in
// member -- an HMAC of the id, one row per member per day (see
// lib/metrics/record.ts). A server action, not a new API route: the Hobby
// plan's function cap is already used up (see next.config.ts).
export async function markActiveTodayAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await recordActiveDay(user.id);
}
