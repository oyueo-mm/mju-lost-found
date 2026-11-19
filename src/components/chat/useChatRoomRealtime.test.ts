import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { pollingRecheckMs } from "./useChatRoomRealtime";

describe("polling-mode token re-check", () => {
  it("follows the server's Retry-After within 30 s .. 10 min, default 2 min", () => {
    expect(pollingRecheckMs("120")).toBe(120_000);
    expect(pollingRecheckMs("300")).toBe(300_000);
    expect(pollingRecheckMs("1")).toBe(30_000); // never hammer the token API
    expect(pollingRecheckMs("86400")).toBe(600_000); // never park a tab for good
    expect(pollingRecheckMs(null)).toBe(120_000);
    expect(pollingRecheckMs("soon")).toBe(120_000);
    expect(pollingRecheckMs("0")).toBe(120_000);
    expect(pollingRecheckMs("-5")).toBe(120_000);
  });

  it("no longer stops re-checking for good after a 204 (the D-3 canary failure)", () => {
    const source = readFileSync(new URL("./useChatRoomRealtime.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/retryAt\s*=\s*Infinity/);
    expect(source).toMatch(/status===204\)\{retryAt=Date\.now\(\)\+pollingRecheckMs\(/);
  });
});
