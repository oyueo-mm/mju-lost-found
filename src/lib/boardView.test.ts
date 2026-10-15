import { describe, expect, it } from "vitest";

import { BOARD_VIEW_STORAGE_KEY, boardViewInitScript, isBoardView } from "./boardView";

// Runs the pre-paint script against a fake document/localStorage.
function runInit(stored: string | null, throws = false): string | null {
  let attr: string | null = null;
  const document = { documentElement: { setAttribute: (_: string, v: string) => (attr = v) } };
  const localStorage = {
    getItem: (key: string) => {
      if (throws) throw new Error("blocked");
      return key === BOARD_VIEW_STORAGE_KEY ? stored : null;
    },
  };
  new Function("document", "localStorage", boardViewInitScript())(document, localStorage);
  return attr;
}

describe("board view", () => {
  it("accepts only grid and list", () => {
    expect(isBoardView("grid")).toBe(true);
    expect(isBoardView("list")).toBe(true);
    expect(isBoardView("masonry")).toBe(false);
    expect(isBoardView(null)).toBe(false);
  });

  it("applies a saved view before first paint and ignores anything else", () => {
    expect(runInit("list")).toBe("list");
    expect(runInit("grid")).toBe("grid");
    expect(runInit("<script>")).toBeNull();
    expect(runInit(null)).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    expect(() => runInit(null, true)).not.toThrow();
  });
});
