import { unstable_cache } from "next/cache";

import { upsertDeployment } from "./deployments";
import { fromVercel, PREVIEW_ALIAS, PROJECT_ID, type VercelDeploymentRow } from "./vercelDeployment.mjs";

// 개발 통계 > Vercel API (optional). Only when VERCEL_API_TOKEN is set (a
// server environment variable; Vercel has no read-only token -- see the
// tab's notes): the project's deployments, which one serves Production, and
// which one the fixed Preview URL points to. Three GET requests, cached 5
// minutes; every fresh list is also written to DeploymentRecord, so it
// outlives Vercel's retention. The token is only sent to api.vercel.com,
// never logged or returned; only deployment fields are read from the
// answers (never the project's settings, environment variables or keys).
// A failure stays on this tab and backs off.

export const VERCEL_REVALIDATE_SECONDS = 300;
const TIMEOUT_MS = 8000;
const FAILURE_BACKOFF_MS = 5 * 60_000;
const MAX_PAGES = 3;

export type VercelFeed =
  | { ok: true; deployments: VercelDeploymentRow[]; productionId: string | null; previewAliasId: string | null; fetchedAt: string }
  | { ok: false; reason: "no_token" | "unauthorized" | "rate_limited" | "unavailable" };

export const hasVercelToken = () => !!process.env.VERCEL_API_TOKEN;

async function get(path: string, token: string, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(`https://api.vercel.com${path}`);
  const team = process.env.VERCEL_TEAM_ID;
  if (team && !url.searchParams.has("teamId")) url.searchParams.set("teamId", team);
  return fetcher(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const reasonOf = (status: number): Extract<VercelFeed, { ok: false }>["reason"] =>
  status === 401 || status === 403 ? "unauthorized" : status === 429 ? "rate_limited" : "unavailable";

export async function fetchVercelFeed(fetcher: typeof fetch = fetch, token = process.env.VERCEL_API_TOKEN): Promise<VercelFeed> {
  if (!token) return { ok: false, reason: "no_token" };
  try {
    const deployments: VercelDeploymentRow[] = [];
    let until: number | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await get(`/v6/deployments?projectId=${PROJECT_ID}&limit=100${until ? `&until=${until}` : ""}`, token, fetcher);
      if (!res.ok) return { ok: false, reason: reasonOf(res.status) };
      const body = (await res.json()) as { deployments?: Record<string, unknown>[]; pagination?: { next?: number | null } };
      for (const d of body.deployments ?? []) {
        const row = fromVercel(d);
        if (row) deployments.push(row);
      }
      until = body.pagination?.next ?? null;
      if (!until) break;
    }
    const [project, alias] = await Promise.all([get(`/v9/projects/${PROJECT_ID}`, token, fetcher), get(`/v4/aliases/${PREVIEW_ALIAS}?projectId=${PROJECT_ID}`, token, fetcher)]);
    // the project answer also holds settings and secrets: only the id of
    // the deployment serving Production is read from it
    const productionId = project.ok ? (((await project.json()) as { targets?: { production?: { id?: unknown } } }).targets?.production?.id ?? null) : null;
    const previewAliasId = alias.ok ? (((await alias.json()) as { deploymentId?: unknown }).deploymentId ?? null) : null;
    return {
      ok: true,
      deployments,
      productionId: typeof productionId === "string" ? productionId : null,
      previewAliasId: typeof previewAliasId === "string" ? previewAliasId : null,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

// Keeps what Vercel listed, so it survives Vercel's retention.
export async function storeVercelFeed(feed: Extract<VercelFeed, { ok: true }>): Promise<void> {
  const seenAt = feed.fetchedAt;
  for (const d of feed.deployments) {
    const current = d.id === feed.productionId || d.id === feed.previewAliasId;
    await upsertDeployment({ ...d, currentAt: current ? seenAt : null }, "api").catch(() => {});
  }
}

class VercelFailure extends Error {
  constructor(readonly reason: Extract<VercelFeed, { ok: false }>["reason"]) {
    super(reason);
  }
}

const cachedFeed = unstable_cache(
  async () => {
    const feed = await fetchVercelFeed();
    if (!feed.ok) throw new VercelFailure(feed.reason);
    await storeVercelFeed(feed);
    return feed;
  },
  ["vercel-deployment-feed-v1", PROJECT_ID],
  { revalidate: VERCEL_REVALIDATE_SECONDS, tags: ["vercel-deployment-feed"] },
);

let lastFailure: { until: number; reason: Extract<VercelFeed, { ok: false }>["reason"] } | null = null;

export async function loadVercelFeed(): Promise<VercelFeed> {
  if (!hasVercelToken()) return { ok: false, reason: "no_token" };
  if (lastFailure && Date.now() < lastFailure.until) return { ok: false, reason: lastFailure.reason };
  try {
    const feed = await cachedFeed();
    lastFailure = null;
    return feed;
  } catch (error) {
    const reason = error instanceof VercelFailure ? error.reason : "unavailable";
    console.error("Vercel deployment feed unavailable:", reason);
    lastFailure = { until: Date.now() + FAILURE_BACKOFF_MS, reason };
    return { ok: false, reason };
  }
}
