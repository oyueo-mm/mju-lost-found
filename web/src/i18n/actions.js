"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "./locales";

// 언어 선택 → 쿠키 1년. 호출한 쪽에서 router.refresh().
export async function setLocale(locale) {
  if (!isLocale(locale)) return { error: "bad locale" };
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return { ok: true };
}
