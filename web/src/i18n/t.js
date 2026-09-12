// 사전에서 문자열 꺼내기. 없으면 한국어 → 키 순으로 폴백.
// {name} 자리표시자는 params 로 치환.
import ko from "./dict/ko";
import en from "./dict/en";
import zh from "./dict/zh";
import vi from "./dict/vi";
import mn from "./dict/mn";
import { DEFAULT_LOCALE, isLocale } from "./locales";

export const DICTS = { ko, en, zh, vi, mn };

export function getDict(locale) {
  return DICTS[isLocale(locale) ? locale : DEFAULT_LOCALE];
}

export function makeT(locale) {
  const dict = getDict(locale);
  const fallback = DICTS[DEFAULT_LOCALE];
  return function t(key, params) {
    let s = dict[key] ?? fallback[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  };
}
