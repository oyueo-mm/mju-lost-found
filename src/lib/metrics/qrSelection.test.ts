import { describe, expect, it } from "vitest";
import { QR_REGISTRY } from "./qrRegistry";
import { currentQrEntries, EMPTY_QR_SELECTION, resolveQrSelection } from "./qrSelection";

const base = QR_REGISTRY[0];
const fixture = [
  ...QR_REGISTRY,
  { ...base, qr_id: "nature", campus_code: "n", campus_name: "자연캠퍼스", building_code: "science", building_name: "테스트 과학관", url: "https://example.test/nature" },
  { ...base, qr_id: "board", placement_code: "board01", placement_name: "테스트 게시판", url: "https://example.test/board" },
];
describe("registered QR cascading selection", () => {
  it("derives campuses, buildings, placements and purposes from registry rows", () => {
    const h = resolveQrSelection(fixture, EMPTY_QR_SELECTION, "2026-11");
    expect(h.campuses.map((o) => o.label)).toEqual(["인문캠퍼스", "자연캠퍼스"]);
    expect(h.buildings).toHaveLength(8);
    expect(h.placements.map((o) => o.value)).toEqual(["guard", "board01"]);
    expect(h.purposes.map((o) => o.value)).toEqual(["find", "reg"]);
    const n = resolveQrSelection(fixture, { ...h.selection, campus: "n" }, "2026-11");
    expect(n.buildings.map((o) => o.value)).toEqual(["science"]);
    expect(n.placements.map((o) => o.value)).toEqual(["guard"]);
    expect(n.visibleEntries.map((e) => e.qr_id)).toEqual(["nature"]);
  });

  it("repairs invalid descendants atomically and never returns an absent combination", () => {
    const state = resolveQrSelection(fixture, { campus: "n", building: "jonghap", placement: "board01", purpose: "reg" }, "2026-11");
    expect(state.selection).toEqual({ campus: "n", building: "science", placement: "guard", purpose: "all" });
    expect(state.visibleEntries.every((e) => e.campus_code === "n" && e.building_code === "science" && e.placement_code === "guard")).toBe(true);
  });

  it("shows all purposes by default, one purpose on request, and preserves full-place batch scope", () => {
    const all = resolveQrSelection(QR_REGISTRY, EMPTY_QR_SELECTION, "2026-11");
    expect(all.visibleEntries.map((e) => e.purpose)).toEqual(["find", "reg"]);
    const reg = resolveQrSelection(QR_REGISTRY, { ...all.selection, purpose: "reg" }, "2026-11");
    expect(reg.visibleEntries).toHaveLength(1);
    expect(reg.visibleEntries[0].purpose).toBe("reg");
    expect(reg.placeEntries).toHaveLength(2);
  });

  it("uses the latest ready/installed campaign per purpose up to the current KST month", () => {
    const old = { ...base, qr_id: "old", utm_campaign: "poster_2026_10" };
    const future = { ...base, qr_id: "future", utm_campaign: "poster_2026_12" };
    const retired = { ...base, qr_id: "retired", utm_campaign: "poster_2026_11", status: "retired" };
    expect(currentQrEntries([old, future, retired, base], "2026-11")).toEqual([base]);
    expect(currentQrEntries([future], "2026-11")).toEqual([]);
    expect(currentQrEntries([old, future], "2026-10")).toEqual([old]);
  });

  it("handles empty registries without synthetic options and leaves all registered URLs unchanged", () => {
    expect(resolveQrSelection([], EMPTY_QR_SELECTION, "2026-11").visibleEntries).toEqual([]);
    const original = JSON.stringify(QR_REGISTRY);
    for (const entry of QR_REGISTRY) resolveQrSelection(QR_REGISTRY, { campus: entry.campus_code, building: entry.building_code, placement: entry.placement_code, purpose: entry.purpose }, "2026-11");
    expect(JSON.stringify(QR_REGISTRY)).toBe(original);
  });
});
