import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PostImageGallery, swipeStep, wrapIndex } from "./PostImageGallery";

const image = (id: number, isPrimary = false) => ({
  id,
  imageUrl: `https://example.supabase.co/storage/v1/object/public/post-images/found/1/${id}.webp`,
  isPrimary,
});

describe("PostImageGallery navigation", () => {
  it("wraps around in both directions", () => {
    expect(wrapIndex(3, 3)).toBe(0); // next from the last -> first
    expect(wrapIndex(-1, 3)).toBe(2); // previous from the first -> last
    expect(wrapIndex(1, 3)).toBe(1);
  });

  it("treats only a clear sideways swipe as navigation", () => {
    expect(swipeStep(-80, 10)).toBe(1); // finger moved left -> next
    expect(swipeStep(80, -10)).toBe(-1); // finger moved right -> previous
    expect(swipeStep(-20, 0)).toBe(0); // too short (a tap)
    expect(swipeStep(-60, 90)).toBe(0); // mostly vertical (page scroll)
  });
});

describe("PostImageGallery markup", () => {
  it("2+ photos: ‹ › buttons, a 1 / n badge, and the first thumbnail selected", () => {
    const markup = renderToStaticMarkup(<PostImageGallery images={[image(1, true), image(2), image(3)]} title="지갑" />);
    expect(markup).toContain('aria-label="이전 이미지"');
    expect(markup).toContain('aria-label="다음 이미지"');
    expect(markup.replace(/<!-- -->/g, "")).toContain(">1 / 3<");
    const tabs = markup.match(/role="tab"[^>]*aria-selected="(true|false)"/g) ?? [];
    expect(tabs.map((tab) => tab.endsWith('"true"'))).toEqual([true, false, false]);
  });

  it("a single photo: no arrows, no badge, no thumbnail strip", () => {
    const markup = renderToStaticMarkup(<PostImageGallery images={[image(1, true)]} title="지갑" />);
    expect(markup).not.toContain("이전 이미지");
    expect(markup).not.toContain(" / ");
    expect(markup).not.toContain('role="tablist"');
  });
});
