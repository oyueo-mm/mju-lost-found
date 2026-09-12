import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, LOCALES, isLocale, parseAcceptLanguage, resolveLocale } from "./config";

describe("isLocale", () => {
  it("accepts every supported locale and nothing else", () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
    expect(isLocale("ja")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe("parseAcceptLanguage", () => {
  it("returns null when the header is missing or empty", () => {
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage(undefined)).toBeNull();
    expect(parseAcceptLanguage("")).toBeNull();
  });

  it("matches on the base language subtag, ignoring region/script", () => {
    expect(parseAcceptLanguage("zh-CN")).toBe("zh");
    expect(parseAcceptLanguage("zh-Hans-CN")).toBe("zh");
    expect(parseAcceptLanguage("en-GB")).toBe("en");
    expect(parseAcceptLanguage("mn-Cyrl-MN")).toBe("mn");
  });

  it("honors q-values rather than header order", () => {
    expect(parseAcceptLanguage("en;q=0.3,vi;q=0.9")).toBe("vi");
    expect(parseAcceptLanguage("vi;q=0.2,en;q=0.8")).toBe("en");
  });

  it("skips unsupported languages and falls through to a supported one", () => {
    expect(parseAcceptLanguage("ja,fr;q=0.9,ko;q=0.5")).toBe("ko");
  });

  it("returns null when nothing in the header is supported", () => {
    expect(parseAcceptLanguage("ja,fr;q=0.9,de;q=0.5")).toBeNull();
  });

  it("ignores entries explicitly refused with q=0", () => {
    expect(parseAcceptLanguage("en;q=0,vi;q=0.4")).toBe("vi");
  });
});

describe("resolveLocale", () => {
  // 이번 작업이 요구한 우선순위:
  //   1/2. 사용자가 고른(=쿠키에 저장된) 언어
  //   3.   브라우저 언어(Accept-Language)
  //   4.   한국어
  it("prefers the saved cookie over the browser language", () => {
    expect(resolveLocale("mn", "en-US,en;q=0.9")).toBe("mn");
  });

  it("falls back to the browser language when there is no cookie", () => {
    expect(resolveLocale(undefined, "vi-VN,vi;q=0.9")).toBe("vi");
  });

  it("ignores an unrecognized cookie value and uses the browser language", () => {
    expect(resolveLocale("klingon", "zh-CN")).toBe("zh");
  });

  it("falls back to Korean when neither signal is usable", () => {
    expect(resolveLocale(undefined, undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, "ja,de;q=0.8")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("", null)).toBe(DEFAULT_LOCALE);
  });
});
