import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { withErrorHandling } from "@/lib/posts/response";

import { checkCrossOrigin, crossOriginRejection, requestOrigin } from "./sameOrigin";

const URL_ = "https://mju-find.vercel.app/api/posts";
const req = (method: string, headers: Record<string, string> = {}, url = URL_) =>
  new NextRequest(url, { method, headers: { host: new URL(url).host, ...headers } });

describe("checkCrossOrigin (P-2)", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("never rejects a safe %s, even cross-site", (method) => {
    expect(checkCrossOrigin(req(method, { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).ok).toBe(true);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects a cross-site %s by Sec-Fetch-Site", (method) => {
    expect(checkCrossOrigin(req(method, { "sec-fetch-site": "cross-site", origin: "https://evil.example" }))).toEqual({ ok: false, reason: "sec-fetch-site" });
  });

  it("rejects same-site (another origin on the same site, e.g. http vs https) too", () => {
    expect(checkCrossOrigin(req("POST", { "sec-fetch-site": "same-site" })).ok).toBe(false);
  });

  it("accepts same-origin and user-initiated (none) by Sec-Fetch-Site", () => {
    expect(checkCrossOrigin(req("POST", { "sec-fetch-site": "same-origin", origin: "https://mju-find.vercel.app" })).ok).toBe(true);
    expect(checkCrossOrigin(req("POST", { "sec-fetch-site": "none" })).ok).toBe(true);
  });

  it("Sec-Fetch-Site wins over a matching Origin (a forged Origin cannot help a cross-site request)", () => {
    expect(checkCrossOrigin(req("POST", { "sec-fetch-site": "cross-site", origin: "https://mju-find.vercel.app" })).ok).toBe(false);
  });

  it("falls back to Origin without Sec-Fetch-Site", () => {
    expect(checkCrossOrigin(req("POST", { origin: "https://mju-find.vercel.app" })).ok).toBe(true);
    expect(checkCrossOrigin(req("POST", { origin: "https://MJU-FIND.vercel.app" })).ok).toBe(true);
    expect(checkCrossOrigin(req("POST", { origin: "https://evil.example" }))).toEqual({ ok: false, reason: "origin" });
    expect(checkCrossOrigin(req("POST", { origin: "http://mju-find.vercel.app" })).ok).toBe(false);
    expect(checkCrossOrigin(req("POST", { origin: "https://mju-find.vercel.app.evil.example" })).ok).toBe(false);
    expect(checkCrossOrigin(req("POST", { origin: "https://other-app.vercel.app" })).ok).toBe(false);
    expect(checkCrossOrigin(req("POST", { origin: "null" }))).toEqual({ ok: false, reason: "null-origin" });
  });

  it("lets a request with neither header through (server-to-server: cron, embedding kick, vercel curl)", () => {
    expect(checkCrossOrigin(req("POST")).ok).toBe(true);
  });

  it("uses the Host header the browser used (next start's request.url host may differ)", () => {
    const r = new NextRequest("http://localhost:3000/api/posts", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } });
    expect(requestOrigin(r)).toBe("http://127.0.0.1:3000");
    expect(checkCrossOrigin(r).ok).toBe(true);
  });

  it("ignores a malformed Host and falls back to the URL origin", () => {
    const r = new NextRequest(URL_, { method: "POST", headers: { host: "evil.example/x", origin: "https://evil.example" } });
    expect(requestOrigin(r)).toBe("https://mju-find.vercel.app");
    expect(checkCrossOrigin(r).ok).toBe(false);
  });

  it("answers 403 without echoing the foreign origin", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = crossOriginRejection(req("DELETE", { "sec-fetch-site": "cross-site", origin: "https://evil.example/secret" }))!;
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("evil");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("evil");
    warn.mockRestore();
  });
});

describe("withErrorHandling applies the check before the handler", () => {
  it("refuses a cross-site POST without running the handler (no session lookup, no write)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn(async (request: NextRequest) => NextResponse.json({ ok: request.method !== "" }));
    const res = await withErrorHandling(handler)(req("POST", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler for a same-origin POST and for any GET", async () => {
    const handler = vi.fn(async (request: NextRequest) => NextResponse.json({ ok: request.method !== "" }));
    expect((await withErrorHandling(handler)(req("POST", { "sec-fetch-site": "same-origin" }))).status).toBe(200);
    expect((await withErrorHandling(handler)(req("GET", { "sec-fetch-site": "cross-site" }))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

// Every state-changing Route Handler either goes through withErrorHandling
// (and so the check above) or is a listed exception with its own defense.
describe("route inventory", () => {
  const API = join(process.cwd(), "src", "app", "api");
  const EXCEPTIONS: Record<string, string> = {
    // Auth.js: its own double-submit CSRF token on sign-in/out; the Google
    // callback is a top-level GET from accounts.google.com.
    "auth/[...nextauth]/route.ts": "Auth.js CSRF token",
    // Anonymous, never reads a cookie; browsers send reports themselves.
    "csp-report/route.ts": "no cookie authentication",
    // Stricter: requires an Origin equal to the page origin and refuses cross-site.
    "chat/[id]/realtime/route.ts": "own Origin check",
  };
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "route.ts") files.push(relative(API, path).split(sep).join("/"));
    }
  };
  walk(API);

  it("finds the routes", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(files)("%s: unsafe methods are wrapped or an explained exception", (file) => {
    const source = readFileSync(join(API, file), "utf8");
    const unsafe = [...source.matchAll(/export\s+(?:const|async function)\s+(POST|PUT|PATCH|DELETE)\b(\s*=\s*withErrorHandling)?/g)];
    const unwrapped = unsafe.filter((m) => !m[2]).map((m) => m[1]);
    const destructured = /export\s+const\s+\{[^}]*\b(POST|PUT|PATCH|DELETE)\b/.test(source);
    if (EXCEPTIONS[file]) {
      expect(unwrapped.length + Number(destructured)).toBeGreaterThan(0); // stale exception otherwise
      return;
    }
    expect(destructured).toBe(false);
    expect(unwrapped).toEqual([]);
  });

  it("the realtime exception really checks Origin", () => {
    const source = readFileSync(join(API, "chat/[id]/realtime/route.ts"), "utf8");
    expect(source).toMatch(/origin!==request\.nextUrl\.origin/);
    expect(source).toMatch(/sec-fetch-site"\)==="cross-site"/);
  });
});
