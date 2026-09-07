"use server";

import { requireUser } from "@/lib/auth/session";
import { NICKNAME_CHANGE_COOLDOWN_DAYS, validateNickname } from "@/lib/auth/nickname";
import { prisma } from "@/lib/db/prisma";

export type UpdateNicknameState =
  | { error: string }
  | { ok: true; nickname: string }
  // Phase I: cooldown still active -- not an error banner, this state
  // lets NicknameSettings show "다음 변경 가능 시각"/남은 시간 instead of a
  // generic failure message.
  | { onCooldown: true; availableAt: Date };

// Phase H-7: unlike onboarding/actions.ts's setNicknameAction (which only
// ever writes once, while nickname is still NULL), this allows changing an
// already-set nickname any number of times -- the spec now allows
// duplicate nicknames (User.nickname's UNIQUE constraint was dropped in
// this phase's migration), so there is no longer a uniqueness race to
// guard against here.
//
// Phase I section 7: now also gated by a cooldown -- nicknameChangeAvailableAt
// is read fresh from the DB (not trusted from any client-supplied prop),
// so a request sent while the cooldown UI happens to be stale still gets
// rejected server-side. Every successful change stamps the *next* allowed
// instant directly (see schema.prisma's own comment on why this column
// stores that instead of a "last changed at" timestamp).
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

  if (user.nicknameChangeAvailableAt && user.nicknameChangeAvailableAt.getTime() > Date.now()) {
    return { onCooldown: true, availableAt: user.nicknameChangeAvailableAt };
  }

  const validation = validateNickname(String(formData.get("nickname") ?? ""));
  if (!validation.ok) {
    return { error: validation.error };
  }

  const nextAvailableAt = new Date(Date.now() + NICKNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: user.id },
    data: { nickname: validation.value, nicknameChangeAvailableAt: nextAvailableAt },
  });

  return { ok: true, nickname: validation.value };
}
