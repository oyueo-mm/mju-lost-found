import { describe, expect, it } from "vitest";

import { clearDraft, draftKey, DRAFT_TTL_MS, readDraft, sweepDrafts, writeDraft, type PostDraft } from "./postDraft";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const NOW = 1_800_000_000_000;
const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  savedAt: NOW,
  title: "검정 에어팟 케이스",
  description: "",
  categoryCode: "earphones",
  subcategory: "earphones.airpods",
  campus: "인문캠퍼스",
  location: "",
  locationUnknown: true,
  date: "2026-10-15",
  time: "12:00",
  dateUnknown: true,
  exactTime: false,
  organizationId: null,
  photoCount: 2,
  ...over,
});

describe("post drafts", () => {
  it("keeps lost and found drafts, and each account's, apart", () => {
    expect(draftKey(7, "lost")).not.toBe(draftKey(7, "found"));
    expect(draftKey(7, "lost")).not.toBe(draftKey(8, "lost"));
  });

  it("saves and restores a draft", () => {
    const s = memoryStorage();
    expect(writeDraft(s, draftKey(7, "found"), draft())).toBe(true);
    expect(readDraft(s, draftKey(7, "found"), NOW + 1000)).toEqual(draft());
  });

  it("stores no photos, only how many there were", () => {
    const s = memoryStorage();
    writeDraft(s, draftKey(7, "found"), draft());
    expect(JSON.parse(s.map.get(draftKey(7, "found"))!)).toMatchObject({ photoCount: 2 });
    expect(s.map.get(draftKey(7, "found"))).not.toMatch(/blob:|data:|base64/);
  });

  it("does not keep a draft with nothing written in it", () => {
    const s = memoryStorage();
    writeDraft(s, draftKey(7, "found"), draft());
    expect(writeDraft(s, draftKey(7, "found"), draft({ title: " ", description: "" }))).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it("drops an expired or malformed draft", () => {
    const s = memoryStorage();
    writeDraft(s, draftKey(7, "found"), draft());
    expect(readDraft(s, draftKey(7, "found"), NOW + DRAFT_TTL_MS + 1)).toBeNull();
    expect(s.map.size).toBe(0);
    s.setItem(draftKey(7, "lost"), "{not json");
    expect(readDraft(s, draftKey(7, "lost"), NOW)).toBeNull();
    s.setItem(draftKey(7, "lost"), JSON.stringify({ savedAt: NOW, title: 3 }));
    expect(readDraft(s, draftKey(7, "lost"), NOW)).toBeNull();
  });

  it("clears on request", () => {
    const s = memoryStorage();
    writeDraft(s, draftKey(7, "found"), draft());
    clearDraft(s, draftKey(7, "found"));
    expect(s.map.size).toBe(0);
  });

  it("signed out removes every draft; another account removes the previous one's", () => {
    const s = memoryStorage();
    writeDraft(s, draftKey(7, "found"), draft());
    writeDraft(s, draftKey(8, "lost"), draft());
    s.setItem("unrelated", "kept");
    sweepDrafts(s, 8, NOW);
    expect([...s.map.keys()].sort()).toEqual([draftKey(8, "lost"), "unrelated"].sort());
    sweepDrafts(s, null, NOW);
    expect([...s.map.keys()]).toEqual(["unrelated"]);
  });

  it("never throws when storage is unavailable or full", () => {
    const broken = { ...memoryStorage(), getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(readDraft(broken, "k", NOW)).toBeNull();
    expect(writeDraft(broken, "k", draft())).toBe(false);
    expect(readDraft(null, "k", NOW)).toBeNull();
    expect(() => sweepDrafts(null, null)).not.toThrow();
  });
});
