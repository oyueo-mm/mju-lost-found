"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { validateNickname } from "@/lib/auth/nickname";
import { prisma } from "@/lib/db/prisma";

export type SetNicknameState = { error: string } | null;

// The nickname a user submits is only ever applied to *their own* session
// user (requireUser() reads the id from the server-verified session, never
// from the form), and only when nickname is still NULL -- mirrors the
// legacy db.set_initial_nickname()'s atomic "only if still unset" UPDATE.
// Phase H-7: no longer needs to catch a P2002 duplicate-nickname error here
// -- User.nickname's old @unique constraint is gone (duplicates are
// allowed by design now, see nickname.ts's own comment), so this write can
// no longer fail on uniqueness. A later, deliberate nickname *change* (any
// number of times, once set) is me/actions.ts's updateNicknameAction, not
// this function -- this one is onboarding-only, exactly once.
export async function setNicknameAction(
  _prevState: SetNicknameState,
  formData: FormData,
): Promise<SetNicknameState> {
  const user = await requireUser();

  if (user.nickname !== null) {
    redirect("/");
  }

  const validation = validateNickname(String(formData.get("nickname") ?? ""));
  if (!validation.ok) {
    return { error: validation.error };
  }

  const { count } = await prisma.user.updateMany({
    where: { id: user.id, nickname: null },
    data: { nickname: validation.value },
  });
  if (count === 0) {
    // Lost a race with itself (double submit) or nickname was already set
    // between the check above and this write -- either way, done.
    redirect("/");
  }

  redirect("/");
}
