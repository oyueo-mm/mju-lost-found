// Final category migration: gives every post a confirmed categoryCode AND
// subcategory, re-derives the legacy `category` from the code (dual-write),
// and closes every PostCategoryReview row.
//
//   Plan only (default, read-only):
//     npx tsx --env-file=.env.preview.local scripts/categoryFinalize.ts --overrides <file> [--out plan.json]
//   Apply (needs migration 20261019000000_add_post_category_review_resolution):
//     ... --apply
//
// The final value of a post is its manual override when one exists, else the
// suggestCategory() result -- which must then name a subcategory, otherwise
// the plan refuses to run (add an override for that post). Legacy 기타 is
// never bulk-mapped: it only moves where its own suggestion or override says.
//
// Apply writes only category / category_code / subcategory on the posts (a
// raw UPDATE, so updated_at and every other column stay as they are) and the
// review rows: refreshed suggestion, resolved_*, status (accepted = final
// equals the suggestion, overridden = a different value was chosen) and
// resolution_method (auto = the title-based suggestion confirmed as-is,
// manual = a person had to decide -- see isManual()).
//
// Preview only: refuses to run unless DATABASE_URL, the Supabase URL and the
// service-role key all point at the Preview project.
import { readFileSync, writeFileSync } from "node:fs";

import { prisma } from "@/lib/db/prisma";
import { CATEGORY_SUGGESTER_VERSION, LEGACY_CATEGORY_TO_CODE, planCategoryMigration } from "@/lib/posts/categoryMigration";
import { CATEGORY_CODE_TO_LEGACY } from "@/lib/posts/categoryWrite";
import {
  SUBCATEGORY_CODES,
  isOtherSubcategory,
  isSubcategoryCode,
  parentCategoryOf,
  validateCategorySelection,
  type CategoryCode,
  type SubcategoryCode,
} from "@/lib/posts/categoryTaxonomy";

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
type Row = {
  id: number;
  title: string;
  description: string;
  category: string;
  category_code: string | null;
  subcategory: string | null;
  // From the post's PostCategoryReview row (the backfill's snapshot); null
  // when the post has none yet.
  legacy_category: string | null;
  review_reason: string | null;
};
type Override = { subcategory: string; reason: string };

export type FinalPlan = {
  key: string;
  board: Board;
  id: number;
  title: string;
  before: { category: string; categoryCode: string | null; subcategory: string | null };
  after: { category: string; categoryCode: CategoryCode; subcategory: SubcategoryCode };
  suggestion: { category: string; subcategory: string | null; source: string } | null;
  reviewReason: string | null;
  ambiguities: string[];
  override: string | null;
  status: "accepted" | "overridden";
  resolutionMethod: "auto" | "manual";
  // The main category the post had before (its code, or the legacy 1:1 code)
  // differs from the final one.
  mainCategoryChanged: boolean;
};

function plan(board: Board, row: Row, overrides: Record<string, Override>): FinalPlan {
  const key = `${board}:${row.id}`;
  // Plan from the snapshot the backfill stored (legacy category and why the
  // post needed review), never from the post's current category -- which
  // this script itself rewrites, so a re-run would otherwise see e.g. a
  // former 기타 post as an ordinary 1:1 one and re-mark it "auto".
  const legacyCategory = row.legacy_category ?? row.category;
  const p = planCategoryMigration({ ...row, category: legacyCategory });
  const reviewReason = row.review_reason ?? p.reviewReason;
  const override = overrides[key];
  const chosen = override?.subcategory ?? p.suggestion?.subcategory ?? null;
  if (!isSubcategoryCode(chosen)) throw new Error(`${key} "${row.title}": no subcategory -- add an override`);
  const categoryCode = parentCategoryOf(chosen);
  const check = validateCategorySelection(categoryCode, chosen);
  if (!check.ok) throw new Error(`${key}: ${check.error}`);

  const suggestedSub = p.suggestion?.subcategory ?? null;
  const status = suggestedSub === chosen ? "accepted" : "overridden";
  const manual =
    override !== undefined ||
    reviewReason !== null ||
    p.suggestion === null ||
    suggestedSub === null ||
    p.suggestion.source === "description";
  // The main category the author originally chose (legacy 1:1 code; null for 기타).
  const previousMain = LEGACY_CATEGORY_TO_CODE[legacyCategory.trim()] ?? null;

  return {
    key,
    board,
    id: row.id,
    title: row.title,
    before: { category: legacyCategory, categoryCode: row.category_code, subcategory: row.subcategory },
    after: { category: CATEGORY_CODE_TO_LEGACY[categoryCode], categoryCode, subcategory: chosen },
    suggestion: p.suggestion,
    reviewReason,
    ambiguities: p.ambiguities,
    override: override?.reason ?? null,
    status,
    resolutionMethod: manual ? "manual" : "auto",
    mainCategoryChanged: previousMain !== categoryCode,
  };
}

async function loadRows() {
  const [lost, found] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT p.id, p.title, p.description, p.category, p.category_code, p.subcategory, r.legacy_category, r.review_reason
      FROM "LostPost" p LEFT JOIN "PostCategoryReview" r ON r.lost_post_id = p.id ORDER BY p.id`,
    prisma.$queryRaw<Row[]>`
      SELECT p.id, p.title, p.description, p.category, p.category_code, p.subcategory, r.legacy_category, r.review_reason
      FROM "FoundPost" p LEFT JOIN "PostCategoryReview" r ON r.found_post_id = p.id ORDER BY p.id`,
  ]);
  return { lost, found };
}

function report(plans: FinalPlan[], overrides: Record<string, Override>) {
  const count = (keys: string[]) => keys.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {});
  const unusedOverrides = Object.keys(overrides).filter((k) => !k.startsWith("_") && !plans.some((p) => p.key === k));
  const bySub = count(plans.map((p) => p.after.subcategory));
  return {
    suggesterVersion: CATEGORY_SUGGESTER_VERSION,
    total: plans.length,
    byCategoryCode: count(plans.map((p) => p.after.categoryCode)),
    bySubcategory: bySub,
    // Subcategories no post landed in (informational -- the taxonomy is not
    // sized to this data set).
    subcategoriesWithoutPosts: SUBCATEGORY_CODES.filter((code) => !bySub[code]),
    status: count(plans.map((p) => p.status)),
    resolutionMethod: count(plans.map((p) => p.resolutionMethod)),
    legacyCategoryChanged: plans.filter((p) => p.before.category !== p.after.category).length,
    unusedOverrides,
    legacyOtherMovedTo: count(plans.filter((p) => p.before.category === "기타").map((p) => p.after.subcategory)),
    mainCategoryChanged: plans
      .filter((p) => p.mainCategoryChanged && p.before.category !== "기타")
      .map((p) => `${p.key} ${p.before.category} -> ${p.after.subcategory} | ${p.title}`),
    otherSubcategory: plans.filter((p) => isOtherSubcategory(p.after.subcategory)).map((p) => `${p.key} ${p.after.subcategory} | ${p.title}`),
    overridden: plans.filter((p) => p.status === "overridden").map((p) => `${p.key} ${p.suggestion?.subcategory ?? p.suggestion?.category ?? "none"} -> ${p.after.subcategory} | ${p.title}`),
  };
}

async function apply(plans: FinalPlan[]) {
  const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PostCategoryReview' AND column_name = 'resolution_method') AS exists
  `;
  if (!exists) throw new Error("Migration 20261019000000_add_post_category_review_resolution is not applied to this database.");

  let posts = 0;
  let reviews = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const p of plans) {
        const table = p.board === "lost" ? `"LostPost"` : `"FoundPost"`;
        const fk = p.board === "lost" ? `"lost_post_id"` : `"found_post_id"`;
        posts += await tx.$executeRawUnsafe(
          `UPDATE ${table} SET "category" = $1, "category_code" = $2, "subcategory" = $3
           WHERE "id" = $4 AND ("category", "category_code", "subcategory") IS DISTINCT FROM ($1, $2, $3)`,
          p.after.category,
          p.after.categoryCode,
          p.after.subcategory,
          p.id,
        );
        const updated = await tx.$executeRawUnsafe(
          `UPDATE "PostCategoryReview" SET
             "suggested_category_code" = $2, "suggested_subcategory" = $3, "suggestion_source" = $4,
             "suggester_version" = $5, "ambiguities" = $6::text[],
             "status" = $7, "resolution_method" = $8,
             "resolved_category_code" = $9, "resolved_subcategory" = $10,
             "reviewed_at" = COALESCE("reviewed_at", CURRENT_TIMESTAMP), "updated_at" = CURRENT_TIMESTAMP
           WHERE ${fk} = $1 AND (
             "status", "resolution_method", "resolved_category_code", "resolved_subcategory", "suggested_subcategory", "suggester_version"
           ) IS DISTINCT FROM ($7, $8, $9, $10, $3, $5)`,
          p.id,
          p.suggestion?.category ?? null,
          p.suggestion?.subcategory ?? null,
          p.suggestion?.source ?? null,
          CATEGORY_SUGGESTER_VERSION,
          p.ambiguities,
          p.status,
          p.resolutionMethod,
          p.after.categoryCode,
          p.after.subcategory,
        );
        reviews += updated;
        if (updated === 0) {
          // Either already up to date, or the post has no review row yet (created after the backfill).
          await tx.$executeRawUnsafe(
            `INSERT INTO "PostCategoryReview"
               (${fk}, "legacy_category", "suggested_category_code", "suggested_subcategory", "suggestion_source",
                "suggester_version", "review_reason", "ambiguities", "status", "resolution_method",
                "resolved_category_code", "resolved_subcategory", "reviewed_at", "updated_at")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (${fk}) DO NOTHING`,
            p.id,
            p.before.category,
            p.suggestion?.category ?? null,
            p.suggestion?.subcategory ?? null,
            p.suggestion?.source ?? null,
            CATEGORY_SUGGESTER_VERSION,
            p.reviewReason,
            p.ambiguities,
            p.status,
            p.resolutionMethod,
            p.after.categoryCode,
            p.after.subcategory,
          );
        }
      }
    },
    { timeout: 180_000 },
  );
  console.log(JSON.stringify({ postsUpdated: posts, reviewRowsUpdated: reviews }));
}

async function main() {
  assertPreviewOnly();
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const overridesFile = arg("--overrides");
  if (!overridesFile) throw new Error("--overrides <file> is required");
  const overrides: Record<string, Override> = JSON.parse(readFileSync(overridesFile, "utf8"));
  const { lost, found } = await loadRows();
  const plans = [...lost.map((r) => plan("lost", r, overrides)), ...found.map((r) => plan("found", r, overrides))];
  console.log(JSON.stringify(report(plans, overrides), null, 1));
  const out = arg("--out");
  if (out) writeFileSync(out, JSON.stringify(plans, null, 1));
  if (args.includes("--apply")) await apply(plans);
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
