"use server";

import { requireUser } from "@/lib/auth/session";
import { validateNickname } from "@/lib/auth/nickname";
import { prisma } from "@/lib/db/prisma";

export type UpdateNicknameState = { error: string } | { ok: true; nickname: string };

// Phase H-7: unlike onboarding/actions.ts's setNicknameAction (which only
// ever writes once, while nickname is still NULL), this allows changing an
// already-set nickname any number of times -- the spec now allows
// duplicate nicknames (User.nickname's UNIQUE constraint was dropped in
// this phase's migration), so there is no longer a uniqueness race to
// guard against here.
//
// "서버에서 반드시 본인 계정인지 검증": requireUser() reads the target user's id
// from the server-verified session, never from client input (formData
// carries only the new nickname text) -- the update's `where: { id:
// user.id }` can therefore only ever target the caller's own row, by
// construction, not by an extra runtime check.
export async function updateNicknameAction(
  _prevState: UpdateNicknameState | null,
  formData: FormData,
): Promise<UpdateNicknameState> {
  const user = await requireUser();

  const validation = validateNickname(String(formData.get("nickname") ?? ""));
  if (!validation.ok) {
    return { error: validation.error };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { nickname: validation.value },
  });

  return { ok: true, nickname: validation.value };
}
