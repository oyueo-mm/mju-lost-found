import { PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "../db/accessPolicy.mjs";

// Both environments are explicit because Preview can contain copied
// Production URLs. Read-only inventories found no legacy Blob references.
export const POST_IMAGE_REMOTE_PATTERNS = [PRODUCTION_DB_PROJECT, PREVIEW_DB_PROJECT].flatMap((project) => ["lost", "found"].map((type) => ({
  protocol: /** @type {"https"} */ ("https"),
  hostname: `${project}.supabase.co`,
  port: "",
  pathname: `/storage/v1/object/public/post-images/posts/${type}/**`,
  search: "",
})));

/** @param {string} value */
export function isAllowedOptimizedImageUrl(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && POST_IMAGE_REMOTE_PATTERNS.some((p) =>
      url.protocol === "https:" && url.hostname === p.hostname && url.port === "" && url.pathname.startsWith(p.pathname.slice(0, -2)) && url.pathname.length > p.pathname.length - 2);
  } catch { return false; }
}
