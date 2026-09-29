// Read-only check of how the 분실/습득 시점 period filter interacts with the
// pgvector search on the Preview DB. For several period windows it compares
// the number of posts actually inside the window, what the app's
// findPostsBySemanticQuery() returns (top 10), and the exact filtered
// top 10 (same query in a read-only transaction with index scans disabled,
// i.e. a full scan). Also reports whether Postgres chose the HNSW index,
// and what the same query returns when the HNSW index is forced
// (enable_seqscan = off) -- the plan a larger table gets, where pgvector
// filters the index scan's nearest candidates (hnsw.ef_search, default 40)
// instead of searching only inside the period.
// Writes nothing.
// Run with: npx tsx --env-file=.env.preview.local scripts/ai-eval-seed/check-period-vector-search.ts
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getEmbeddingProvider } from "@/lib/ai/embedding";
import { eventTimeCondition, findPostsBySemanticQuery } from "@/lib/ai/vectorSearch";
import { kstDateOnly, resolveEventRange } from "@/lib/posts/eventPeriod";

const PREVIEW_REF = "swqvlihgupranzfzjevb";
const TOP_K = 10;
const QUERIES = ["검은색 지갑 잃어버렸어요", "무선 이어폰", "우산"];

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes(PREVIEW_REF)) throw new Error("Refusing to run: not the Preview DB.");
  const embed = getEmbeddingProvider();

  // Anchor windows on the newest found_at in the data, so they are narrow
  // but not empty.
  const [{ newest }] = await prisma.$queryRaw<{ newest: Date }[]>`SELECT max(found_at) AS newest FROM "FoundPost"`;
  const day = (offset: number) => kstDateOnly(new Date(newest.getTime() - offset * 24 * 3600_000));
  const windows: { label: string; from: string; to: string }[] = [
    { label: "1 day", from: day(0), to: day(0) },
    { label: "3 days", from: day(2), to: day(0) },
    { label: "1 week", from: day(6), to: day(0) },
    { label: "2 weeks", from: day(13), to: day(0) },
    { label: "all time", from: "2000-01-01", to: day(0) },
  ];

  for (const q of QUERIES) {
    const vector = await embed.embed(q);
    const literal = `[${vector.join(",")}]`;
    for (const w of windows) {
      for (const includeUnknown of [false, true]) {
        const range = resolveEventRange({ period: "custom", from: w.from, to: w.to })!;
        const filters = { eventFrom: range.from, eventTo: range.to, includeUnknownEventTime: includeUnknown };
        const condition = eventTimeCondition("found", filters)!;

        const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>(
          Prisma.sql`SELECT count(*) AS n FROM "FoundPost" WHERE embedding IS NOT NULL AND ${condition}`,
        );
        const inWindow = Number(n);
        const app = await findPostsBySemanticQuery("found", vector, TOP_K, filters);

        const querySql = Prisma.sql`SELECT id FROM "FoundPost" WHERE embedding IS NOT NULL AND ${condition}
          ORDER BY embedding <=> ${literal}::vector, id LIMIT ${TOP_K}`;
        const plan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`EXPLAIN ${querySql}`);
        const usesHnsw = plan.some((r) => /hnsw/i.test(r["QUERY PLAN"]));

        const exact = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL enable_indexscan = off`;
          return tx.$queryRaw<{ id: number }[]>(querySql);
        });

        const forced = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
          const forcedPlan = await tx.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`EXPLAIN ${querySql}`);
          const rows = await tx.$queryRaw<{ id: number }[]>(querySql);
          return { rows, hnsw: forcedPlan.some((r) => /hnsw/i.test(r["QUERY PLAN"])) };
        });

        const expected = Math.min(TOP_K, inWindow);
        console.log(
          `${q.padEnd(16)} | ${w.label.padEnd(8)} | unknown ${includeUnknown ? "incl" : "excl"} | in window ${String(inWindow).padStart(3)} | app ${String(app.length).padStart(2)} | exact ${String(exact.length).padStart(2)} | expected ${String(expected).padStart(2)} | hnsw ${usesHnsw} | ${app.length < expected ? "SHORTFALL" : "ok"} | forced-hnsw(${forced.hnsw}) ${String(forced.rows.length).padStart(2)}${forced.rows.length < expected ? " SHORTFALL" : ""}`,
        );
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
