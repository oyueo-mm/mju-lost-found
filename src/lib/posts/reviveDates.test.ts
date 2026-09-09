import { describe, expect, it } from "vitest";

import { reviveDates } from "./reviveDates";

describe("reviveDates", () => {
  it("revives createdAt/updatedAt/lostAt from ISO strings into real Date objects", () => {
    const result = reviveDates({
      type: "lost",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      lostAt: "2026-01-01T10:00:00.000Z",
    });

    expect(result.createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(result.updatedAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect((result as { lostAt: Date }).lostAt).toEqual(new Date("2026-01-01T10:00:00.000Z"));
  });

  it("revives foundAt for a found post the same way", () => {
    const result = reviveDates({
      type: "found",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      foundAt: "2026-01-01T10:00:00.000Z",
    });

    expect((result as { foundAt: Date }).foundAt).toEqual(new Date("2026-01-01T10:00:00.000Z"));
  });

  // Phase P-5: a null lostAt/foundAt (시간 미상) must survive this
  // round-trip as null, never silently become `new Date(null)`'s Unix
  // epoch (1970-01-01) -- that would fabricate a fake timestamp for a
  // post the poster explicitly marked as unknown.
  it("keeps lostAt as null (시간 미상) instead of coercing it into the Unix epoch", () => {
    const result = reviveDates({
      type: "lost",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      lostAt: null,
    });

    expect((result as { lostAt: Date | null }).lostAt).toBeNull();
  });

  it("keeps foundAt as null (시간 미상) the same way", () => {
    const result = reviveDates({
      type: "found",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      foundAt: null,
    });

    expect((result as { foundAt: Date | null }).foundAt).toBeNull();
  });
});
