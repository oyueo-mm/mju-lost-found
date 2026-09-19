import { prisma } from "@/lib/db/prisma";
import {
  FeedbackCategory as PrismaFeedbackCategory,
  FeedbackStatus as PrismaFeedbackStatus,
  NotificationType as PrismaNotificationType,
  type User,
} from "@/generated/prisma/client";
import { isAdmin } from "@/lib/moderation/service";
import { fanOutToAdmins } from "@/lib/notification/adminFanout";
import type { CreateFeedbackInput, FeedbackCategoryValue, FeedbackStatusValue, UpdateFeedbackStatusInput } from "./schema";
import { FEEDBACK_CATEGORY_LABELS } from "./schema";

// Phase 11-5: "서비스 개선 제안" -- deliberately separate from Report (see
// schema.prisma's own comment on the Feedback model for why). Every
// function here either scopes to the caller's own userId (createFeedback,
// getMyFeedback) or re-checks isAdmin() itself (the *ForAdmin functions),
// the same "never trust the page-level gate alone" rule every other admin
// service module in this app (moderation/service.ts, announcement/
// service.ts) already follows.

const CATEGORY_TO_DB: Record<FeedbackCategoryValue, PrismaFeedbackCategory> = {
  feature_request: PrismaFeedbackCategory.FEATURE_REQUEST,
  inconvenience: PrismaFeedbackCategory.INCONVENIENCE,
  bug: PrismaFeedbackCategory.BUG,
  other: PrismaFeedbackCategory.OTHER,
};
const CATEGORY_FROM_DB: Record<PrismaFeedbackCategory, FeedbackCategoryValue> = {
  FEATURE_REQUEST: "feature_request",
  INCONVENIENCE: "inconvenience",
  BUG: "bug",
  OTHER: "other",
};
const STATUS_TO_DB: Record<FeedbackStatusValue, PrismaFeedbackStatus> = {
  received: PrismaFeedbackStatus.RECEIVED,
  in_review: PrismaFeedbackStatus.IN_REVIEW,
  planned: PrismaFeedbackStatus.PLANNED,
  completed: PrismaFeedbackStatus.COMPLETED,
  not_planned: PrismaFeedbackStatus.NOT_PLANNED,
};
const STATUS_FROM_DB: Record<PrismaFeedbackStatus, FeedbackStatusValue> = {
  RECEIVED: "received",
  IN_REVIEW: "in_review",
  PLANNED: "planned",
  COMPLETED: "completed",
  NOT_PLANNED: "not_planned",
};

export type FeedbackDTO = {
  id: number;
  category: FeedbackCategoryValue;
  title: string;
  content: string;
  status: FeedbackStatusValue;
  createdAt: Date;
  updatedAt: Date;
};

// Admin-only view -- adds the submitter's identity and the admin-only note,
// neither of which getMyFeedback()/createFeedback() below ever return to
// the submitting user themselves.
export type FeedbackAdminDTO = FeedbackDTO & {
  adminNote: string | null;
  author: { id: number; nickname: string | null; publicId: string };
};

type FeedbackRow = {
  id: number;
  category: PrismaFeedbackCategory;
  title: string;
  content: string;
  status: PrismaFeedbackStatus;
  createdAt: Date;
  updatedAt: Date;
};

function toFeedbackDTO(row: FeedbackRow): FeedbackDTO {
  return {
    id: row.id,
    category: CATEGORY_FROM_DB[row.category],
    title: row.title,
    content: row.content,
    status: STATUS_FROM_DB[row.status],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFeedbackAdminDTO(
  row: FeedbackRow & { adminNote: string | null; user: { id: number; nickname: string | null; publicId: string } },
): FeedbackAdminDTO {
  return { ...toFeedbackDTO(row), adminNote: row.adminNote, author: row.user };
}

export type FeedbackMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  // Phase 반영 완료 잠금: this Feedback's status is already `completed` and
  // the caller asked to change it to something else -- terminal, rejected
  // regardless of who's asking or how (see updateFeedbackStatus()'s own
  // comment). Requesting `completed` again on an already-completed row is
  // NOT this -- that's the allowed idempotent no-op branch, "ok".
  | { kind: "locked" };

// Login required -- enforced by the caller (requireUser(), see
// feedback/actions.ts), not here; this function itself has no anonymous
// path at all (`user.id` is always a real, server-verified session, never
// client-suppliable -- same "server derives ownership from the session,
// never trusts a client-passed userId" rule this app already follows
// everywhere else, e.g. posts/service.ts's create*Post).
export async function createFeedback(user: User, input: CreateFeedbackInput): Promise<FeedbackMutationResult<FeedbackDTO>> {
  // Phase 12-9 §2: create + admin fan-out in one transaction -- see
  // report/service.ts's createReport's own identical comment.
  const created = await prisma.$transaction(async (tx) => {
    const feedback = await tx.feedback.create({
      data: {
        userId: user.id,
        category: CATEGORY_TO_DB[input.category],
        title: input.title,
        content: input.content,
      },
    });
    await fanOutToAdmins(tx, {
      type: PrismaNotificationType.FEEDBACK_RECEIVED,
      title: "새 문의가 접수되었습니다",
      content: `[${FEEDBACK_CATEGORY_LABELS[input.category]}] ${input.title}`,
      relatedType: "feedback",
      relatedId: feedback.id,
    });
    return feedback;
  });
  return { kind: "ok", data: toFeedbackDTO(created) };
}

// "내가 보낸 의견" -- scoped to `user.id` by construction (the `where`
// clause, not a filter applied after a broader read), so this can never
// return another user's feedback regardless of what's passed in. No
// pagination: same reasoning as posts/service.ts's listLostPostsByUser
// (a personal "내 것들" list, capped defensively rather than paginated).
const MY_FEEDBACK_CAP = 100;

export async function getMyFeedback(user: User): Promise<FeedbackDTO[]> {
  const rows = await prisma.feedback.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MY_FEEDBACK_CAP,
  });
  return rows.map(toFeedbackDTO);
}

const AUTHOR_SELECT = { id: true, nickname: true, publicId: true } as const;

export type PagedFeedback = {
  items: FeedbackAdminDTO[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

// Admin-only. `status` filters to exactly one FeedbackStatus when given;
// omitted means "전체", mirroring listReportsForAdmin's own optional status
// filter (moderation/service.ts).
export async function listFeedbackForAdmin(
  admin: User,
  { status, page, limit }: { status?: FeedbackStatusValue; page: number; limit: number },
): Promise<FeedbackMutationResult<PagedFeedback>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const where = status ? { status: STATUS_TO_DB[status] } : {};
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: { user: { select: AUTHOR_SELECT } },
    }),
    prisma.feedback.count({ where }),
  ]);

  return {
    kind: "ok",
    data: {
      items: rows.map(toFeedbackAdminDTO),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// Admin-only detail read.
export async function getFeedbackForAdmin(admin: User, id: number): Promise<FeedbackMutationResult<FeedbackAdminDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const row = await prisma.feedback.findUnique({ where: { id }, include: { user: { select: AUTHOR_SELECT } } });
  if (!row) return { kind: "not_found" };

  return { kind: "ok", data: toFeedbackAdminDTO(row) };
}

// Admin-only -- status and adminNote are the only two fields an admin can
// change; category/title/content (the submitter's own words) are never
// editable by anyone, mirroring how a Report's reason/detail also stay
// fixed once filed.
//
// Phase 반영 완료 잠금: `completed` is terminal -- once a Feedback reaches
// it, no other status can ever be written back, from any path (this
// function is the only place feedback.status is ever updated, called by
// both the Server Action and, indirectly, anything else that might be
// added later). The re-request-same-status case (completed -> completed)
// is explicitly allowed as a no-op (still updates adminNote if given) --
// this is what makes a page refresh or a duplicate submit of the same form
// idempotent instead of erroring.
//
// Concurrency: the actual status-changing UPDATE below is conditioned on
// `status: { not: COMPLETED }` in its own WHERE clause, not just the
// `existing.status` read above -- so two concurrent requests (or a request
// racing a moment after another admin's already completed this feedback)
// can't both succeed: whichever commits first wins, and the loser's
// `updateMany` simply matches zero rows, detected via `result.count === 0`
// below and reported as `locked` -- there is no window between reading
// and writing where a second admin could sneak a non-`completed` status
// through.
export async function updateFeedbackStatus(
  admin: User,
  id: number,
  input: UpdateFeedbackStatusInput,
): Promise<FeedbackMutationResult<FeedbackAdminDTO>> {
  if (!isAdmin(admin)) return { kind: "forbidden" };

  const existing = await prisma.feedback.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };

  const noteData = input.adminNote !== undefined ? { adminNote: input.adminNote || null } : {};

  if (existing.status === PrismaFeedbackStatus.COMPLETED) {
    if (input.status !== "completed") return { kind: "locked" };
    // Idempotent no-op on the status itself -- only adminNote can still
    // change on an already-completed feedback.
    const updated = await prisma.feedback.update({
      where: { id },
      data: noteData,
      include: { user: { select: AUTHOR_SELECT } },
    });
    return { kind: "ok", data: toFeedbackAdminDTO(updated) };
  }

  const result = await prisma.feedback.updateMany({
    where: { id, status: { not: PrismaFeedbackStatus.COMPLETED } },
    data: { status: STATUS_TO_DB[input.status], ...noteData },
  });
  if (result.count === 0) {
    // Someone else completed this feedback in the instant between our own
    // read above and this write -- never a "not_found" (the row is still
    // there), always the same lock outcome a same-request retry would see.
    return { kind: "locked" };
  }

  const updated = await prisma.feedback.findUniqueOrThrow({
    where: { id },
    include: { user: { select: AUTHOR_SELECT } },
  });
  return { kind: "ok", data: toFeedbackAdminDTO(updated) };
}
