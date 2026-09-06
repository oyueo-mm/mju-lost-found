// Phase 23 demo seed: view counts + comments for the competition demo.
// Safe to re-run: comments are matched by exact (post, author, content)
// before inserting (skips if already present, never duplicates), and
// view counts are a plain SET to a fixed demo value (re-running just
// re-asserts the same baseline, it doesn't keep incrementing).
//
// Deliberately does not invent new LostPost/FoundPost rows -- this
// database only has the two real posts created during earlier phases'
// testing (id 6 lost, id 36 found), and inventing synthetic posts would
// mean running them through the real embedding pipeline just for demo
// data. Comments are attributed to this project's own existing real
// accounts (all developer/tester logins from earlier phases, not
// uninvolved third parties), matching this phase's own request for a
// realistic-looking but honestly-synthetic demo thread.
//
// Run with: npx tsx --env-file=.env scripts/seedPhase23Demo.ts
import { prisma } from "@/lib/db/prisma";

async function upsertComment(
  lostPostId: number | null,
  foundPostId: number | null,
  authorUserId: number,
  content: string,
) {
  const where = lostPostId !== null ? { lostPostId, authorUserId, content } : { foundPostId, authorUserId, content };
  const existing = await prisma.comment.findFirst({ where });
  if (existing) {
    console.log(`  (skip, already exists) "${content.slice(0, 20)}..."`);
    return;
  }
  await prisma.comment.create({ data: { lostPostId, foundPostId, authorUserId, content } });
  console.log(`  created: "${content.slice(0, 20)}..."`);
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 4 });
  if (users.length === 0) {
    console.log("No users found -- nothing to attribute demo comments to. Skipping.");
    return;
  }
  const [u1, u2 = u1, u3 = u1] = users;

  const lostPost = await prisma.lostPost.findFirst({ orderBy: { id: "asc" } });
  const foundPost = await prisma.foundPost.findFirst({ orderBy: { id: "asc" } });

  if (lostPost) {
    console.log(`LostPost ${lostPost.id}: setting viewCount=24, adding 3 demo comments`);
    await prisma.lostPost.update({ where: { id: lostPost.id }, data: { viewCount: 24 } });
    await upsertComment(lostPost.id, null, u1.id, "혹시 도서관 2층에서 잃어버리신 건가요?");
    await upsertComment(lostPost.id, null, u2.id, "비슷한 물건을 봤어요.");
    await upsertComment(lostPost.id, null, u3.id, "학생회관 근처에서도 비슷한 걸 본 것 같아요!");
  }

  if (foundPost) {
    // Deliberately 0 comments here -- this phase's spec asks for some
    // posts with none, to exercise CommentSection's empty state too.
    console.log(`FoundPost ${foundPost.id}: setting viewCount=8, no comments (empty-state coverage)`);
    await prisma.foundPost.update({ where: { id: foundPost.id }, data: { viewCount: 8 } });
  }

  console.log("Done.");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
