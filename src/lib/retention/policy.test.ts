import { describe, expect, it } from "vitest";

import { evidenceReleased } from "./policy";

const now = new Date("2027-06-01T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
const processed = (d: number) => ({ status: "DISMISSED" as const, processedAt: daysAgo(d), createdAt: daysAgo(d + 3) });

describe("evidenceReleased (report evidence retention)", () => {
  it("content nobody reported is not evidence", () => {
    expect(evidenceReleased([], now)).toBe(true);
  });

  it("kept while any report on it is still pending, however old", () => {
    expect(evidenceReleased([{ status: "PENDING", processedAt: null, createdAt: daysAgo(900) }], now)).toBe(false);
    expect(evidenceReleased([processed(800), { status: "PENDING", processedAt: null, createdAt: daysAgo(2) }], now)).toBe(false);
  });

  it("kept until 1 year after the last processing", () => {
    expect(evidenceReleased([processed(364)], now)).toBe(false);
    expect(evidenceReleased([processed(365)], now)).toBe(true);
    expect(evidenceReleased([processed(500), processed(30)], now)).toBe(false);
  });

  it("an old processed report without processedAt falls back to createdAt", () => {
    expect(evidenceReleased([{ status: "ACTIONED", processedAt: null, createdAt: daysAgo(400) }], now)).toBe(true);
  });
});
