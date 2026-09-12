import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatAbsoluteTime, formatRelativeTime } from "./relativeTime";
import { createTranslator } from "@/lib/i18n/translate";
import { getDictionary } from "@/lib/i18n/messages";

const NOW = new Date("2026-06-15T12:00:00.000Z");

// 다국어(i18n) Phase: formatRelativeTime이 이제 번역기를 인자로 받는다 --
// 버킷 경계(1분/60분/24시간/30일/12개월)와 반올림 방식은 하나도 바뀌지
// 않았으므로, 아래 한국어 기대값은 이 Phase 이전과 글자까지 동일하다.
const ko = createTranslator("ko", getDictionary("ko"));
const en = createTranslator("en", getDictionary("en"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("formatRelativeTime", () => {
  it("방금 전 -- under a minute", () => {
    expect(formatRelativeTime(ago(30_000), ko)).toBe("방금 전");
  });

  it("N분 전 -- under an hour", () => {
    expect(formatRelativeTime(ago(3 * 60_000), ko)).toBe("3분 전");
  });

  it("N시간 전 -- under a day", () => {
    expect(formatRelativeTime(ago(2 * 60 * 60_000), ko)).toBe("2시간 전");
  });

  it("N일 전 -- under ~a month", () => {
    expect(formatRelativeTime(ago(3 * 24 * 60 * 60_000), ko)).toBe("3일 전");
  });

  it("N개월 전 -- under a year", () => {
    expect(formatRelativeTime(ago(60 * 24 * 60 * 60_000), ko)).toBe("2개월 전");
  });

  it("N년 전 -- a year or more", () => {
    expect(formatRelativeTime(ago(2 * 365 * 24 * 60 * 60_000), ko)).toBe("2년 전");
  });

  // 같은 시각이 같은 버킷으로 떨어지되 라벨만 그 언어로 나온다는 것을
  // 확인한다 -- 경계 계산이 언어에 따라 달라지지 않아야 한다.
  it("uses the selected locale's labels for the same buckets", () => {
    expect(formatRelativeTime(ago(30_000), en)).toBe("just now");
    expect(formatRelativeTime(ago(3 * 60_000), en)).toBe("3 min ago");
    expect(formatRelativeTime(ago(2 * 60 * 60_000), en)).toBe("2 h ago");
    expect(formatRelativeTime(ago(3 * 24 * 60 * 60_000), en)).toBe("3 d ago");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders a real ko-KR date/time string, not a relative label", () => {
    const result = formatAbsoluteTime(ago(3 * 24 * 60 * 60_000), "ko");
    expect(result).not.toMatch(/전$/);
    expect(result.length).toBeGreaterThan(0);
  });

  // 언어가 달라도 여전히 실제 날짜/시각 문자열이고, 한국어 결과와는
  // 다른 형식으로 나온다(같은 순간을 가리키는 것은 변하지 않는다).
  it("formats in the selected locale", () => {
    const at = ago(3 * 24 * 60 * 60_000);
    expect(formatAbsoluteTime(at, "en")).not.toBe(formatAbsoluteTime(at, "ko"));
    expect(formatAbsoluteTime(at, "en").length).toBeGreaterThan(0);
  });
});
