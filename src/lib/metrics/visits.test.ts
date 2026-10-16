import { describe, expect, it } from "vitest";

import { isBotUserAgent, pageKindOf, refSourceOf, sanitizeUtm } from "./visits";
import { deviceOf } from "./visits";

describe("방문 통계: what a page view is reduced to", () => {
  it("maps paths to page kinds without ids, and leaves admin pages out", () => {
    expect(pageKindOf("/")).toBe("home");
    expect(pageKindOf("/lost")).toBe("lost");
    expect(pageKindOf("/found/")).toBe("found");
    expect(pageKindOf("/search")).toBe("search");
    expect(pageKindOf("/post/123")).toBe("post");
    expect(pageKindOf("/post/123/edit")).toBe("write");
    expect(pageKindOf("/lost/new")).toBe("write");
    expect(pageKindOf("/chat/55")).toBe("chat");
    expect(pageKindOf("/me/identity")).toBe("me");
    expect(pageKindOf("/profile/9f40fa95")).toBe("profile");
    expect(pageKindOf("/policy/privacy")).toBe("policy");
    expect(pageKindOf("/privacy-consent")).toBe("onboarding");
    expect(pageKindOf("/something-new")).toBe("other");
    expect(pageKindOf("/admin")).toBeNull();
    expect(pageKindOf("/admin/stats")).toBeNull();
  });

  it("reduces a referrer to a fixed category, never the URL", () => {
    const own = "mju-find.vercel.app";
    expect(refSourceOf("", own)).toBe("direct");
    expect(refSourceOf("https://mju-find.vercel.app/lost?q=x", own)).toBe("internal");
    expect(refSourceOf("https://everytime.kr/123/v/456", own)).toBe("everytime");
    expect(refSourceOf("https://m.everytime.kr/", own)).toBe("everytime");
    expect(refSourceOf("https://www.google.co.kr/", own)).toBe("google");
    expect(refSourceOf("https://m.search.naver.com/search.naver?query=x", own)).toBe("naver");
    expect(refSourceOf("https://l.instagram.com/?u=x", own)).toBe("instagram");
    expect(refSourceOf("https://t.co/abc", own)).toBe("x");
    expect(refSourceOf("https://www.mju.ac.kr/", own)).toBe("mju");
    expect(refSourceOf("https://evil.example/everytime.kr", own)).toBe("other");
    expect(refSourceOf("not a url", own)).toBe("other");
  });

  it("keeps only plain UTM values", () => {
    expect(sanitizeUtm("Everytime")).toBe("everytime");
    expect(sanitizeUtm(" launch_2026-10 ")).toBe("launch_2026-10");
    expect(sanitizeUtm("에브리타임")).toBeNull();
    expect(sanitizeUtm("a b")).toBeNull();
    expect(sanitizeUtm("x".repeat(33))).toBeNull();
    expect(sanitizeUtm(null)).toBeNull();
  });

  it("treats crawlers, headless browsers and a missing user agent as bots", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0 Safari/537.36")).toBe(true);
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });
});

describe("접속 기기 분류", () => {
  const UA = {
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    android: "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    ipadOld: "Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    tv: "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/76.0 TV Safari/537.36",
  };
  it("tells phones, tablets and PCs apart from the User-Agent and hints", () => {
    expect(deviceOf(UA.iphone)).toBe("mobile");
    expect(deviceOf(UA.android, "?1")).toBe("mobile");
    expect(deviceOf(UA.androidTablet, "?0")).toBe("tablet");
    expect(deviceOf(UA.ipadOld)).toBe("tablet");
    expect(deviceOf(UA.mac, null, true)).toBe("tablet"); // iPadOS Safari
    expect(deviceOf(UA.mac, null, false)).toBe("pc");
    expect(deviceOf(UA.windows, "?0", true)).toBe("pc"); // touch laptop: can't tell, counted as PC
    expect(deviceOf(UA.chromebook)).toBe("pc");
    expect(deviceOf(UA.windows, "?1")).toBe("mobile"); // the client hint wins over a desktop-looking UA
  });
  it("leaves the unknown as 기타·미확인", () => {
    expect(deviceOf(UA.tv)).toBe("other");
    expect(deviceOf("")).toBe("other");
    expect(deviceOf(null)).toBe("other");
    expect(deviceOf("SomeApp/1.0")).toBe("other");
  });
});

