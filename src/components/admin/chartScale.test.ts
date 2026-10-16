import { describe, expect, it } from "vitest";

import { formatTick, labelEvery, niceRange, niceScale } from "./chartScale";

describe("niceScale", () => {
  it("gives every integer a tick for small counts", () => {
    expect(niceScale(1).ticks).toEqual([0, 1]);
    expect(niceScale(2).ticks).toEqual([0, 1, 2]);
    expect(niceScale(3).ticks).toEqual([0, 1, 2, 3]);
    expect(niceScale(5).ticks).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("frames all-zero or unmeasured data as 0-1", () => {
    expect(niceScale(0)).toMatchObject({ top: 1, ticks: [0, 1] });
  });

  it("steps by 1-2-5 with at most 5 intervals, top at or above the max", () => {
    expect(niceScale(7).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale(12).ticks).toEqual([0, 5, 10, 15]);
    expect(niceScale(50).ticks).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceScale(51).ticks).toEqual([0, 20, 40, 60]);
    expect(niceScale(1234).ticks).toEqual([0, 500, 1000, 1500]);
    for (const max of [6, 9, 17, 99, 101, 4321, 98765]) {
      const { ticks, top } = niceScale(max);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(ticks.length - 1).toBeLessThanOrEqual(5);
      expect(ticks.every(Number.isInteger)).toBe(true);
    }
  });

  it("allows fractional steps for averages", () => {
    expect(niceScale(1.5, { integer: false })).toMatchObject({ ticks: [0, 0.5, 1, 1.5], decimals: 1 });
    expect(niceScale(0.3, { integer: false }).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });
});

describe("niceRange", () => {
  it("fits a level's own span", () => {
    expect(niceRange(19, 23)).toMatchObject({ bottom: 19, top: 23, ticks: [19, 20, 21, 22, 23] });
    expect(niceRange(120, 180).ticks).toEqual([120, 140, 160, 180]);
  });

  it("falls back to a 0 baseline near 0 or for a flat line", () => {
    expect(niceRange(0, 5).bottom).toBe(0);
    expect(niceRange(2, 40).bottom).toBe(0);
    expect(niceRange(1, 4).bottom).toBe(0);
    expect(niceRange(12, 21).bottom).toBe(12);
    expect(niceRange(23, 23).bottom).toBe(0);
  });
});

describe("formatTick", () => {
  it("groups thousands and switches to 만 from 10,000", () => {
    expect(formatTick(1500)).toBe("1,500");
    expect(formatTick(12000)).toBe("1.2만");
    expect(formatTick(0.5, 1)).toBe("0.5");
  });
});

describe("labelEvery", () => {
  it("thins x labels to about seven", () => {
    expect(labelEvery(7)).toBe(1);
    expect(labelEvery(31)).toBe(5);
  });
});
