import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { REPORT_EVIDENCE_BUCKET, REPORT_EVIDENCE_URL_TTL_SECONDS } from "@/lib/images/config";
import { createClient } from "@supabase/supabase-js";

// Server-only access to the private report-evidence bucket (service role).
// Only paths shaped like reports/{reportId}/{index}.{ext} are ever written,
// signed or removed -- nothing else in that bucket (or any other) can be
// reached through this module.
const EVIDENCE_PATH = /^reports\/(\d+)\/(\d+)\.(jpg|png|webp)$/;

export function evidencePathFor(reportId: number, index: number, ext: string): string | null {
  const path = `reports/${reportId}/${index}.${ext === "jpeg" ? "jpg" : ext}`;
  return EVIDENCE_PATH.test(path) ? path : null;
}

export function parseEvidencePath(path: string): { reportId: number; index: number } | null {
  const match = EVIDENCE_PATH.exec(path);
  return match ? { reportId: Number(match[1]), index: Number(match[2]) } : null;
}

// A server-side copy inside Supabase Storage: the bytes never pass through
// this server. Never overwrites (copy fails if the destination exists).
export async function copyToEvidence(sourceBucket: string, sourcePath: string, evidencePath: string): Promise<boolean> {
  if (!parseEvidencePath(evidencePath)) return false;
  try {
    // Bound each request while capture holds database locks (max 5 images).
    const signal = AbortSignal.timeout(3000);
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
    });
    // An earlier timed-out copy may already have completed. Never overwrite it.
    const existing = await client.storage.from(REPORT_EVIDENCE_BUCKET).exists(evidencePath);
    if (!existing.error && existing.data) return true;
    const { error } = await client
      .storage.from(sourceBucket)
      .copy(sourcePath, evidencePath, { destinationBucket: REPORT_EVIDENCE_BUCKET });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Report evidence copy failed:", sourceBucket, error instanceof Error ? error.name : "unknown");
    return false;
  }
}

// Only after the caller checked reports.view for this report.
export async function signEvidenceUrl(path: string): Promise<string | null> {
  if (!parseEvidencePath(path)) return null;
  const { data, error } = await getSupabaseAdminClient()
    .storage.from(REPORT_EVIDENCE_BUCKET)
    .createSignedUrl(path, REPORT_EVIDENCE_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("Report evidence signing failed:", error?.message ?? "unknown");
    return null;
  }
  return data.signedUrl;
}

// Best-effort, never rejects: true when every given path is gone (removing an
// already-missing object is not an error). Refuses any path that isn't an
// evidence path.
export async function removeEvidence(paths: string[]): Promise<boolean> {
  const valid = paths.filter((p) => parseEvidencePath(p));
  if (valid.length !== paths.length) console.error("Refusing to remove non-evidence paths");
  if (!valid.length) return valid.length === paths.length;
  try {
    const { error } = await getSupabaseAdminClient().storage.from(REPORT_EVIDENCE_BUCKET).remove(valid);
    if (error) throw error;
    return valid.length === paths.length;
  } catch (error) {
    console.error("Report evidence removal failed:", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

// Every evidence object of one report (its folder), whatever the snapshot
// lists -- so a copy whose snapshot update failed is still found. null when
// the listing itself failed.
export async function listEvidence(reportId: number): Promise<string[] | null> {
  if (!Number.isInteger(reportId) || reportId <= 0) return null;
  try {
    const { data, error } = await getSupabaseAdminClient()
      .storage.from(REPORT_EVIDENCE_BUCKET)
      .list(`reports/${reportId}`, { limit: 100 });
    if (error) throw error;
    return (data ?? []).map((o) => `reports/${reportId}/${o.name}`).filter((p) => parseEvidencePath(p)?.reportId === reportId);
  } catch (error) {
    console.error("Report evidence listing failed:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

// Removes one report's whole evidence folder. true when nothing is left.
export async function removeReportEvidence(reportId: number): Promise<boolean> {
  const paths = await listEvidence(reportId);
  if (paths === null) return false;
  if (!paths.length) return true;
  return removeEvidence(paths);
}
