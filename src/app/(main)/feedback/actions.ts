"use server";

import { revalidatePath } from "next/cache";

import { requireActiveUser } from "@/lib/auth/session";
import { createFeedback } from "@/lib/feedback/service";
import { createFeedbackSchema } from "@/lib/feedback/schema";

export type CreateFeedbackState = { error: string } | { ok: true };

// requireActiveUser() -- logged in, nickname set, not currently suspended
// -- re-verified fresh from the DB on every call, same "never trust
// anything client-side" rule every other Server Action in this app
// follows (see admin/announcements/actions.ts's own comment). Google 로그인
// 사용자만 제출 가능하다는 이번 Phase 스펙은 이 한 줄로 충족된다: 비로그인
// 요청은 requireActiveUser() 안에서 /login으로 즉시 redirect되고, 이 함수
// 본문까지 도달하지 않는다.
export async function createFeedbackAction(input: {
  category: string;
  title: string;
  content: string;
}): Promise<CreateFeedbackState> {
  const user = await requireActiveUser();

  const parsed = createFeedbackSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await createFeedback(user, parsed.data);
  if (result.kind !== "ok") return { error: "의견을 등록하지 못했습니다." };

  revalidatePath("/feedback");
  return { ok: true };
}
