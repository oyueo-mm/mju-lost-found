import { prisma } from "@/lib/db/prisma";
import { KeywordAlertPostType as PrismaKeywordAlertPostType, type User } from "@/generated/prisma/client";
import { MAX_KEYWORD_ALERTS_PER_USER } from "./config";
import type { CreateKeywordAlertInput, KeywordAlertPostTypeValue, UpdateKeywordAlertInput } from "./schema";

// 키워드 알림 Phase: 이 앱의 다른 "내 것만 보이는" 개인 설정 도메인들
// (feedback/service.ts의 getMyFeedback, notification/service.ts)과 동일한
// 관례 -- 모든 조회/변경이 항상 호출자 자신의 userId로만 스코프되고, 다른
// 사용자의 규칙은 어떤 경로로도 노출되지 않는다. 관리자 전용 기능이
// 아니므로 isAdmin() 재확인이 없다(이 도메인 자체가 "누구나 자기 규칙만"
// 이라는 것이 유일한 권한 규칙).

const POST_TYPE_TO_DB: Record<KeywordAlertPostTypeValue, PrismaKeywordAlertPostType> = {
  all: PrismaKeywordAlertPostType.ALL,
  lost: PrismaKeywordAlertPostType.LOST,
  found: PrismaKeywordAlertPostType.FOUND,
};
const POST_TYPE_FROM_DB: Record<PrismaKeywordAlertPostType, KeywordAlertPostTypeValue> = {
  ALL: "all",
  LOST: "lost",
  FOUND: "found",
};

export type KeywordAlertDTO = {
  id: number;
  keyword: string;
  postType: KeywordAlertPostTypeValue;
  campuses: string[];
  categories: string[];
  excludeKeywords: string[];
  createdAt: Date;
  updatedAt: Date;
};

type KeywordAlertRow = {
  id: number;
  keyword: string;
  postType: PrismaKeywordAlertPostType;
  campuses: string[];
  categories: string[];
  excludeKeywords: string[];
  createdAt: Date;
  updatedAt: Date;
};

function toKeywordAlertDTO(row: KeywordAlertRow): KeywordAlertDTO {
  return {
    id: row.id,
    keyword: row.keyword,
    postType: POST_TYPE_FROM_DB[row.postType],
    campuses: row.campuses,
    categories: row.categories,
    excludeKeywords: row.excludeKeywords,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type KeywordAlertMutationResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  // Phase 스펙: "사용자당 알림 규칙 수... 현실적인 제한" -- createKeywordAlert
  // only.
  | { kind: "too_many" };

// 개인 목록 -- getMyFeedback()과 동일한 "페이지네이션 없는, capped 목록"
// 관례 (MAX_KEYWORD_ALERTS_PER_USER 자체가 이미 이 목록의 상한이라 별도
// take가 필요 없다).
export async function listKeywordAlerts(user: User): Promise<KeywordAlertDTO[]> {
  const rows = await prisma.keywordAlert.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(toKeywordAlertDTO);
}

export async function createKeywordAlert(
  user: User,
  input: CreateKeywordAlertInput,
): Promise<KeywordAlertMutationResult<KeywordAlertDTO>> {
  const currentCount = await prisma.keywordAlert.count({ where: { userId: user.id } });
  if (currentCount >= MAX_KEYWORD_ALERTS_PER_USER) return { kind: "too_many" };

  const row = await prisma.keywordAlert.create({
    data: {
      userId: user.id,
      keyword: input.keyword,
      postType: POST_TYPE_TO_DB[input.postType],
      campuses: input.campuses,
      categories: input.categories,
      excludeKeywords: input.excludeKeywords,
    },
  });
  return { kind: "ok", data: toKeywordAlertDTO(row) };
}

export async function updateKeywordAlert(
  user: User,
  id: number,
  input: UpdateKeywordAlertInput,
): Promise<KeywordAlertMutationResult<KeywordAlertDTO>> {
  const existing = await prisma.keywordAlert.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== user.id) return { kind: "forbidden" };

  const row = await prisma.keywordAlert.update({
    where: { id },
    data: {
      keyword: input.keyword,
      postType: POST_TYPE_TO_DB[input.postType],
      campuses: input.campuses,
      categories: input.categories,
      excludeKeywords: input.excludeKeywords,
    },
  });
  return { kind: "ok", data: toKeywordAlertDTO(row) };
}

// (main)/notifications/resolveHref.ts가 KEYWORD_ALERT_MATCH 알림 하나를
// 실제 게시글 링크로 바꿀 때 쓰는 조회 -- relatedId(KeywordAlertMatch.id)
// 자체는 클라이언트가 아니라 이 앱이 저장한 값이지만, 소유권은 여기서
// 다시 확인한다(이 매치가 속한 KeywordAlert가 정말 이 userId의 것인지) --
// resolveHref의 다른 모든 분기가 이미 따르는 "notification의 relatedId를
// 그대로 믿지 않고 실제 접근 권한을 다시 도출한다"는 규칙과 동일.
export async function getKeywordAlertMatchForUser(
  matchId: number,
  userId: number,
): Promise<{ postType: string; postId: number } | null> {
  const match = await prisma.keywordAlertMatch.findUnique({
    where: { id: matchId },
    include: { keywordAlert: { select: { userId: true } } },
  });
  if (!match || match.keywordAlert.userId !== userId) return null;
  return { postType: match.postType, postId: match.postId };
}

// Phase E-2의 deleteNotification()과 동일한 모양: 소유권을 먼저 명시적으로
// 확인한 뒤 실제 하드 delete -- KeywordAlertMatch가 onDelete: Cascade라
// 이 규칙이 이미 만든 매치 기록도 함께 정리된다(고아 행이 남지 않는다).
export async function deleteKeywordAlert(
  user: User,
  id: number,
): Promise<KeywordAlertMutationResult<{ id: number }>> {
  const existing = await prisma.keywordAlert.findUnique({ where: { id } });
  if (!existing) return { kind: "not_found" };
  if (existing.userId !== user.id) return { kind: "forbidden" };

  await prisma.keywordAlert.delete({ where: { id } });
  return { kind: "ok", data: { id } };
}
