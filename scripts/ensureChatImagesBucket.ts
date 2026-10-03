// Creates (or verifies) the private `chat-images` Storage bucket that 1:1 /
// organization-inquiry chat images live in -- the reproducible replacement
// for clicking it together in the Supabase Dashboard. Idempotent:
//   - bucket missing  -> created private, with the same size / type limits
//     as post images (MAX_IMAGE_SIZE_BYTES, ALLOWED_IMAGE_CONTENT_TYPES);
//   - bucket present  -> its settings are checked; a public or differently
//     limited bucket is reported and the script exits non-zero. It never
//     flips an existing bucket to public, and never deletes anything.
// Dry run by default; --apply creates. Against Production it also needs
// --confirm-production. Keys come from the env file you pass -- nothing
// secret is printed or stored.
//
//   npx tsx --env-file=.env.preview.local scripts/ensureChatImagesBucket.ts            (dry run, Preview)
//   npx tsx --env-file=.env.preview.local scripts/ensureChatImagesBucket.ts --apply
//   npx tsx --env-file=.env scripts/ensureChatImagesBucket.ts --apply --confirm-production
import { createClient } from "@supabase/supabase-js";

import { ALLOWED_IMAGE_CONTENT_TYPES, CHAT_IMAGES_BUCKET, MAX_IMAGE_SIZE_BYTES } from "@/lib/images/config";

const PRODUCTION_REF = "tmifqtyxojtuoejxjrng";
const PREVIEW_REF = "swqvlihgupranzfzjevb";

const WANTED = {
  public: false,
  fileSizeLimit: MAX_IMAGE_SIZE_BYTES,
  allowedMimeTypes: [...ALLOWED_IMAGE_CONTENT_TYPES],
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (pass --env-file).");
  const ref = new URL(url).hostname.split(".")[0];
  const environment = ref === PRODUCTION_REF ? "Production" : ref === PREVIEW_REF ? "Preview" : "unknown";
  if (environment === "unknown") throw new Error("NEXT_PUBLIC_SUPABASE_URL is neither the Production nor the Preview project.");
  const apply = process.argv.includes("--apply");
  if (apply && environment === "Production" && !process.argv.includes("--confirm-production")) {
    throw new Error("Writing to Production needs --confirm-production as well.");
  }

  const storage = createClient(url, key, { auth: { persistSession: false } }).storage;
  const { data: existing } = await storage.getBucket(CHAT_IMAGES_BUCKET);

  if (existing) {
    const actual = {
      public: existing.public,
      fileSizeLimit: existing.file_size_limit ?? null,
      allowedMimeTypes: [...(existing.allowed_mime_types ?? [])].sort(),
    };
    const ok =
      actual.public === false &&
      actual.fileSizeLimit === WANTED.fileSizeLimit &&
      JSON.stringify(actual.allowedMimeTypes) === JSON.stringify([...WANTED.allowedMimeTypes].sort());
    console.log(JSON.stringify({ environment, bucket: CHAT_IMAGES_BUCKET, exists: true, settings: actual, ok }));
    if (!ok) {
      process.exitCode = 1;
      console.error("Bucket exists with unexpected settings -- fix it deliberately; this script never changes an existing bucket.");
    }
    return;
  }

  console.log(JSON.stringify({ environment, bucket: CHAT_IMAGES_BUCKET, exists: false, willCreate: WANTED, apply }));
  if (!apply) {
    console.log("dry run -- nothing created (add --apply)");
    return;
  }
  const { error } = await storage.createBucket(CHAT_IMAGES_BUCKET, WANTED);
  if (error) throw new Error(`createBucket failed: ${error.message}`);
  const { data: created } = await storage.getBucket(CHAT_IMAGES_BUCKET);
  console.log(
    JSON.stringify({
      created: true,
      public: created?.public,
      fileSizeLimit: created?.file_size_limit,
      allowedMimeTypes: created?.allowed_mime_types,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
