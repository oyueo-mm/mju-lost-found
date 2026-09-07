"use server";

import { requireUser } from "@/lib/auth/session";
import { submitSuspensionAppeal } from "@/lib/moderation/appeals";

export type SubmitAppealState = { error: string } | { ok: true };

// Same "target comes only from the server-verified session" shape every
// other self-service action in this app follows (see me/actions.ts's own
// updateNicknameAction comment) -- requireUser() supplies the id, never
// client input, so this can only ever file an appeal for the caller's own
// account.
export async function submitAppealAction(
  _prevState: SubmitAppealState | null,
  formData: FormData,
): Promise<SubmitAppealState> {
  const user = await requireUser();

  const content = String(formData.get("content") ?? "");
  const result = await submitSuspensionAppeal(user, content);

  switch (result.kind) {
    case "ok":
      return { ok: true };
    case "not_suspended":
      return { error: "현재 정지 상태가 아니어서 이의신청을 제출할 수 없습니다." };
    case "already_pending":
      return { error: "이미 제출한 이의신청이 검토 대기 중입니다." };
    case "blank_content":
      return { error: "이의신청 내용을 입력해주세요." };
    default:
      return { error: "이의신청을 제출하지 못했습니다." };
  }
}
