// Function Storage C-2: post updates, split out of aiService.ts so the
// route that serves them (/api/posts/[id]) imports nothing from the embedding
// chain -- Turbopack traces that chain's process.cwd()/models path into every
// function importing it. Text re-embedding after an edit is queued by the DB
// trigger (migration 20261124000000_text_embedding_jobs) and run by /api/posts
// (src/lib/ai/textJob.ts). aiService.ts re-exports these for existing callers.
import { custodyInputOf, readCustody } from "./custodySchema";
import { broadcastPostStatus } from "./returns";
import { after } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { isCurrentlySuspended, type ContentActor } from "@/lib/auth/suspension";
import { validateOrganizationPosting } from "@/lib/organization/service";
import { Prisma } from "@/generated/prisma/client";
import type { UpdateFoundPostInput, UpdateLostPostInput } from "./schema";
import {
  AUTHOR_SELECT,
  POST_ORGANIZATION_SELECT,
  FOUND_STATUS_FROM_DB,
  FOUND_STATUS_TO_DB,
  LOST_STATUS_FROM_DB,
  LOST_STATUS_TO_DB,
  toFoundPostDTO,
  toLostPostDTO,
  type FoundPostDTO,
  type LostPostDTO,
  type PostMutationResult,
} from "./service";

// 카테고리 대분류-소분류: the schema derives the legacy `category` from
// categoryCode on every category change (dual-write), so a subcategory-only
// edit still carries `category` -- with the same value the post already
// has. Dropping it keeps the embedding-trigger check below
// (EMBEDDING_INPUT_FIELDS, which includes "category") from re-embedding
// text that didn't change.
function dropUnchangedLegacyCategory<T extends { category?: string }>(input: T, existingCategory: string): T {
  if (input.category === undefined || input.category !== existingCategory) return input;
  const rest = { ...input };
  delete rest.category;
  return rest;
}

// 게시판 상태 변경 이력: an update that sends a status runs in one
// transaction with its history row, so a status change is never saved
// without its record (or the record without the change). The post row is
// locked and its status re-read first, so the recorded "from" is the
// status this update actually replaced, even when two edits race.
type StatusTx = Pick<Prisma.TransactionClient, "lostPost" | "foundPost" | "postStatusChange" | "postReturn" | "$queryRaw">;

export async function updateLostPost(
  id: number,
  actor: ContentActor,
  input: UpdateLostPostInput,
): Promise<PostMutationResult<LostPostDTO>> {
  // Release C (M-1): a suspended account can't rewrite what it already
  // posted either (create was already blocked) -- checked first, from the
  // User row the route re-read for this request.
  if (isCurrentlySuspended(actor)) return { kind: "forbidden", reason: "suspended" };
  const userId = actor.id;
  const existing = await prisma.lostPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden", reason: "not_owner" };

  // Phase 12-7 §4: organizationId is now editable -- omitted means "leave
  // attribution unchanged" (input.organizationId is simply absent, so
  // `rest` below never carries the key and Prisma leaves the column
  // untouched); explicit null means "개인"; a positive integer is
  // re-validated fresh against the *current* user's membership every time
  // (never trusted merely because it matches the post's existing value --
  // the editor might not even be a member of that organization any more).
  // Same validateOrganizationPosting() gate as createLostPost's own.
  if (input.organizationId != null) {
    const check = await validateOrganizationPosting(userId, input.organizationId);
    if (check.kind === "not_found") return { kind: "forbidden", reason: "organization_not_found" };
    if (check.kind === "inactive_organization") return { kind: "forbidden", reason: "organization_inactive" };
    if (check.kind === "forbidden") return { kind: "forbidden", reason: "organization_not_member" };
  }

  const { status, ...rest } = dropUnchangedLegacyCategory(input, existing.category);
  const update = (client: Pick<StatusTx, "lostPost">) =>
    client.lostPost.update({
      where: { id },
      data: {
        ...rest,
        ...(status !== undefined && { status: LOST_STATUS_TO_DB[status] }),
      },
      include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } },
    });
  // 게시판 상태 변경 이력 -- e.g. 찾음 set by mistake and put back.
  const row =
    status === undefined
      ? await update(prisma)
      : await prisma.$transaction(async (tx: StatusTx) => {
          await tx.$queryRaw`SELECT id FROM "LostPost" WHERE id = ${id} FOR UPDATE`;
          const current = await tx.lostPost.findUnique({ where: { id }, select: { status: true } });
          const updated = await update(tx);
          if (current && current.status !== updated.status) {
            await tx.postStatusChange.create({
              data: { postType: "lost", postId: id, fromStatus: LOST_STATUS_FROM_DB[current.status], toStatus: status, changedByUserId: userId, action: "owner_status" },
            });
            // undoing 찾음 ends the chat-room return link (kept, marked revoked)
            if (updated.status !== "FOUND") await tx.postReturn.updateMany({ where: { postType: "lost", postId: id, revokedAt: null }, data: { revokedAt: new Date() } });
          }
          return updated;
        });
  // Only re-embed when a field that actually feeds buildEmbeddingText()
  // changed -- e.g. a status-only update (marking a post found/complete)
  // or an image-only change shouldn't burn an inference call for text
  // that's already correctly embedded.
  //
  // Phase H-5-1: both the re-embed and its cache invalidation move into
  // the same after() callback, in the same relative order they already
  // ran in (embed, then invalidate) -- keeping them together (rather than
  // only deferring embedPostBestEffort) avoids a new race where the stale
  // recommendation-cache row is cleared *before* the new embedding is
  // actually saved, which could let a recommendation lookup that lands in
  // that gap recompute against the old vector and re-cache it. See
  // createLostPost's own comment for why after() (not a bare
  // fire-and-forget promise) is what makes this safe on Vercel.
  // Function Storage C-2: no inline re-embedding here any more. A real change
  // of title/description/category/location queues a TextEmbeddingJob in the
  // same DB transaction (trigger), and the PATCH route asks /api/posts to
  // drain it. The worker saves the new vector and only then invalidates the
  // recommendation cache, keeping the "embed, then invalidate" order above.
  // open chat rooms of the post re-read its state
  if (status !== undefined) after(() => broadcastPostStatus("lost", id));
  return { kind: "ok", data: toLostPostDTO(row) };
}

export async function updateFoundPost(
  id: number,
  actor: ContentActor,
  input: UpdateFoundPostInput,
): Promise<PostMutationResult<FoundPostDTO>> {
  // Release C (M-1): a suspended account can't rewrite what it already
  // posted either (create was already blocked) -- checked first, from the
  // User row the route re-read for this request.
  if (isCurrentlySuspended(actor)) return { kind: "forbidden", reason: "suspended" };
  const userId = actor.id;
  const existing = await prisma.foundPost.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== userId) return { kind: "forbidden", reason: "not_owner" };

  // See updateLostPost's own comment -- identical shape/reasoning.
  if (input.organizationId != null) {
    const check = await validateOrganizationPosting(userId, input.organizationId);
    if (check.kind === "not_found") return { kind: "forbidden", reason: "organization_not_found" };
    if (check.kind === "inactive_organization") return { kind: "forbidden", reason: "organization_inactive" };
    if (check.kind === "forbidden") return { kind: "forbidden", reason: "organization_not_member" };
  }

  // custody is applied explicitly below (null = cleared), never spread.
  const { status, ...fields } = dropUnchangedLegacyCategory(input, existing.category);
  const rest: Omit<typeof fields, "custody"> = { ...fields };
  delete (rest as { custody?: unknown }).custody;
  let currentCustody = existing.custody;
  const update = (client: Pick<StatusTx, "foundPost">) =>
    client.foundPost.update({
      where: { id },
      data: {
        ...rest,
        ...(status !== undefined && { status: FOUND_STATUS_TO_DB[status] }),
        ...((input.custody !== undefined || input.campus !== undefined) && {
          // null: the finder cleared it. A campus-only change re-writes the
          // current finder-entered custody unchanged (기타 keeps its note).
          custody:
            input.custody === null
              ? Prisma.DbNull
              : (input.custody ?? (readCustody(currentCustody) ? custodyInputOf(readCustody(currentCustody)!) : undefined)),
        }),
      },
      include: { user: { select: AUTHOR_SELECT }, organization: { select: POST_ORGANIZATION_SELECT } },
    });
  // 게시판 상태 변경 이력 -- e.g. 완료 set by mistake and put back. See
  // updateLostPost's own comment.
  const row =
    status === undefined && input.custody === undefined && input.campus === undefined
      ? await update(prisma)
      : await prisma.$transaction(async (tx: StatusTx) => {
          await tx.$queryRaw`SELECT id FROM "FoundPost" WHERE id = ${id} FOR UPDATE`;
          const current = await tx.foundPost.findUnique({ where: { id }, select: { status: true, custody: true, custodyOrganizationId: true } });
          if (current?.custodyOrganizationId && (input.custody !== undefined || input.campus !== undefined)) return null;
          currentCustody = current?.custody ?? null;
          const updated = await update(tx);
          if (current && current.status !== updated.status) {
            await tx.postStatusChange.create({
              data: { postType: "found", postId: id, fromStatus: FOUND_STATUS_FROM_DB[current.status], toStatus: FOUND_STATUS_FROM_DB[updated.status], changedByUserId: userId, action: "owner_status" },
            });
            if (updated.status !== "COMPLETED") await tx.postReturn.updateMany({ where: { postType: "found", postId: id, revokedAt: null }, data: { revokedAt: new Date() } });
          }
          if (input.custody !== undefined || input.campus !== undefined) {
            await tx.postStatusChange.create({ data: { postType: "found", postId: id, fromStatus: FOUND_STATUS_FROM_DB[current!.status], toStatus: FOUND_STATUS_FROM_DB[updated.status], changedByUserId: userId, action: "owner_custody", beforeCustody: current!.custody ?? undefined, afterCustody: updated.custody ?? undefined } });
          }
          return updated;
        });
  // Phase H-5-1: see updateLostPost's own comment -- embed + invalidate
  // moved together into after(), same relative order, same failure
  // handling.
  if (!row) return { kind: "forbidden", reason: "custody_managed" };
  // Function Storage C-2: see updateLostPost -- text jobs are queued by the DB trigger.
  if (!row) return { kind: "forbidden", reason: "custody_managed" };
  if (status !== undefined) after(() => broadcastPostStatus("found", id));
  return { kind: "ok", data: toFoundPostDTO(row) };
}
