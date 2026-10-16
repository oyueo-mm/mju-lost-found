"use server";

import { cookies } from "next/headers";

import { PRIVACY_NOTICE_COOKIE, PRIVACY_NOTICE_COOKIE_MAX_AGE } from "@/lib/policy/privacyNotice";
import { PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/policy/privacyPolicy";

// 개인정보처리방침 변경 안내를 닫음 (components/layout/PrivacyPolicyNotice):
// remembered in a first-party cookie for the current 시행일 only, so the
// layout stops rendering that notice. Holds no account data; anything but
// the current 시행일 is ignored.
export async function dismissPrivacyNoticeAction(effective: unknown): Promise<void> {
  if (effective !== PRIVACY_POLICY_EFFECTIVE_DATE) return;
  (await cookies()).set(PRIVACY_NOTICE_COOKIE, PRIVACY_POLICY_EFFECTIVE_DATE, {
    path: "/",
    maxAge: PRIVACY_NOTICE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
}
