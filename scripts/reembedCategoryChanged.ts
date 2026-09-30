// Step after scripts/categoryFinalize.ts: regenerates the TEXT embedding of
// posts whose legacy `category` (part of buildEmbeddingText -- the input
// structure itself is unchanged, and subcategory is not part of it) was
// rewritten by the category migration, and only when the stored vector is
// provably stale (it no longer matches the current text). Image embeddings
// are never touched. Afterwards, only the recommendation-cache rows that
// involve one of these posts (as source, or as a cached candidate) are
// deleted -- they recompute lazily.
//
//   Dry run (default):  npx tsx --env-file=.env.preview.local scripts/reembedCategoryChanged.ts
//   Apply:              ... --apply
//
// Preview-only guard below.
import { prisma } from "@/lib/db/prisma";
import { buildEmbeddingText, getEmbeddingProvider } from "@/lib/ai/embedding";
import { saveEmbedding } from "@/lib/ai/vectorSearch";

if (!(process.env.DATABASE_URL ?? "").includes("swqvlihgupranzfzjevb") || (process.env.DATABASE_URL ?? "").includes("tmifqtyxojtuoejxjrng")) {
  throw new Error("Preview only");
}

type Row = { b: "lost" | "found"; id: number; title: string; description: string; category: string; location: string | null; legacy_category: string | null; embedding: string };
const cos = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / Math.sqrt(na * nb);
};

async function fingerprints() {
  const [r] = await prisma.$queryRaw<{ img: string; text_all: string }[]>`
    SELECT md5(string_agg(b || id || md5(coalesce(img, '')), ',' ORDER BY b, id)) AS img,
           md5(string_agg(b || id || md5(coalesce(emb, '')), ',' ORDER BY b, id)) AS text_all
    FROM (SELECT 'l' b, id, "imageEmbedding"::text img, embedding::text emb FROM "LostPost"
          UNION ALL SELECT 'f', id, "imageEmbedding"::text, embedding::text FROM "FoundPost") x`;
  return r;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT 'lost' b, p.id, p.title, p.description, p.category, p.location, r.legacy_category, p.embedding::text AS embedding
    FROM "LostPost" p JOIN "PostCategoryReview" r ON r.lost_post_id = p.id
    WHERE r.legacy_category IS DISTINCT FROM p.category AND p.embedding IS NOT NULL
    UNION ALL
    SELECT 'found', p.id, p.title, p.description, p.category, p.location, r.legacy_category, p.embedding::text
    FROM "FoundPost" p JOIN "PostCategoryReview" r ON r.found_post_id = p.id
    WHERE r.legacy_category IS DISTINCT FROM p.category AND p.embedding IS NOT NULL
    ORDER BY 1 DESC, 2`;
  const provider = getEmbeddingProvider();
  const targets: { row: Row; vector: number[]; cosBefore: number }[] = [];
  for (const row of rows) {
    const vector = await provider.embed(buildEmbeddingText(row));
    const cosBefore = cos(JSON.parse(row.embedding), vector);
    if (cosBefore < 0.9999) targets.push({ row, vector, cosBefore });
  }
  const keys = targets.map((t) => `${t.row.b}:${t.row.id}`);

  // Cache rows involving a target: as the source, or among the cached candidates
  // (candidates are always the other board's posts).
  const cache = await prisma.matchCandidateCache.findMany();
  const lostIds = new Set(targets.filter((t) => t.row.b === "lost").map((t) => t.row.id));
  const foundIds = new Set(targets.filter((t) => t.row.b === "found").map((t) => t.row.id));
  const affectedCache = cache.filter((c) => {
    const sourceHit = c.sourceType === "lost" ? lostIds.has(c.sourcePostId) : foundIds.has(c.sourcePostId);
    const candidateBoard = c.sourceType === "lost" ? foundIds : lostIds;
    // Current rows are { scale, ranking: [...] }; rows from before the D3 scale
    // are a bare array (already ignored by the service, see isCurrentScaleRanking).
    const raw = (typeof c.candidates === "string" ? JSON.parse(c.candidates) : c.candidates) as unknown;
    const list = (Array.isArray(raw) ? raw : ((raw as { ranking?: { id: number }[] })?.ranking ?? [])) as { id: number }[];
    const candidateHit = list.some((x) => candidateBoard.has(x.id));
    return sourceHit || candidateHit;
  });

  console.log(JSON.stringify({ legacyChangedWithEmbedding: rows.length, staleTargets: keys.length, targets: keys, cacheRows: cache.length, cacheRowsToInvalidate: affectedCache.map((c) => `${c.sourceType}:${c.sourcePostId}`) }, null, 1));
  if (!apply) { console.log("dry run -- nothing written"); return; }

  const before = await fingerprints();
  for (const t of targets) await saveEmbedding(t.row.b, t.row.id, t.vector);
  if (affectedCache.length) await prisma.matchCandidateCache.deleteMany({ where: { id: { in: affectedCache.map((c) => c.id) } } });
  const after = await fingerprints();

  // Verify: every target now matches its current text; nothing else changed.
  const recheck = await prisma.$queryRaw<{ b: "lost" | "found"; id: number; embedding: string }[]>`
    SELECT 'lost' b, id, embedding::text AS embedding FROM "LostPost" WHERE id = ANY(${[...lostIds]}::int[])
    UNION ALL SELECT 'found', id, embedding::text FROM "FoundPost" WHERE id = ANY(${[...foundIds]}::int[])`;
  const vecByKey = new Map(targets.map((t) => [`${t.row.b}:${t.row.id}`, t.vector]));
  const minCosAfter = Math.min(...recheck.map((r) => cos(JSON.parse(r.embedding), vecByKey.get(`${r.b}:${r.id}`)!)));
  console.log(JSON.stringify({
    reembedded: targets.length,
    minCosToCurrentTextAfter: +minCosAfter.toFixed(6),
    imageEmbeddingsUnchanged: before.img === after.img,
    textEmbeddingsChanged: before.text_all !== after.text_all,
    cacheRowsDeleted: affectedCache.length,
    cacheRowsLeft: await prisma.matchCandidateCache.count(),
  }, null, 1));
}

main().finally(() => prisma.$disconnect());
