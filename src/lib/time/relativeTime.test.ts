import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatAbsoluteTime, formatRelativeTime } from "./relativeTime";

const NOW = new Date("2026-06-15T12:00:00.000Z");

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
    expect(formatRelativeTime(ago(30_000))).toBe("방금 전");
  });

  it("N분 전 -- under an hour", () => {
    expect(formatRelativeTime(ago(3 * 60_000))).toBe("3분 전");
  });

  it("N시간 전 -- under a day", () => {
    expect(formatRelativeTime(ago(2 * 60 * 60_000))).toBe("2시간 전");
  });

  it("N일 전 -- under ~a month", () => {
    expect(formatRelativeTime(ago(3 * 24 * 60 * 60_000))).toBe("3일 전");
  });

  it("N개월 전 -- under a year", () => {
    expect(formatRelativeTime(ago(60 * 24 * 60 * 60_000))).toBe("2개월 전");
  });

  it("N년 전 -- a year or more", () => {
    expect(formatRelativeTime(ago(2 * 365 * 24 * 60 * 60_000))).toBe("2년 전");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders a real ko-KR date/time string, not a relative label", () => {
    const result = formatAbsoluteTime(ago(3 * 24 * 60 * 60_000));
    expect(result).not.toMatch(/전$/);
    expect(result.length).toBeGreaterThan(0);
  });
});
