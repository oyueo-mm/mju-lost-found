import { unstable_cache } from "next/cache";

import { PRODUCTION_HOST } from "./vercelDeployment.mjs";

// 지금 Production에 실제로 반영된 버전: Production's own answer at
// https://mju-find.vercel.app/api/version (the deployment serving the
// public domain right now), no token needed. Cached for a minute; until
// Production carries that route, or when it does not answer, the version
// is "확인 불가" -- never taken from the latest record instead.

export type LiveVersion =
  | { ok: true; deploymentId: string; gitSha: string | null; checkedAt: string }
  | { ok: false; reason: "not_available" | "unavailable" };

const TIMEOUT_MS = 5000;
const FAILURE_BACKOFF_MS = 2 * 60_000;

export async function fetchLiveVersion(fetcher: typeof fetch = fetch): Promise<LiveVersion> {
  try {
    const res = await fetcher(`https://${PRODUCTION_HOST}/api/version`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404) return { ok: false, reason: "not_available" };
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return { ok: false, reason: "unavailable" };
    const body = (await res.json()) as { deploymentId?: unknown; environment?: unknown; gitSha?: unknown };
    if (typeof body.deploymentId !== "string" || !body.deploymentId.startsWith("dpl_") || body.environment !== "production") return { ok: false, reason: "unavailable" };
    return { ok: true, deploymentId: body.deploymentId, gitSha: typeof body.gitSha === "string" ? body.gitSha : null, checkedAt: new Date().toISOString() };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

class LiveFailure extends Error {
  constructor(readonly reason: Extract<LiveVersion, { ok: false }>["reason"]) {
    super(reason);
  }
}

const cached = unstable_cache(
  async () => {
    const live = await fetchLiveVersion();
    if (!live.ok) throw new LiveFailure(live.reason);
    return live;
  },
  ["live-production-version-v1", PRODUCTION_HOST],
  { revalidate: 60 },
);

let lastFailure: { until: number; reason: Extract<LiveVersion, { ok: false }>["reason"] } | null = null;

export async function loadLiveVersion(): Promise<LiveVersion> {
  if (lastFailure && Date.now() < lastFailure.until) return { ok: false, reason: lastFailure.reason };
  try {
    const live = await cached();
    lastFailure = null;
    return live;
  } catch (error) {
    const reason = error instanceof LiveFailure ? error.reason : "unavailable";
    lastFailure = { until: Date.now() + FAILURE_BACKOFF_MS, reason };
    return { ok: false, reason };
  }
}
