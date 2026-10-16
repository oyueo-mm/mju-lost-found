"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { recordMemberActivity } from "@/lib/metrics/record";

// 최근 활동 감지 (components/layout/ActivityBeacon): the signed-in member was
// active just now. recordMemberActivity decides from the row this request
// read whether anything is written (at most every few minutes and once per
// new KST hour), so calling this often costs a read, not a write. A server
// action, not a new API route: the Hobby plan's function cap is already
// used up (see next.config.ts).
export async function markActiveAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) await recordMemberActivity(user);
}
