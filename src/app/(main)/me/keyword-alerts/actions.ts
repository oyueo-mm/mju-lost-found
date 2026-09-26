"use server";

import { revalidatePath } from "next/cache";

import { requireReadyUser } from "@/lib/auth/session";
import { createKeywordAlert, deleteKeywordAlert, updateKeywordAlert } from "@/lib/keywordAlert/service";
import { createKeywordAlertSchema, updateKeywordAlertSchema } from "@/lib/keywordAlert/schema";

export type KeywordAlertActionState = { error: string } | { ok: true };

// requireReadyUser() -- logged in and nickname set, re-verified fresh on
// every call, same "never trust anything client-side" rule every other
// Server Action in this app follows (see feedback/actions.ts's own
// comment). Suspension is deliberately NOT checked here (unlike
// requireActiveUser()) -- managing your own notification-rule settings
// isn't a content-posting action, so a suspended user can still edit/
// delete their own alerts (they just won't be creating new posts that
// might match anyone else's).
export async function createKeywordAlertAction(input: {
  keyword: string;
  postType: string;
  campuses: string[];
  categories: string[];
  excludeKeywords: string[];
}): Promise<KeywordAlertActionState> {
  const user = await requireReadyUser("mypost", "/me/keyword-alerts");

  const parsed = createKeywordAlertSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await createKeywordAlert(user, parsed.data);
  if (result.kind === "too_many") return { error: "키워드 알림은 최대 20개까지 만들 수 있어요." };
  if (result.kind !== "ok") return { error: "키워드 알림을 추가하지 못했습니다." };

  revalidatePath("/me/keyword-alerts");
  return { ok: true };
}

export async function updateKeywordAlertAction(
  id: number,
  input: { keyword: string; postType: string; campuses: string[]; categories: string[]; excludeKeywords: string[] },
): Promise<KeywordAlertActionState> {
  const user = await requireReadyUser("mypost", "/me/keyword-alerts");

  const parsed = updateKeywordAlertSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await updateKeywordAlert(user, id, parsed.data);
  if (result.kind === "not_found") return { error: "키워드 알림을 찾을 수 없습니다." };
  if (result.kind === "forbidden") return { error: "본인의 키워드 알림만 수정할 수 있습니다." };
  if (result.kind !== "ok") return { error: "키워드 알림을 수정하지 못했습니다." };

  revalidatePath("/me/keyword-alerts");
  return { ok: true };
}

export async function deleteKeywordAlertAction(id: number): Promise<KeywordAlertActionState> {
  const user = await requireReadyUser("mypost", "/me/keyword-alerts");

  const result = await deleteKeywordAlert(user, id);
  if (result.kind === "not_found") return { error: "키워드 알림을 찾을 수 없습니다." };
  if (result.kind === "forbidden") return { error: "본인의 키워드 알림만 삭제할 수 있습니다." };
  if (result.kind !== "ok") return { error: "키워드 알림을 삭제하지 못했습니다." };

  revalidatePath("/me/keyword-alerts");
  return { ok: true };
}
