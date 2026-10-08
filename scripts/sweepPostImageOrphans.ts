// 게시글 이미지 고아 파일 점검/정리 (post-images, public bucket).
//
// Lists post-images objects no LostPost/FoundPost.imageUrl or
// PostImage.imageUrl points at any more and are older than --min-age-hours
// (default 24) -- files left by a Storage delete that failed even after
// deleteObjectSafely's retries, or by an upload never attached to a post.
// See src/lib/images/postImageOrphans.ts.
//
// Dry run by default (prints counts and up to 50 paths, deletes nothing):
//   npx tsx --env-file=.env.preview.local scripts/sweepPostImageOrphans.ts
// Delete:
//   ... scripts/sweepPostImageOrphans.ts --apply
// Production additionally needs --confirm-production. Run a dry run and
// get the cleanup approved before any --apply. Only posts/{lost|found}/
// {id}/{uuid}.{ext} files can be candidates (others are listed under
// unrecognizedPath), legacy post-images URLs in Message.image_url are
// protected, and --apply is refused while any Message.image_url value
// can't be classified (messageImageRefs.unclassifiable > 0).
//
// The DB and the Storage project must be the same environment: a mismatch
// would make every file look unreferenced, so it's refused.
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_ORPHAN_MIN_AGE_HOURS, sweepPostImageOrphans } from "@/lib/images/postImageOrphans";

const PRODUCTION_REF = "tmifqtyxojtuoejxjrng";
const PREVIEW_REF = "swqvlihgupranzfzjevb";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function environmentOf(ref: string): "Production" | "Preview" | "unknown" {
  return ref === PRODUCTION_REF ? "Production" : ref === PREVIEW_REF ? "Preview" : "unknown";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const db = process.env.DATABASE_URL ?? "";
  if (!url || !db || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL must be set (pass --env-file).");
  }
  const storageEnv = environmentOf(new URL(url).hostname.split(".")[0]);
  const dbEnv = db.includes(PRODUCTION_REF) ? "Production" : db.includes(PREVIEW_REF) ? "Preview" : "unknown";
  if (storageEnv === "unknown" || storageEnv !== dbEnv) {
    throw new Error(`Storage (${storageEnv}) and DB (${dbEnv}) must be the same known environment.`);
  }
  const apply = process.argv.includes("--apply");
  if (apply && storageEnv === "Production" && !process.argv.includes("--confirm-production")) {
    throw new Error("Deleting from Production needs --confirm-production as well.");
  }
  const minAgeHours = Number(arg("--min-age-hours") ?? DEFAULT_ORPHAN_MIN_AGE_HOURS);
  if (!Number.isFinite(minAgeHours) || minAgeHours < 3) throw new Error("--min-age-hours must be at least 3.");

  const result = await sweepPostImageOrphans({ apply, minAgeHours });
  const bytes = result.orphans.reduce((n, o) => n + (o.size ?? 0), 0);
  console.log(
    JSON.stringify(
      {
        environment: storageEnv,
        mode: apply ? "apply" : "dry-run",
        objects: result.objects,
        referencedPaths: result.referenced,
        orphans: { minAgeHours, count: result.orphans.length, bytes, paths: result.orphans.slice(0, 50).map((o) => o.path) },
        recentUnreferenced: result.recentUnreferenced.length,
        unknownAgeUnreferenced: result.unknownAgeUnreferenced.length,
        unrecognizedPath: { count: result.unrecognizedPath.length, paths: result.unrecognizedPath.slice(0, 20).map((o) => o.path) },
        messageImageRefs: result.messageRefs,
        deleted: result.deleted,
        failed: result.failed,
      },
      null,
      1,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
