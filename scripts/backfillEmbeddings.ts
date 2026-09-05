// One-off backfill: generates embeddings for existing posts where
// embedding IS NULL (created before Phase 6, or whose creation-time
// embedding attempt failed -- see src/lib/ai/postEmbedding.ts's Option B
// policy). Safe to re-run: only ever touches rows with a null embedding,
// never overwrites an existing one, never deletes/modifies any other
// column. Run with: npx tsx scripts/backfillEmbeddings.ts
import { prisma } from "@/lib/db/prisma";
import { embedPostBestEffort } from "@/lib/ai/postEmbedding";

async function main() {
  const [lostPosts, foundPosts] = await Promise.all([
    prisma.$queryRaw<{ id: number; title: string; description: string; category: string; location: string }[]>`
      SELECT id, title, description, category, location FROM "LostPost" WHERE embedding IS NULL
    `,
    prisma.$queryRaw<{ id: number; title: string; description: string; category: string; location: string }[]>`
      SELECT id, title, description, category, location FROM "FoundPost" WHERE embedding IS NULL
    `,
  ]);

  console.log(`Backfilling ${lostPosts.length} LostPost + ${foundPosts.length} FoundPost row(s)...`);

  for (const post of lostPosts) {
    console.log(`  LostPost ${post.id}: "${post.title}"`);
    await embedPostBestEffort("lost", post.id, post);
  }
  for (const post of foundPosts) {
    console.log(`  FoundPost ${post.id}: "${post.title}"`);
    await embedPostBestEffort("found", post.id, post);
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
