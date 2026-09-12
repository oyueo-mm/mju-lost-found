import { describe, expect, it } from "vitest";

import { createTranslator } from "./translate";
import { getDictionary } from "./messages";
import { ko } from "./messages/ko";
import { LOCALES } from "./config";

describe("createTranslator", () => {
  it("returns the selected locale's string", () => {
    const t = createTranslator("en", getDictionary("en"));
    expect(t("nav.home")).toBe("Home");
  });

  it("falls back to Korean for a key the locale has not translated yet", () => {
    // 부분 사전이 이 설계의 핵심이다 -- 번역이 없는 키는 개발자용 키
    // 이름이 아니라 한국어 문장으로 떨어져야 한다(화면이 깨지지 않는다).
    const t = createTranslator("en", { "nav.home": "Home" });
    expect(t("nav.lost")).toBe(ko["nav.lost"]);
  });

  it("interpolates {name} placeholders", () => {
    const t = createTranslator("en", { "nav.unreadChat": "{count} unread chats" });
    expect(t("nav.unreadChat", { count: 3 })).toBe("3 unread chats");
  });

  it("leaves a placeholder alone when no value is supplied", () => {
    const t = createTranslator("en", { "nav.unreadChat": "{count} unread chats" });
    expect(t("nav.unreadChat")).toBe("{count} unread chats");
  });

  it("exposes the locale it was built for", () => {
    expect(createTranslator("vi", getDictionary("vi")).locale).toBe("vi");
  });
});

describe("dictionaries", () => {
  it("has a dictionary for every supported locale", () => {
    for (const locale of LOCALES) {
      expect(Object.keys(getDictionary(locale)).length).toBeGreaterThan(0);
    }
  });

  it("never introduces a key the Korean source dictionary does not define", () => {
    // 한국어 사전이 키 목록의 단일 출처다 -- 다른 언어 사전에만 있는
    // 키는 어디서도 쓰이지 않는 죽은 번역이거나 오타다.
    const koKeys = new Set(Object.keys(ko));
    for (const locale of LOCALES) {
      const extra = Object.keys(getDictionary(locale)).filter((key) => !koKeys.has(key));
      expect({ locale, extra }).toEqual({ locale, extra: [] });
    }
  });

  it("keeps every {placeholder} a translation uses present in the Korean source", () => {
    // 번역문이 한국어 원문에 없는 자리표시자를 쓰면 화면에 "{foo}"가
    // 그대로 노출된다 -- 호출부는 한국어 기준으로 값을 넘기기 때문이다.
    const placeholders = (s: string): string[] => [...(s.match(/\{(\w+)\}/g) ?? [])].sort();
    for (const locale of LOCALES) {
      // 두 사전 모두 임의 키로 인덱싱한 결과를 그냥 string으로 보고
      // 다룬다 -- 값의 리터럴 타입까지는 이 검사에 필요하지 않다.
      const entries = Object.entries(getDictionary(locale) as Record<string, string>);
      for (const [key, value] of entries) {
        const source: string | undefined = (ko as Record<string, string>)[key];
        if (source === undefined || value === undefined) continue;
        const unknown = placeholders(value).filter((p) => !placeholders(source).includes(p));
        expect({ locale, key, unknown }).toEqual({ locale, key, unknown: [] });
      }
    }
  });
});
