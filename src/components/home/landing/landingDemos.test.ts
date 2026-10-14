import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 랜딩 애니메이션 guards: the demo motion must stay behind
// prefers-reduced-motion, must never hide content outside a pending reveal,
// and every demo-* class a landing component uses must exist in the CSS.
const root = join(__dirname, "../../../..");
const DEMO_FILES = [
  "AiSearchShowcase.tsx",
  "ImageSearchShowcase.tsx",
  "FeatureGrid.tsx",
  "RegisterShowcase.tsx",
  "AfterPostingShowcase.tsx",
];
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const start = css.indexOf("/* Landing demos");
const demoCss = css.slice(start);

// Top-level blocks of the demo section: [selector-or-at-rule, body].
function topLevelBlocks(source: string): { head: string; body: string }[] {
  const blocks: { head: string; body: string }[] = [];
  let depth = 0;
  let headStart = 0;
  let bodyStart = 0;
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        blocks.push({ head: text.slice(headStart, bodyStart - 1).trim(), body: text.slice(bodyStart, i) });
        headStart = i + 1;
      }
    }
  }
  return blocks;
}

describe("landing demo CSS", () => {
  const blocks = topLevelBlocks(demoCss);

  it("puts every demo animation and hidden start state inside prefers-reduced-motion: no-preference", () => {
    expect(start).toBeGreaterThan(0);
    for (const { head, body } of blocks) {
      if (head.startsWith("@keyframes")) continue;
      if (head.startsWith("@media (prefers-reduced-motion: no-preference)")) continue;
      // Outside the media query only "stays invisible" decoration is allowed.
      expect(head).toMatch(/^\.demo-(progress|scan|ring|out)\b/);
      expect(body.trim()).toBe("opacity: 0;");
    }
  });

  it("only hides content while its demo is waiting to play, and only animates while playing", () => {
    expect(demoCss).not.toContain("[data-reveal");
    const media = blocks.filter((b) => b.head.startsWith("@media (prefers-reduced-motion: no-preference)"));
    expect(media.length).toBeGreaterThan(0);
    for (const { body: mediaBody } of media) {
      for (const { head, body } of topLevelBlocks(mediaBody)) {
        if (/opacity:\s*0|clip-path/.test(body) && !/animation/.test(body)) {
          expect(head).toMatch(/^\[data-demo="ready"\]/);
        }
        if (/animation/.test(body)) {
          expect(head).toMatch(/^\[data-demo="play"\]/);
          expect(body).toMatch(/ backwards;/);
        }
      }
    }
  });

  it("defines every demo-* class the landing components use", () => {
    const dir = join(root, "src/components/home/landing");
    const used = new Set<string>();
    for (const file of DEMO_FILES) {
      for (const match of readFileSync(join(dir, file), "utf8").matchAll(/\bdemo-[a-z-]+/g)) used.add(match[0]);
    }
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(demoCss).toContain(`.${name}`);
  });

  // Every component with demo parts runs them through DemoPlayer (which
  // sets data-demo); demo classes outside one would never play.
  it("wraps every demo in a DemoPlayer", () => {
    const dir = join(root, "src/components/home/landing");
    for (const file of DEMO_FILES) {
      expect(readFileSync(join(dir, file), "utf8"), file).toContain("<DemoPlayer");
    }
  });
});
