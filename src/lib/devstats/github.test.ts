import { beforeEach, describe, expect, it, vi } from "vitest";

// unstable_cache needs the Next server; here it simply calls through.
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

const { fetchCommitFeed, fetchCompare, normalizeCommit, loadCommitFeed } = await import("./github");

const raw = (over: Record<string, unknown> = {}) => ({
  sha: "a".repeat(40),
  html_url: "https://github.com/oyueo-mm/mju-lost-found/commit/aaaa",
  commit: {
    message: "feat: a thing\n\nWhy it changed.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
    author: { name: "oyueo-mm", email: "Someone@Example.com", date: "2026-10-18T15:30:00Z" },
    committer: { date: "2026-10-18T15:31:00Z" },
  },
  author: { login: "oyueo-mm", html_url: "https://github.com/oyueo-mm" },
  parents: [{}],
  ...over,
});

const page = (rows: unknown[], next: boolean, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(rows), { status, headers: { ...(next ? { link: '<https://api.github.com/x?page=2>; rel="next"' } : {}), ...headers } });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GitHub commit feed", () => {
  it("keeps the title, the body without trailers, co-authors and the GitHub account -- never the e-mail", () => {
    const c = normalizeCommit(raw() as never);
    expect(c.title).toBe("feat: a thing");
    expect(c.body).toBe("Why it changed.");
    expect(c.coAuthors).toEqual(["Claude Opus 5.5"]);
    expect(c.author).toEqual({ key: "gh:oyueo-mm", login: "oyueo-mm", name: "oyueo-mm", profileUrl: "https://github.com/oyueo-mm" });
    expect(JSON.stringify(c)).not.toMatch(/example\.com/i);
    expect(c.merge).toBe(false);
  });

  it("tells unlinked authors apart by a hash of their e-mail, whatever the name", () => {
    const a = normalizeCommit(raw({ author: null, commit: { message: "x", author: { name: "박지환", email: "a@x.com", date: "2026-10-01T00:00:00Z" }, committer: null } }) as never);
    const b = normalizeCommit(raw({ author: null, commit: { message: "y", author: { name: "Jihwan", email: "A@x.com", date: "2026-10-01T00:00:00Z" }, committer: null } }) as never);
    expect(a.author.key).toMatch(/^mail:[0-9a-f]{12}$/);
    expect(a.author.key).toBe(b.author.key);
    expect(a.author.login).toBeNull();
    expect(normalizeCommit(raw({ parents: [{}, {}] }) as never).merge).toBe(true);
  });

  it("reads every page of the branch, with the token only in the Authorization header", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => raw({ sha: `s${i}` })), true))
      .mockResolvedValueOnce(page([raw({ sha: "last" })], false));
    const feed = await fetchCommitFeed(fetcher, "secret-token");
    expect(feed.ok && feed.commits.length).toBe(101);
    expect(feed.ok && feed.authenticated).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/repos/oyueo-mm/mju-lost-found/commits?sha=vercel&per_page=100&page=1");
    expect(String(url)).not.toContain("secret-token");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(String(fetcher.mock.calls[1][0])).toContain("page=2");
  });

  it("turns a rate limit, a missing repository or a network error into a reason", async () => {
    const reset = Math.floor(Date.parse("2026-10-18T06:00:00Z") / 1000);
    const limited = await fetchCommitFeed(vi.fn<typeof fetch>().mockResolvedValue(page([], false, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) })), undefined);
    expect(limited).toEqual({ ok: false, reason: "rate_limited", resetAt: "2026-10-18T06:00:00.000Z" });
    expect(await fetchCommitFeed(vi.fn<typeof fetch>().mockResolvedValue(page([], false, 404)), undefined)).toMatchObject({ reason: "not_found" });
    expect(await fetchCommitFeed(vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout")), undefined)).toMatchObject({ reason: "unavailable" });
  });

  it("never throws to the page, logs only the reason, and waits before asking again", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(page([], false, 500));
    const first = await loadCommitFeed();
    expect(first).toEqual({ ok: false, reason: "unavailable", resetAt: null });
    expect(error).toHaveBeenCalledWith("GitHub commit feed unavailable:", "unavailable");
    await loadCommitFeed();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps parent SHAs, and compares two commits through GitHub Compare", async () => {
    expect(normalizeCommit(raw({ parents: [{ sha: "b".repeat(40) }] }) as never).parents).toEqual(["b".repeat(40)]);
    const base = "1".repeat(40);
    const head = "2".repeat(40);
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ status: "ahead", ahead_by: 1, behind_by: 0, total_commits: 1, commits: [raw({ sha: head })] }),
    );
    const r = await fetchCompare(base, head, fetcher, undefined);
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://api.github.com/repos/oyueo-mm/mju-lost-found/compare/${base}...${head}?per_page=250`);
    expect(r).toMatchObject({ ok: true, status: "ahead", aheadBy: 1, truncated: false });
    // a commit GitHub does not know (not pushed): not found, never guessed
    expect(await fetchCompare(base, head, vi.fn<typeof fetch>(async () => new Response("", { status: 404 })), undefined)).toEqual({ ok: false, reason: "not_found" });
    expect(await fetchCompare("nope", head, vi.fn(), undefined)).toEqual({ ok: false, reason: "not_found" });
  });
});
