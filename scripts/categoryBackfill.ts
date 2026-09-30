// Category backfill for migration 20261018000000_add_post_category_code.
//
//   Dry run (default, read-only -- SELECTs only, works before the migration):
//     npx tsx --env-file=.env.preview.local scripts/categoryBackfill.ts [--out report.json]
//   Apply (after the migration has been applied to that same database):
//     npx tsx --env-file=.env.preview.local scripts/categoryBackfill.ts --apply
//
// Apply writes only:
//   - categoryCode for posts whose legacy category maps 1:1 and whose
//     suggestion doesn't disagree (planCategoryMigration's autoCategoryCode),
//     and only where categoryCode IS NULL -- never overwrites a value;
//   - one PostCategoryReview row per post (the suggestion as a candidate,
//     the review reason) -- ON CONFLICT DO NOTHING, so re-running is safe.
// It never writes `subcategory`, never touches the legacy `category`
// column, and never maps legacy "기타" to anything.
//
// Preview only: refuses to run unless DATABASE_URL, the Supabase URL and the
// service-role key all point at the Preview project.
import { writeFileSync } from "node:fs";

import { prisma } from "@/lib/db/prisma";
import { CATEGORY_SUGGESTER_VERSION, planCategoryMigration, type CategoryMigrationPlan } from "@/lib/posts/categoryMigration";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const PRODUCTION_REF = "tmifqtyxojtuoejxjrng";

function assertPreviewOnly() {
  const db = process.env.DATABASE_URL ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let keyRef = "";
  try {
    keyRef = JSON.parse(Buffer.from((process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").split(".")[1] ?? "", "base64").toString("utf8")).ref ?? "";
  } catch {
    keyRef = "";
  }
  if (!(db.includes(PREVIEW_REF) && url.includes(PREVIEW_REF) && keyRef === PREVIEW_REF) || [db, url, keyRef].some((v) => v.includes(PRODUCTION_REF))) {
    throw new Error("Refusing to run: this script is Preview-only (use --env-file=.env.preview.local).");
  }
}

type Board = "lost" | "found";
type Row = { id: number; title: string; description: string | null; category: string };
type PlannedPost = { board: Board; id: number; title: string; plan: CategoryMigrationPlan };

async function loadPosts(): Promise<PlannedPost[]> {
  // Only pre-migration columns, so the dry run works on a DB without the new ones.
  const [lost, found] = await Promise.all([
    prisma.$queryRaw<Row[]>`SELECT id, title, description, category FROM "LostPost" ORDER BY id`,
    prisma.$queryRaw<Row[]>`SELECT id, title, description, category FROM "FoundPost" ORDER BY id`,
  ]);
  const plan = (board: Board) => (row: Row): PlannedPost => ({ board, id: row.id, title: row.title, plan: planCategoryMigration(row) });
  return [...lost.map(plan("lost")), ...found.map(plan("found"))];
}

function summarize(posts: PlannedPost[]) {
  const count = <K extends string>(keys: K[]) => keys.reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
  const auto = posts.filter((p) => p.plan.autoCategoryCode !== null);
  const review = posts.filter((p) => p.plan.reviewReason !== null);
  return {
    suggesterVersion: CATEGORY_SUGGESTER_VERSION,
    total: posts.length,
    autoConfirmedCategory: auto.length,
    needsReview: review.length,
    reviewByReason: count(review.map((p) => p.plan.reviewReason!)),
    autoByCategoryCode: count(auto.map((p) => p.plan.autoCategoryCode!)),
    subcategorySuggested: posts.filter((p) => p.plan.suggestion?.subcategory).length,
    subcategoryStored: 0,
    suggestedSubcategory: count(posts.map((p) => p.plan.suggestion?.subcategory ?? `${p.plan.suggestion?.category ?? "none"}.(null)`)),
    ambiguities: count(posts.flatMap((p) => p.plan.ambiguities)),
  };
}

async function apply(posts: PlannedPost[]) {
  const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'PostCategoryReview') AS exists
  `;
  if (!exists) throw new Error("Migration 20261018000000_add_post_category_code is not applied to this database.");

  let updated = 0;
  let inserted = 0;
  await prisma.$transaction(async (tx) => {
    for (const { board, id, plan } of posts) {
      const table = board === "lost" ? `"LostPost"` : `"FoundPost"`;
      const fk = board === "lost" ? `"lost_post_id"` : `"found_post_id"`;
      if (plan.autoCategoryCode) {
        updated += await tx.$executeRawUnsafe(
          `UPDATE ${table} SET "category_code" = $1 WHERE "id" = $2 AND "category_code" IS NULL`,
          plan.autoCategoryCode,
          id,
        );
      }
      inserted += await tx.$executeRawUnsafe(
        `INSERT INTO "PostCategoryReview"
           (${fk}, "legacy_category", "suggested_category_code", "suggested_subcategory", "suggestion_source",
            "suggester_version", "review_reason", "ambiguities", "updated_at")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], CURRENT_TIMESTAMP)
         ON CONFLICT (${fk}) DO NOTHING`,
        id,
        plan.legacyCategory,
        plan.suggestion?.category ?? null,
        plan.suggestion?.subcategory ?? null,
        plan.suggestion?.source ?? null,
        CATEGORY_SUGGESTER_VERSION,
        plan.reviewReason,
        plan.ambiguities,
      );
    }
  }, { timeout: 120_000 });
  console.log(JSON.stringify({ categoryCodeUpdated: updated, reviewRowsInserted: inserted }));
}

async function main() {
  assertPreviewOnly();
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const posts = await loadPosts();
  console.log(JSON.stringify(summarize(posts), null, 1));
  if (outIndex >= 0 && args[outIndex + 1]) {
    writeFileSync(args[outIndex + 1], JSON.stringify(posts, null, 1));
    console.log(`plans written to ${args[outIndex + 1]}`);
  }
  if (args.includes("--apply")) await apply(posts);
  else console.log("dry run -- nothing written");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
