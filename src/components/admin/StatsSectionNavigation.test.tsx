import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Section } from "./StatsBlocks";
import { activeSectionIndex } from "./StatsSectionNavigation";

describe("statistics scrollspy", () => {
  it("keeps the first section active above its heading", () => {
    expect(activeSectionIndex([300, 800, 1400], 100, false)).toBe(0);
    expect(activeSectionIndex([], 100, false)).toBe(-1);
  });

  it("keeps a long section active until the next heading reaches the reading line", () => {
    expect(activeSectionIndex([-3000, 103, 900], 100, false)).toBe(0);
    expect(activeSectionIndex([-3001, 102, 899], 100, false)).toBe(1);
    expect(activeSectionIndex([-3500, -397, 400], 100, false)).toBe(1);
    expect(activeSectionIndex([-3501, -398, 100], 100, false)).toBe(2);
  });

  it("recognizes the last short section at the bottom of the content", () => {
    expect(activeSectionIndex([-500, -100, 600], 100, true)).toBe(2);
  });

  it("registers only opted-in, rendered sections and preserves their contents", () => {
    const allowed = false;
    const html = renderToStaticMarkup(<>
      <Section id="visible" title="Visible"><span>42</span></Section>
      {allowed && <Section id="restricted" title="Restricted">private</Section>}
      <Section title="Nested chart">Chart</Section>
    </>);
    expect(html).toContain('id="visible" data-stats-section="Visible" tabindex="-1"');
    expect(html).toContain("<span>42</span>");
    expect(html).not.toContain("restricted");
    expect(html.match(/data-stats-section=/g)).toHaveLength(1);
  });
});
