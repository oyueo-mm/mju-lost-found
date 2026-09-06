"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import type { PostType } from "./schema";

const ANON_COOKIE_NAME = "anon_uid";
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year -- long-lived viewer identity, not a session cookie
// How long a repeat view from the *same* viewer is ignored for -- covers
// exactly the "새로고침 / 뒤로 갔다 다시 들어오기" repeat-view pattern this
// phase's spec calls out, without needing per-viewer history beyond the
// single most recent timestamp.
const VIEW_DEDUP_WINDOW_MS = 30 * 60 * 1000;

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
export async function recordPostViewAction(type: PostType, postId: number): Promise<void> {
  try {
    const viewerKey = await resolveViewerKey();
    const now = new Date();

    const existing = await prisma.postView.findUnique({
      where: { postType_postId_viewerKey: { postType: type, postId, viewerKey } },
    });
    if (existing && now.getTime() - existing.viewedAt.getTime() < VIEW_DEDUP_WINDOW_MS) {
      return;
    }

    await prisma.$transaction([
      prisma.postView.upsert({
        where: { postType_postId_viewerKey: { postType: type, postId, viewerKey } },
        create: { postType: type, postId, viewerKey, viewedAt: now },
        update: { viewedAt: now },
      }),
      // `{ increment: 1 }` compiles to `SET view_count = view_count + 1`
      // at the DB level -- never a read-then-write in application code --
      // so two genuinely concurrent viewers (different viewerKeys) never
      // lose an increment to a race. The one race this doesn't close (the
      // *same* viewer firing this twice within the same instant, before
      // either request's SELECT above sees the other's not-yet-committed
      // upsert) is an accepted trade-off for a view counter, not a
      // correctness requirement this phase asks for -- see this phase's
      // report.
      type === "lost"
        ? prisma.lostPost.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } })
        : prisma.foundPost.update({ where: { id: postId }, data: { viewCount: { increment: 1 } } }),
    ]);
  } catch (error) {
    // Most likely cause: the post was deleted between page load and this
    // background call firing. Never surfaced to the viewer either way.
    console.error("Failed to record post view", error);
  }
}
