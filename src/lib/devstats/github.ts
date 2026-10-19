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
};

export type CommitFeed =
  | { ok: true; commits: DevCommit[]; fetchedAt: string; truncated: boolean; authenticated: boolean }
  | { ok: false; reason: "rate_limited" | "not_found" | "unavailable"; resetAt: string | null };

type RawCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; email?: string; date?: string } | null; committer: { date?: string } | null };
  author: { login?: string; html_url?: string; type?: string } | null;
  parents: unknown[];
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
export async function fetchCommitFeed(fetcher: typeof fetch = fetch, token = process.env.GITHUB_TOKEN): Promise<CommitFeed> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mju-find-admin-stats",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
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
  ["github-commit-feed-v1", GITHUB_REPO.owner, GITHUB_REPO.repo, GITHUB_REPO.branch],
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
