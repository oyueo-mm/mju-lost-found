import { del } from "@vercel/blob";

// A Vercel Blob read-write token looks like
// "vercel_blob_rw_<STORE_ID>_<secret>", and a blob's public URL is always
// "https://<STORE_ID (lowercased)>.public.blob.vercel-storage.com/<pathname>".
// Deriving the expected host from our own token (rather than trusting
// whatever host a client-submitted URL happens to have) is what actually
// prevents a PATCH-like request from registering an arbitrary external
// URL as a post's image -- see isOurBlobUrl().
function getExpectedBlobHost(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const match = /^vercel_blob_rw_([a-z0-9]+)_/i.exec(token);
  if (!match) return null;
  return `${match[1].toLowerCase()}.public.blob.vercel-storage.com`;
}

// Without a configured token, there's no store to validate against, so
// this fails closed (rejects every URL) rather than accepting anything.
export function isOurBlobUrl(urlString: string, pathname: string): boolean {
  const expectedHost = getExpectedBlobHost();
  if (!expectedHost) return false;
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === expectedHost &&
    url.pathname === `/${pathname}`
  );
}

// Best-effort cleanup -- failures are logged, never thrown, so a Blob
// storage hiccup never blocks a post mutation (delete/replace) that
// already succeeded in the DB.
export async function deleteBlobSafely(url: string): Promise<void> {
  try {
    await del(url);
  } catch (error) {
    console.error("Failed to delete blob:", url, error);
  }
}
