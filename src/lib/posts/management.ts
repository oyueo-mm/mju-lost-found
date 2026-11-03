import { revokeActiveReturn } from "./returns";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { officerScope } from "@/lib/institution/service";
import { managementSchema, readCustody, MANAGEMENT_ACTION_LABELS } from "./custodySchema";
import type { GrantablePermissionKey } from "@/lib/permissions/definitions";
import type { PostType } from "./schema";

// Each management action needs its own permission, on top of the 관리 범위.
export const ACTION_PERMISSION: Record<string, GrantablePermissionKey> = {
  confirm: "items.receive", location: "items.custody", complete: "items.return",
  transfer_request: "items.transfer", transfer_accept: "items.transfer", transfer_cancel: "items.transfer",
  reopen: "items.restore", correct_institution: "items.restore", release: "items.restore",
};

export const managementScope = officerScope;
type Scope = NonNullable<Awaited<ReturnType<typeof officerScope>>>;
export function inManagementScope(scope: Scope, _campus: string, custody: ReturnType<typeof readCustody>, organizationId?: number | null, pending?: number | null): boolean {
  if (scope.platform) return true;
  if (organizationId != null) return organizationId === scope.organizationId || pending === scope.organizationId;
  return !custody?.confirmedAt;
}
export async function managePost(userId: number, type: PostType, id: number, raw: unknown) {
  const parsed = managementSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, error: parsed.error.issues[0]?.message ?? "입력 내용을 확인해주세요." };
  const input = parsed.data;
  return prisma.$transaction(async (tx) => {
    const scope = await officerScope(userId, tx, true);
    if (!scope) return { status: 403, error: "물품 관리 권한 또는 담당 기관이 없습니다." };
    if (!scope.permissions.includes(ACTION_PERMISSION[input.action])) return { status: 403, error: "이 작업에 필요한 권한이 없습니다." };
    if (type === "found") await tx.$queryRaw`SELECT id FROM "FoundPost" WHERE id = ${id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "LostPost" WHERE id = ${id} FOR UPDATE`;
    const post = type === "found" ? await tx.foundPost.findUnique({ where: { id } }) : await tx.lostPost.findUnique({ where: { id } });
    if (!post || post.removedAt || post.tempHiddenAt) return { status: 404, error: "게시글을 찾을 수 없습니다." };
    const before = readCustody("custody" in post ? post.custody : null);
    const currentOrg = "custodyOrganizationId" in post ? post.custodyOrganizationId : null;
    const pendingOrg = "pendingTransferOrganizationId" in post ? post.pendingTransferOrganizationId : null;
    const action = input.action;
    if (post.updatedAt.toISOString() !== input.expectedUpdatedAt) return { status: 409, error: "다른 변경이 있습니다. 새로고침 후 다시 확인해주세요." };
    // 분실물 글의 관리 처리는 전체 관리자에게 한정한다.
    if (!scope.platform && type === "lost") return { status: 403, error: "분실물 글은 전체 관리자만 처리할 수 있습니다." };
    if (type === "lost" && !["complete", "reopen"].includes(action)) return { status: 400, error: "분실물 글에는 찾음 완료·복구만 적용할 수 있습니다." };
    if (!scope.platform) {
      const allowed = action === "transfer_accept" ? pendingOrg === scope.organizationId
        : action === "confirm" ? !currentOrg && !before?.confirmedAt : currentOrg === scope.organizationId;
      if (!allowed) return { status: 403, error: "실제 접수한 소속 기관의 물품만 처리할 수 있습니다." };
    }
    const completed = post.status === "FOUND" || post.status === "COMPLETED";
    if (completed && action !== "reopen" || !completed && action === "reopen") return { status: 409, error: "현재 상태에서 할 수 없는 작업입니다." };
    if (action === "confirm" && (currentOrg || before?.confirmedAt)) return { status: 409, error: "이미 접수가 확인되었습니다. 인계 또는 정정을 이용해주세요." };
    if (["location", "transfer_request", "release"].includes(action) && !currentOrg && !before?.confirmedAt) return { status: 409, error: "실제 접수가 먼저 확인되어야 합니다." };
    if (action === "transfer_request" && pendingOrg) return { status: 409, error: "진행 중인 인계 요청을 먼저 완료하거나 취소해주세요." };
    if (["transfer_accept", "transfer_cancel"].includes(action) && !pendingOrg) return { status: 409, error: "진행 중인 인계 요청이 없습니다." };
    if (action === "complete" && pendingOrg) return { status: 409, error: "인계 요청을 완료하거나 취소한 뒤 반환해주세요." };
    let organizationId = currentOrg;
    let nextPending = pendingOrg;
    let custody = before;
    const receipt = ["confirm", "transfer_accept", "correct_institution"].includes(action);
    const targetId = action === "transfer_accept" ? pendingOrg : action === "confirm" ? scope.platform ? input.organizationId : scope.organizationId : input.organizationId;
    if (receipt || action === "transfer_request") {
      if (!targetId) return { status: 400, error: "실제 수령 기관을 선택해주세요." };
      const org = await tx.organization.findUnique({ where: { id: targetId } });
      if (!org?.managementCampus || org.status !== "ACTIVE") return { status: 400, error: "활성 관리 기관을 선택해주세요." };
      if (action === "transfer_request") {
        if (targetId === currentOrg) return { status: 400, error: "현재와 다른 인계 기관을 선택해주세요." };
        nextPending = targetId;
      } else {
        organizationId = targetId; nextPending = null;
        custody = { state: "REPORTED", place: input.place!, confirmedAt: new Date().toISOString(), confirmedBy: userId, institution: org.name };
      }
    }
    if (action === "location") custody = before ? { ...before, place: input.place! } : null;
    if (action === "transfer_cancel") nextPending = null;
    // A withdrawn confirmation is no longer evidence of the item's location.
    // Preserve the old location in the audit, rather than relabel it as an author report.
    if (action === "release") { organizationId = null; nextPending = null; custody = { state: "UNKNOWN", place: "", confirmedAt: null, confirmedBy: null, institution: null }; }
    const fromStatus = type === "found" ? completed ? "완료" : "보관 중" : completed ? "찾음" : "찾는 중";
    const toStatus = action === "complete" ? type === "found" ? "완료" : "찾음" : action === "reopen" ? type === "found" ? "보관 중" : "찾는 중" : fromStatus;
    const updated = type === "found" ? await tx.foundPost.update({ where: { id }, data: { status: toStatus === "완료" ? "COMPLETED" : "KEEPING", custodyOrganizationId: organizationId, pendingTransferOrganizationId: nextPending, custody: custody ?? Prisma.DbNull } })
      : await tx.lostPost.update({ where: { id }, data: { status: toStatus === "찾음" ? "FOUND" : "SEARCHING" } });
    // reopening ends the chat-room return link (kept, marked revoked)
    if (action === "reopen") await revokeActiveReturn(tx, type, id);
    const change = await tx.postStatusChange.create({ data: { postType: type, postId: id, changedByUserId: userId, fromStatus, toStatus, action, institution: custody?.institution ?? scope.institution,
      organizationId: action === "transfer_accept" ? pendingOrg : currentOrg ?? organizationId, targetOrganizationId: receipt ? organizationId : nextPending, reason: input.reason,
      beforeCustody: before ?? Prisma.JsonNull, afterCustody: custody ?? Prisma.JsonNull } });
    if (post.userId !== userId) await tx.notification.create({ data: { userId: post.userId, type: "POST_MANAGED", title: "등록하신 물품의 처리 상태가 변경되었습니다.", content: `${custody?.institution ?? scope.institution}: ${MANAGEMENT_ACTION_LABELS[action]}`, relatedType: "post_status_change", relatedId: change.id } });
    return { status: 200, updatedAt: updated.updatedAt.toISOString() };
  });
}
export async function managementHistory(userId: number, type: PostType, id: number) {
  const scope = await officerScope(userId);
  if (!scope) return [];
  const post = type === "found" ? await prisma.foundPost.findUnique({ where: { id } }) : null;
  if (!scope.platform && (!post || post.removedAt || post.tempHiddenAt || !inManagementScope(scope, post.campus, readCustody(post.custody), post.custodyOrganizationId, post.pendingTransferOrganizationId))) return [];
  return prisma.postStatusChange.findMany({ where: { postType: type, postId: id, ...(scope.platform ? {} : { OR: [{ organizationId: scope.organizationId }, { targetOrganizationId: scope.organizationId }] }) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50,
    select: { id: true, fromStatus: true, toStatus: true, action: true, institution: true, beforeCustody: true, afterCustody: true, reason: true, createdAt: true, changedBy: { select: { nickname: true } } } });
}
