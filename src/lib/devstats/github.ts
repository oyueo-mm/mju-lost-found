import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";

// 개발자 통계 (/admin/stats?tab=dev): the commits of the service's GitHub
// repository, read from the official REST API (GET /repos/{owner}/{repo}/
// commits on the deployed branch) on the server only.
//
// - Cached: one normalized list in Next's data cache (shared by instances
//   and kept across deployments), refreshed at most every REVALIDATE_SECONDS
//   in the background -- a refresh that fails keeps the last good list.
//   About three requests (100 commits each) per refresh.
// - A token is optional (the repository is public): GITHUB_TOKEN, a server
//   environment variable, raises the hourly limit from 60 (shared by every
//   app on the same outgoing address) to 5,000. It is only ever sent to
//   api.github.com and never logged or returned.
// - Failures stay here: a limit, an outage or a timeout becomes a result
//   the tab explains; nothing else on /admin/stats or the service waits on
//   it. After a failure this instance waits FAILURE_BACKOFF_MS before
//   asking GitHub again.
// - What is kept per commit: what GitHub shows publicly on the commit page
//   (SHA, message, time, the author's name and GitHub account). E-mail
//   addresses are only used to tell unlinked authors apart, as a hash.

export const GITHUB_REPO = { owner: "oyueo-mm", repo: "mju-lost-found", branch: "vercel" } as const;
export const REPO_URL = `https://github.com/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}`;
export const REVALIDATE_SECONDS = 900;
const PER_PAGE = 100;
export const MAX_COMMITS = 1000;
const MAX_BODY = 800;
const TIMEOUT_MS = 8000;
const FAILURE_BACKOFF_MS = 5 * 60_000;

export type CommitAuthor = {
  // GitHub account ("gh:<login>") when the commit e-mail is linked to one;
  // else the e-mail's hash ("mail:<hash>"), else the name ("name:<name>")
  key: string;
  login: string | null;
  name: string; // the commit's author name
  profileUrl: string | null;
};

export type DevCommit = {
  sha: string;
  title: string; // first line of the message
  body: string; // the rest, without Co-Authored-By lines, shortened
  authoredAt: string; // ISO (UTC)
  committedAt: string;
  url: string; // the commit's page on GitHub
  author: CommitAuthor;
  coAuthors: string[]; // names from Co-Authored-By trailers
  merge: boolean; // more than one parent
  parents: string[]; // parent SHAs: which commits a deployed commit contains
};

export type CommitFeed =
  | { ok: true; commits: DevCommit[]; fetchedAt: string; truncated: boolean; authenticated: boolean }
  | { ok: false; reason: "rate_limited" | "not_found" | "unavailable"; resetAt: string | null };

type RawCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; email?: string; date?: string } | null; committer: { date?: string } | null };
  author: { login?: string; html_url?: string; type?: string } | null;
  parents: { sha?: string }[];
};

const CO_AUTHOR = /^co-authored-by:\s*(.+?)\s*(?:<[^>]*>)?\s*$/i;

export function normalizeCommit(raw: RawCommit): DevCommit {
  const message = (raw.commit.message ?? "").replace(/\r\n/g, "\n");
  const [first = "", ...rest] = message.split("\n");
  const coAuthors: string[] = [];
  const bodyLines = rest.filter((line) => {
    const m = CO_AUTHOR.exec(line.trim());
    if (m) coAuthors.push(m[1]);
    return !m;
  });
  let body = bodyLines.join("\n").trim();
  if (body.length > MAX_BODY) body = `${body.slice(0, MAX_BODY).trimEnd()}…`;
  const name = raw.commit.author?.name?.trim() || "이름 없음";
  const email = raw.commit.author?.email?.trim().toLowerCase();
  const login = raw.author?.login ?? null;
  const key = login
    ? `gh:${login.toLowerCase()}`
    : email
      ? `mail:${createHash("sha256").update(email).digest("hex").slice(0, 12)}`
      : `name:${name}`;
  const authoredAt = raw.commit.author?.date ?? raw.commit.committer?.date ?? new Date(0).toISOString();
  return {
    sha: raw.sha,
    title: first.trim() || "(메시지 없음)",
    body,
    authoredAt,
    committedAt: raw.commit.committer?.date ?? authoredAt,
    url: raw.html_url,
    author: { key, login, name, profileUrl: login ? (raw.author?.html_url ?? `https://github.com/${login}`) : null },
    coAuthors: [...new Set(coAuthors)],
    merge: Array.isArray(raw.parents) && raw.parents.length > 1,
    parents: Array.isArray(raw.parents) ? raw.parents.map((p) => p?.sha).filter((x): x is string => typeof x === "string") : [],
  };
}

class FeedFailure extends Error {
  constructor(readonly result: Extract<CommitFeed, { ok: false }>) {
    super(result.reason);
  }
}

function failureOf(response: Response): Extract<CommitFeed, { ok: false }> {
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const limited = response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
  return {
    ok: false,
    reason: limited ? "rate_limited" : response.status === 404 ? "not_found" : "unavailable",
    resetAt: limited && reset > 0 ? new Date(reset * 1000).toISOString() : null,
  };
}

// Every commit of the branch, newest first (at most MAX_COMMITS).
const headersOf = (token: string | undefined) => {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mju-find-admin-stats",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

export async function fetchCommitFeed(fetcher: typeof fetch = fetch, token = process.env.GITHUB_TOKEN): Promise<CommitFeed> {
  const headers = headersOf(token);
  const commits: DevCommit[] = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/commits?sha=${GITHUB_REPO.branch}&per_page=${PER_PAGE}&page=${page}`;
    let response: Response;
    try {
      response = await fetcher(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      return { ok: false, reason: "unavailable", resetAt: null };
    }
    if (!response.ok) return failureOf(response);
    const rows = (await response.json()) as RawCommit[];
    if (!Array.isArray(rows)) return { ok: false, reason: "unavailable", resetAt: null };
    commits.push(...rows.map(normalizeCommit));
    if (rows.length < PER_PAGE || !/rel="next"/.test(response.headers.get("link") ?? "")) break;
    if (commits.length >= MAX_COMMITS) {
      truncated = true;
      break;
    }
  }
  return { ok: true, commits: commits.slice(0, MAX_COMMITS), fetchedAt: new Date().toISOString(), truncated, authenticated: !!token };
}

const cachedFeed = unstable_cache(
  async () => {
    const feed = await fetchCommitFeed();
    // a failure is never cached: the last good list stays in place
    if (!feed.ok) throw new FeedFailure(feed);
    return feed;
  },
  ["github-commit-feed-v2", GITHUB_REPO.owner, GITHUB_REPO.repo, GITHUB_REPO.branch],
  { revalidate: REVALIDATE_SECONDS, tags: ["github-commit-feed"] },
);

let lastFailure: { until: number; result: Extract<CommitFeed, { ok: false }> } | null = null;

export async function loadCommitFeed(): Promise<CommitFeed> {
  if (lastFailure && Date.now() < lastFailure.until) return lastFailure.result;
  try {
    const feed = await cachedFeed();
    lastFailure = null;
    return feed;
  } catch (error) {
    const result: Extract<CommitFeed, { ok: false }> = error instanceof FeedFailure ? error.result : { ok: false, reason: "unavailable", resetAt: null };
    // status only: never the request, its headers or the token
    console.error("GitHub commit feed unavailable:", result.reason);
    lastFailure = { until: Date.now() + FAILURE_BACKOFF_MS, result };
    return result;
  }
}

// ---------- Compare (GET /repos/{owner}/{repo}/compare/{base}...{head}) ----------
// For deployed commits that are not on the branch list (another branch):
// the commits head has and base does not. A commit GitHub does not know
// (not pushed yet) is "not_found" -- shown as 확인 불가, never guessed.
// A found comparison never changes, so it is cached for good; a miss is
// remembered here for a while so it is not asked again on every view.

export type CompareResult =
  | { ok: true; status: "ahead" | "behind" | "identical" | "diverged"; aheadBy: number; behindBy: number; commits: DevCommit[]; truncated: boolean }
  | { ok: false; reason: "not_found" | "rate_limited" | "unavailable" };

const SHA = /^[0-9a-f]{40}$/;

export async function fetchCompare(base: string, head: string, fetcher: typeof fetch = fetch, token = process.env.GITHUB_TOKEN): Promise<CompareResult> {
  if (!SHA.test(base) || !SHA.test(head)) return { ok: false, reason: "not_found" };
  try {
    const res = await fetcher(`https://api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/compare/${base}...${head}?per_page=250`, {
      headers: headersOf(token),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const f = failureOf(res);
      return { ok: false, reason: res.status === 422 ? "not_found" : f.reason };
    }
    const body = (await res.json()) as { status?: string; ahead_by?: number; behind_by?: number; total_commits?: number; commits?: RawCommit[] };
    const status = body.status === "ahead" || body.status === "behind" || body.status === "identical" || body.status === "diverged" ? body.status : null;
    if (!status) return { ok: false, reason: "unavailable" };
    const commits = (body.commits ?? []).map(normalizeCommit);
    return { ok: true, status, aheadBy: body.ahead_by ?? 0, behindBy: body.behind_by ?? 0, commits, truncated: (body.total_commits ?? commits.length) > commits.length };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

class CompareMiss extends Error {
  constructor(readonly result: Extract<CompareResult, { ok: false }>) {
    super(result.reason);
  }
}
const misses = new Map<string, { until: number; result: Extract<CompareResult, { ok: false }> }>();

export async function loadCompare(base: string, head: string): Promise<CompareResult> {
  const key = `${base}...${head}`;
  const miss = misses.get(key);
  if (miss && Date.now() < miss.until) return miss.result;
  try {
    return await unstable_cache(
      async () => {
        const r = await fetchCompare(base, head);
        if (!r.ok) throw new CompareMiss(r);
        return r;
      },
      ["github-compare-v1", base, head],
      { revalidate: false },
    )();
  } catch (error) {
    const result: Extract<CompareResult, { ok: false }> = error instanceof CompareMiss ? error.result : { ok: false, reason: "unavailable" };
    misses.set(key, { until: Date.now() + FAILURE_BACKOFF_MS * 3, result });
    if (misses.size > 200) misses.delete(misses.keys().next().value as string);
    return result;
  }
}
