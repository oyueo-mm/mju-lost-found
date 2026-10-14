"use server";

import { redirect } from "next/navigation";

import { auth, signOut, unstable_update } from "@/lib/auth/auth";
import { sanitizeCallbackUrl } from "@/lib/auth/callbackUrl";
import { requireReadyUser } from "@/lib/auth/session";
import { createFeedback } from "@/lib/feedback/service";
import { consentAndCollectIdentity } from "@/lib/identity/collect";
import { sourceOf } from "@/lib/identity/googleHints";
import { getOwnIdentityInfo, recordIdentityConsent, saveOwnIdentityInfo, withdrawIdentityConsent } from "@/lib/identity/service";
import { validateIdentityInput } from "@/lib/identity/validation";
import type { TranslationKey } from "@/lib/i18n/translate";

const afterSave = (formData: FormData) =>
  sanitizeCallbackUrl(String(formData.get("callbackUrl") ?? "")) ?? (formData.get("onboarding") === "1" ? "/" : "/me");

// 실명·소속 동의 (one button, no form): records the optional consent and
// collects the values from the Google display name at once. If that worked,
// back to where the member was going; otherwise the page shows what is
// possible instead (sign in again, or -- for an account whose Google name
// can't be used -- type them in).
export async function consentIdentityAction(formData: FormData): Promise<void> {
  const user = await requireReadyUser("mypost", "/me/identity");
  const result = await consentAndCollectIdentity(user.id);
  if (result !== "skipped") redirect(afterSave(formData));
  const callbackUrl = sanitizeCallbackUrl(String(formData.get("callbackUrl") ?? ""));
  redirect(callbackUrl ? `/me/identity?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/me/identity");
}

// 동의 철회: deletes the stored 실명·소속 and the consent.
export async function withdrawIdentityConsentAction(): Promise<void> {
  const user = await requireReadyUser("mypost", "/me/identity");
  await withdrawIdentityConsent(user.id);
  redirect("/me/identity");
}

// Hints come only with a sign-in, so a session from before them needs one.
export async function reloginForIdentityAction(): Promise<void> {
  await signOut({ redirectTo: "/login?callbackUrl=%2Fme%2Fidentity" });
}

export type SaveIdentityField = "realName" | "department" | "consent" | "form";
export type SaveIdentityState = { errors: Partial<Record<SaveIdentityField, TranslationKey>> } | null;

// 직접 입력 (exception path only): for an account whose Google display name
// gives no usable 실명·소속 (not a school Workspace account, or not the
// "이름/신분/소속" form). Values collected from Google are read-only and can't
// be overwritten here. Saving requires the consent checkbox, recorded with
// the values. Errors never echo or log the values themselves.
export async function saveIdentityAction(_prev: SaveIdentityState, formData: FormData): Promise<SaveIdentityState> {
  const user = await requireReadyUser("mypost", "/me/identity");

  const existing = await getOwnIdentityInfo(user.id);
  if (existing && existing.realNameSource === "google_display_name") return { errors: { form: "identity.error.readOnly" } };

  const errors: Partial<Record<SaveIdentityField, TranslationKey>> = {};
  const validation = validateIdentityInput({ realName: formData.get("realName"), department: formData.get("department") });
  if (!validation.ok) {
    if (validation.errors.realName) errors.realName = `identity.error.${validation.errors.realName}`;
    if (validation.errors.department) errors.department = `identity.error.${validation.errors.department}`;
  }
  if (formData.get("consent") !== "on") errors.consent = "identity.error.consent";
  if (!validation.ok || Object.keys(errors).length > 0) return { errors };

  // A plain Google name suggestion kept as-is is credited to Google; the
  // rest is the member's own typing.
  const hints = (await auth())?.identityHints;
  const sources = {
    realName: sourceOf(validation.value.realName, hints?.name, hints?.nameSource ?? "google_profile"),
    department: sourceOf(validation.value.department, hints?.department, hints?.departmentSource ?? "google_people"),
  };

  try {
    await recordIdentityConsent(user.id);
    await saveOwnIdentityInfo(user.id, validation.value, sources);
  } catch (error) {
    // Prisma errors can quote the submitted data -- log only what kind of
    // failure it was.
    const code = (error as { code?: unknown })?.code;
    console.error("Failed to save identity info:", error instanceof Error ? error.name : "unknown", typeof code === "string" ? code : "");
    return { errors: { form: "identity.error.failed" } };
  }

  if (hints) {
    try {
      await unstable_update({ clearIdentityHints: true } as Parameters<typeof unstable_update>[0]);
    } catch {
      // Only tidying -- the values are saved either way.
    }
  }
  redirect(afterSave(formData));
}

export type CorrectionState = { ok: true } | { error: TranslationKey } | null;

// 정정 요청: the collected values are read-only, so a member who finds them
// wrong sends a request (stored as a 문의 the admins handle). The member is
// asked to describe what is wrong without writing the values themselves.
export async function requestIdentityCorrectionAction(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const user = await requireReadyUser("mypost", "/me/identity");
  const content = String(formData.get("content") ?? "").trim();
  if (content.length < 5 || content.length > 1000) return { error: "identity.correction.invalid" };
  try {
    const result = await createFeedback(user, { category: "other", title: "[실명·소속 정정 요청]", content });
    return result.kind === "ok" ? { ok: true } : { error: "identity.correction.error" };
  } catch (error) {
    console.error("Failed to send identity correction request:", error instanceof Error ? error.name : "unknown");
    return { error: "identity.correction.error" };
  }
}
