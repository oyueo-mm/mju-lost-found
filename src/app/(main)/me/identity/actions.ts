"use server";

import { redirect } from "next/navigation";

import { auth, unstable_update } from "@/lib/auth/auth";
import { sanitizeCallbackUrl } from "@/lib/auth/callbackUrl";
import { requireReadyUser } from "@/lib/auth/session";
import { sourceOf } from "@/lib/identity/googleHints";
import { saveOwnIdentityInfo } from "@/lib/identity/service";
import { validateIdentityInput } from "@/lib/identity/validation";
import type { TranslationKey } from "@/lib/i18n/translate";

export type SaveIdentityField = "realName" | "department" | "consent" | "form";
export type SaveIdentityState = { errors: Partial<Record<SaveIdentityField, TranslationKey>> } | null;

// 실명·학과 저장. The member's own values only (the session user). Saving
// requires the form's 실명·학과 수집·이용 동의 checkbox, which is recorded
// with the values -- this is the only place a Google-suggested name or
// department is ever written to the DB. Errors never echo or log the
// values themselves.
export async function saveIdentityAction(_prev: SaveIdentityState, formData: FormData): Promise<SaveIdentityState> {
  const user = await requireReadyUser("mypost", "/me/identity");

  const errors: Partial<Record<SaveIdentityField, TranslationKey>> = {};
  const validation = validateIdentityInput({ realName: formData.get("realName"), department: formData.get("department") });
  if (!validation.ok) {
    if (validation.errors.realName) errors.realName = `identity.error.${validation.errors.realName}`;
    if (validation.errors.department) errors.department = `identity.error.${validation.errors.department}`;
  }
  if (formData.get("consent") !== "on") errors.consent = "identity.error.consent";
  if (!validation.ok || Object.keys(errors).length > 0) return { errors };

  // Kept as suggested by Google, or the member's own typing/edit.
  const hints = (await auth())?.identityHints;
  const sources = {
    realName: sourceOf(validation.value.realName, hints?.name, hints?.nameSource ?? "google_profile"),
    department: sourceOf(validation.value.department, hints?.department, hints?.departmentSource ?? "google_people"),
  };

  try {
    await saveOwnIdentityInfo(user.id, validation.value, sources);
  } catch (error) {
    // Prisma errors can quote the submitted data -- log only what kind of
    // failure it was.
    const code = (error as { code?: unknown })?.code;
    console.error("Failed to save identity info:", error instanceof Error ? error.name : "unknown", typeof code === "string" ? code : "");
    return { errors: { form: "identity.error.failed" } };
  }

  // The suggestions have done their job; drop them from the session cookie.
  if (hints) {
    try {
      await unstable_update({ clearIdentityHints: true } as Parameters<typeof unstable_update>[0]);
    } catch {
      // Only tidying -- the values are saved either way.
    }
  }

  const callbackUrl = sanitizeCallbackUrl(String(formData.get("callbackUrl") ?? ""));
  redirect(callbackUrl ?? (formData.get("onboarding") === "1" ? "/" : "/me"));
}
