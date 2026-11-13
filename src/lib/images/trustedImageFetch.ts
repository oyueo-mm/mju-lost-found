import { PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "@/lib/db/accessPolicy.mjs";

import { MAX_IMAGE_SIZE_BYTES } from "./config";

// Release B security review (SSRF): the image embedding fetches a post photo by
// URL on the server. Every URL the app itself stores is built by
// publicUrlFor() from a validated Storage path, and no API accepts an image
// URL from a client -- but the fetch must not rely on that. Only these
// sources are ever fetched:
//   - https://<production|preview project>.supabase.co/storage/v1/object/public/post-images/...
//     (Preview runs on a copy of Production data, so either project's URL can
//     appear there);
//   - https://<store>.public.blob.vercel-storage.com/... (posts from before the
//     move to Supabase, the same hosts next.config.ts's remotePatterns allow).
// No IP literal, localhost, metadata address, other port, credentials, other
// bucket or encoded path traversal; no redirects (a redirect could leave the
// allow-list); a time limit and a size limit enforced while streaming.

const TRUSTED_SUPABASE_PROJECTS = new Set<string>([PRODUCTION_DB_PROJECT, PREVIEW_DB_PROJECT]);
const SUPABASE_POST_IMAGES_PREFIX = "/storage/v1/object/public/post-images/";
const VERCEL_BLOB_HOST = /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/;
export const IMAGE_FETCH_TIMEOUT_MS = 10_000;

export class UntrustedImageUrlError extends Error {
  constructor() {
    super("Image URL is not a trusted post-image location.");
    this.name = "UntrustedImageUrlError";
  }
}
export class ImageTooLargeError extends Error {
  constructor() {
    super("Image exceeds the size limit.");
    this.name = "ImageTooLargeError";
  }
}

export function isTrustedImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port !== "") return false; // "" = the default 443
  // Encoded dot segments or separators are never part of a stored path
  // (UUID file names); refuse them instead of trusting the server to resolve.
  if (/%2e|%2f|%5c/i.test(url.pathname)) return false;

  const supabase = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  if (supabase) {
    return TRUSTED_SUPABASE_PROJECTS.has(supabase[1]) && url.pathname.startsWith(SUPABASE_POST_IMAGES_PREFIX) && url.pathname.length > SUPABASE_POST_IMAGES_PREFIX.length;
  }
  return VERCEL_BLOB_HOST.test(url.hostname) && url.pathname.length > 1;
}

// Fetches a trusted post image with a time limit, no redirects, and the
// upload size limit enforced on the declared length and while reading.
export async function fetchTrustedImage(
  raw: string,
  { maxBytes = MAX_IMAGE_SIZE_BYTES, timeoutMs = IMAGE_FETCH_TIMEOUT_MS }: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Blob> {
  if (!isTrustedImageUrl(raw)) throw new UntrustedImageUrlError();
  const response = await fetch(raw, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Image fetch failed with status ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ImageTooLargeError();
  }
  if (!response.body) return new Blob([]);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ImageTooLargeError();
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") ?? "" });
}
