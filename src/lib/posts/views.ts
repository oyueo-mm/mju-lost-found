"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { isBotUserAgent } from "@/lib/metrics/visits";
import type { PostType } from "./schema";

const ANON_COOKIE_NAME = "anon_uid";
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year -- long-lived viewer identity, not a session cookie

// Logged-in viewers are keyed by their real User.id (stable across
// devices/browsers); logged-out viewers get a long-lived random cookie
// instead, since this app's read paths are intentionally public/no-auth
// (posts/service.ts) and there is no other per-browser identity to key on.
// Minting/reading that cookie is why this whole module is a Server Action
// rather than a plain function called from the post detail page's own
// render: Next.js only allows `cookies().set()` from a Server Action or
// Route Handler, never a Server Component's render (see ViewTracker.tsx).
async function resolveViewerKey(): Promise<string> {
  const user = await getCurrentUser();
  if (user) return `u:${user.id}`;

  const cookieStore = await cookies();
  const existing = cookieStore.get(ANON_COOKIE_NAME)?.value;
  if (existing) return `a:${existing}`;

  const id = randomUUID();
  cookieStore.set(ANON_COOKIE_NAME, id, {
    maxAge: ANON_COOKIE_MAX_AGE,
    sameSite: "lax",
    path: "/",
  });
  return `a:${id}`;
}

// Fire-and-forget from ViewTracker's client-side effect -- never throws
// back to the caller (a failed view-count bump is not something a viewer
// should ever see an error for), never calls revalidatePath/revalidateTag
// (the count updates on the *next* load, not the current one -- this is a
// deliberate trade-off so recording a view never triggers a page refetch
// of the page the viewer is already looking at).
//
// Phase L: a given viewerKey now counts at most once per post, ever --
// no time window (the previous 30-minute dedup window let the same viewer
// re-trigger the count after it lapsed, which this phase's spec explicitly
// rules out: "동일 게시글에 최대 1회만 증가"). The PostView row's mere
// existence for (postType, postId, viewerKey) is now the only signal
// needed, so this reads as a plain existence check followed by a plain
// insert -- no upsert, no viewedAt comparison.
export async function recordPostViewAction(type: PostType, postId: number): Promise<void> {
  try {
    // 조회순 정렬: a crawler that runs scripts (it renders the page like a
    // browser) must not count as a reader. Same filter as 방문 통계.
    if (isBotUserAgent((await headers()).get("user-agent"))) return;
    const viewerKey = await resolveViewerKey();

    const existing = await prisma.postView.findUnique({
      where: { postType_postId_viewerKey: { postType: type, postId, viewerKey } },
    });
    if (existing) return;

    await prisma.$transaction(async (tx) => {
      // A plain SQL increment, not prisma.<post>.update(): Prisma's
      // @updatedAt would stamp updated_at on every new view, so a post's
      // "수정일" would become its last view time. `view_count + 1` runs in
      // the DB -- never a read-then-write -- so concurrent viewers never lose
      // an increment. updated_at stays the time of the last real edit.
      const bumped =
        type === "lost"
          ? await tx.$executeRaw`UPDATE "LostPost" SET "view_count" = "view_count" + 1 WHERE "id" = ${postId}`
          : await tx.$executeRaw`UPDATE "FoundPost" SET "view_count" = "view_count" + 1 WHERE "id" = ${postId}`;
      // No such post (deleted meanwhile): record nothing, as before.
      if (bumped === 0) throw new Error(`no ${type} post ${postId}`);
      // `create` (not `upsert`) is what makes the one race this can't
      // observe from a single SELECT -- the same viewer firing this twice
      // at the same instant, before either request's SELECT above sees the
      // other's not-yet-committed row -- fail safely instead of double-
      // counting: the loser's create() hits the unique constraint on
      // (postType, postId, viewerKey), its whole transaction (increment
      // included) rolls back, and the catch below just logs it. The
      // increment on the winning transaction still lands exactly once.
      await tx.postView.create({ data: { postType: type, postId, viewerKey } });
    });
  } catch (error) {
    // Two expected causes, both silent by design: the post was deleted
    // between page load and this background call firing, or the same
    // viewer's own duplicate create() lost the unique-constraint race
    // above. Never surfaced to the viewer either way.
    console.error("Failed to record post view", error);
  }
}
