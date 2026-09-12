// 지원 언어. 명지대 유학생 비중 순 — 한국어(기본) · 영어 · 중국어(간체) · 베트남어 · 몽골어.
export const LOCALES = ["ko", "en", "zh", "vi", "mn"];
export const DEFAULT_LOCALE = "ko";
export const LOCALE_COOKIE = "locale";

export const LOCALE_LABEL = {
  ko: "한국어",
  en: "English",
  zh: "中文",
  vi: "Tiếng Việt",
  mn: "Монгол",
};

// <html lang> 값
export const HTML_LANG = {
  ko: "ko",
  en: "en",
  zh: "zh-Hans",
  vi: "vi",
  mn: "mn",
};

export function isLocale(v) {
  return LOCALES.includes(v);
}
