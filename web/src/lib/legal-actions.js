"use server";

import { redirect } from "next/navigation";
import { getSessionUser, isEmailPermitted, isSuspended } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";

const REQUIRED = ["age14", "terms", "privacy", "overseas"];

export async function agreeToTerms(_prev, formData) {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (!(await isEmailPermitted(session.user.email)))
    redirect("/login?error=domain");
  if (!session.profile?.nickname) redirect("/onboarding");
  if (isSuspended(session.profile)) redirect("/suspended");

  const missing = REQUIRED.filter((k) => formData.get(k) !== "on");
  if (missing.length > 0) {
    return { error: "필수 항목에 모두 동의해야 서비스를 이용할 수 있어요." };
  }

  const now = new Date().toISOString();
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({
      terms_agreed_at: now,
      privacy_agreed_at: now,
      overseas_agreed_at: now,
      terms_version: CURRENT_TERMS_VERSION,
    })
    .eq("id", session.user.id);

  redirect("/");
}
