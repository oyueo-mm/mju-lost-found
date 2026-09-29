import { describe, expect, it } from "vitest";

import {
  EMPTY_PERIOD,
  isPeriodRangeInvalid,
  periodStateToEntries,
  readPeriodState,
  withPeriodParams,
} from "./periodParams";

const params = (query: string) => new URLSearchParams(query);

describe("readPeriodState", () => {
  it("reads a preset with the unknown-time option", () => {
    expect(readPeriodState(params("period=1w&unknownTime=include"))).toEqual({
      period: "1w",
      from: "",
      to: "",
      includeUnknown: true,
    });
  });

  it("reads a custom range and ignores from/to for presets", () => {
    expect(readPeriodState(params("period=custom&from=2026-09-01&to=2026-09-15"))).toMatchObject({
      period: "custom",
      from: "2026-09-01",
      to: "2026-09-15",
    });
    expect(readPeriodState(params("period=3d&from=2026-09-01"))).toMatchObject({ period: "3d", from: "" });
  });

  it("falls back to 전체 기간 for a missing or unknown period", () => {
    expect(readPeriodState(params(""))).toEqual(EMPTY_PERIOD);
    expect(readPeriodState(params("period=forever&unknownTime=include"))).toEqual(EMPTY_PERIOD);
  });
});

describe("periodStateToEntries / withPeriodParams", () => {
  it("writes nothing for 전체 기간 (even if the unknown-time box was ticked)", () => {
    expect(periodStateToEntries({ ...EMPTY_PERIOD, includeUnknown: true })).toEqual([]);
  });

  it("writes period, custom dates and unknownTime", () => {
    expect(periodStateToEntries({ period: "custom", from: "2026-09-01", to: "2026-09-15", includeUnknown: true })).toEqual([
      ["period", "custom"],
      ["from", "2026-09-01"],
      ["to", "2026-09-15"],
      ["unknownTime", "include"],
    ]);
  });

  it("replaces only the period parameters and keeps the rest of a shared URL", () => {
    const next = withPeriodParams("q=지갑&type=found&period=1m&from=2020-01-01&page=3", {
      period: "today",
      from: "",
      to: "",
      includeUnknown: false,
    });
    expect(Object.fromEntries(new URLSearchParams(next))).toEqual({ q: "지갑", type: "found", page: "3", period: "today" });
    expect(withPeriodParams("q=a&period=3d&unknownTime=include", EMPTY_PERIOD)).toBe("q=a");
  });

  it("round-trips through the URL", () => {
    const state = { period: "custom" as const, from: "2026-09-01", to: "2026-09-15", includeUnknown: true };
    expect(readPeriodState(params(withPeriodParams("", state)))).toEqual(state);
  });
});

describe("isPeriodRangeInvalid", () => {
  it("flags only an inverted custom range", () => {
    expect(isPeriodRangeInvalid({ period: "custom", from: "2026-09-15", to: "2026-09-01", includeUnknown: false })).toBe(true);
    expect(isPeriodRangeInvalid({ period: "custom", from: "2026-09-01", to: "2026-09-01", includeUnknown: false })).toBe(false);
    expect(isPeriodRangeInvalid({ period: "custom", from: "2026-09-15", to: "", includeUnknown: false })).toBe(false);
    expect(isPeriodRangeInvalid({ period: "1w", from: "", to: "", includeUnknown: false })).toBe(false);
  });
});
