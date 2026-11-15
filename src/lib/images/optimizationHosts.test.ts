import { describe, expect, it } from "vitest";
import { isAllowedOptimizedImageUrl, POST_IMAGE_REMOTE_PATTERNS } from "./optimizationHosts.mjs";
import { PREVIEW_DB_PROJECT, PRODUCTION_DB_PROJECT } from "@/lib/db/accessPolicy.mjs";
describe("post image optimization allowlist", () => {
  it("accepts both exact Storage projects including Production URLs in Preview", () => {
    for (const ref of [PRODUCTION_DB_PROJECT, PREVIEW_DB_PROJECT]) {
      expect(isAllowedOptimizedImageUrl(`https://${ref}.supabase.co/storage/v1/object/public/post-images/posts/lost/1/a.webp`)).toBe(true);
    }
    expect(POST_IMAGE_REMOTE_PATTERNS).toHaveLength(4);
    expect(POST_IMAGE_REMOTE_PATTERNS.every((p) => !p.hostname.includes("*"))).toBe(true);
  });
  it.each([
    "https://foreign.supabase.co/storage/v1/object/public/post-images/a.jpg",
    `https://${PRODUCTION_DB_PROJECT}.supabase.co/storage/v1/object/public/post-images/unrelated/a.jpg`,
    `https://${PRODUCTION_DB_PROJECT}.supabase.co/storage/v1/object/public/chat-images/a.jpg`,
    `https://${PRODUCTION_DB_PROJECT}.supabase.co/storage/v1/object/public/report-evidence/a.jpg`,
    `https://${PRODUCTION_DB_PROJECT}.supabase.co/storage/v1/object/sign/post-images/a.jpg?token=x`,
    `https://${PRODUCTION_DB_PROJECT}.supabase.co/storage/v1/object/public/post-images/a.jpg?x=1`,
    `https://${PRODUCTION_DB_PROJECT}.supabase.co:8443/storage/v1/object/public/post-images/a.jpg`,
    `http://${PRODUCTION_DB_PROJECT}.supabase.co/storage/v1/object/public/post-images/a.jpg`,
    "https://unknown.public.blob.vercel-storage.com/a.jpg",
    `https://user@${PRODUCTION_DB_PROJECT}.supabase.co/storage/v1/object/public/post-images/a.jpg`,
  ])("rejects a different host, bucket or URL variant: %s", (url) => {
    expect(isAllowedOptimizedImageUrl(url)).toBe(false);
  });
});
