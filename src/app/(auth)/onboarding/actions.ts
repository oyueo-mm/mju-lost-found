"use server";

import { redirect } from "next/navigation";

import { hasRequiredConsents, requireUser } from "@/lib/auth/session";
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
// 이용약관 동의 Phase: closes the gap this phase's own analysis found --
// before this, this action only re-checked "nickname still null", relying
// entirely on the onboarding *page*'s redirect (privacy-consent first) to
// keep a not-yet-consented visitor from ever reaching this form. A direct
// call to this Server Action (bypassing the page's own render/redirect)
// had no such check of its own. requireReadyUser() itself can't be reused
// here -- its own nickname===null check would send this exact caller back
// to /onboarding, which is exactly the page this action is *for* -- so
// this re-implements just the consent half of that gate, matching
// onboarding/page.tsx's own identical check byte-for-byte.
export async function setNicknameAction(
  _prevState: SetNicknameState,
  formData: FormData,
): Promise<SetNicknameState> {
  const user = await requireUser();

  if (!hasRequiredConsents(user)) {
    redirect("/privacy-consent?callbackUrl=%2Fonboarding");
  }

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
