import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./locales";
import { makeT } from "./t";

// 서버 컴포넌트·서버 액션에서 현재 언어
export async function getLocale() {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export async function getT() {
  return makeT(await getLocale());
}
