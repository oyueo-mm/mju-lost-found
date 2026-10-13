import { prisma } from "@/lib/db/prisma";
import type { PostType } from "./schema";

// 연속 등록 ("다음 습득물 등록"): after a post is created, the next one can
// start from the same campus and 게시 주체 -- the parts that stay the same
// when one office registers a batch of items. Nothing about the item
// itself (title, description, category, place, date, photos) is carried
// over, so two items' details can't run into each other.
export type NextPostDefaults = { campus: string; organizationId: number | null };

// `afterParam` is the ?after=<post id> the post page's "다음 등록" link
// adds. Only the poster's own post counts, and its organization only if the
// poster can still post as it (one of `myOrganizations`, the same ACTIVE
// memberships the form offers) -- anything else falls back to the form's
// normal defaults.
export async function loadNextPostDefaults(
  type: PostType,
  afterParam: string | undefined,
  userId: number,
  myOrganizations: readonly { organizationId: number }[],
): Promise<NextPostDefaults | null> {
  const id = Number(afterParam);
  if (!afterParam || !Number.isSafeInteger(id) || id <= 0) return null;

  const where = { id, userId };
  const select = { campus: true, organizationId: true } as const;
  const previous =
    type === "lost"
      ? await prisma.lostPost.findFirst({ where, select })
      : await prisma.foundPost.findFirst({ where, select });
  if (!previous) return null;

  const organizationId =
    previous.organizationId != null && myOrganizations.some((m) => m.organizationId === previous.organizationId)
      ? previous.organizationId
      : null;
  return { campus: previous.campus, organizationId };
}
