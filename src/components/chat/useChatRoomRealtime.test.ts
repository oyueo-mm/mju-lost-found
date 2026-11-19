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
    expect(source).toMatch(/status===204\)\{(?:lastTokenOutcome="mode";)?retryAt=Date\.now\(\)\+pollingRecheckMs\(/);
  });
});

describe("canary diagnostics", () => {
  it("are sent only after a canary token (receiptEnabled) and use the server's fixed vocabulary", async () => {
    const source = readFileSync(new URL("./useChatRoomRealtime.ts", import.meta.url), "utf8");
    expect(source).toMatch(/let diag=false;/);
    expect(source).toMatch(/if\(value\.receiptEnabled===true\)diag=true;/);
    expect(source).toMatch(/const report=\(event:string\)=>\{if\(!diag\)return;/);
    const { REALTIME_DIAG_EVENTS } = await import("@/lib/chat/realtimeGrants");
    const emitted = new Set<string>(["subscribed"]);
    for (const reason of ["mode", "token", "transport", "error"]) emitted.add(`polling-${reason}`);
    for (const v of ["visible", "hidden"]) for (const c of ["connected", "polling"]) emitted.add(`${v}-${c}`);
    expect([...emitted].sort()).toEqual([...REALTIME_DIAG_EVENTS].sort());
  });
});
