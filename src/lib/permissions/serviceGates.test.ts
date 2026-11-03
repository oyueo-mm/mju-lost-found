import { describe, expect, it, vi } from "vitest";

import { GRANTABLE_PERMISSION_KEYS, type PermissionKey } from "./definitions";

// Every admin service entry point must refuse before it touches the database
// unless the caller holds exactly the permission it needs: an account holding
// ALL the other permissions is refused, and an account holding only that one
// gets past the gate (the stub DB then throws, which proves the gate opened).
vi.mock("@/lib/db/prisma", () => ({ prisma: new Proxy({}, { get() { throw new Error("DB touched"); } }) }));
vi.mock("@/lib/storage/images", () => ({}));

const [users, posts, moderation, external, announcement, feedback, organization, settings, identity, rejoin, appeals, chat] = await Promise.all([
  import("@/lib/admin/users"), import("@/lib/admin/posts"), import("@/lib/moderation/service"), import("@/lib/externalAccess/service"),
  import("@/lib/announcement/service"), import("@/lib/feedback/service"), import("@/lib/organization/service"), import("@/lib/settings/service"),
  import("@/lib/identity/service"), import("@/lib/auth/rejoin"), import("@/lib/moderation/appeals"), import("@/lib/chat/service"),
]);

type Call = (admin: never) => Promise<unknown>;
const any = undefined as never;
const GATES: [string, PermissionKey, Call][] = [
  ["사용자 목록", "users.view", (a) => users.listUsersForAdmin(a, {} as never)],
  ["사용자 상세", "users.view", (a) => users.getUserDetailForAdmin(a, 1)],
  ["사용자 정지", "users.sanction", (a) => users.updateUserByAdmin(a, 9, "suspend", 3, "c", "r")],
  ["정지 해제", "users.sanction", (a) => users.updateUserByAdmin(a, 9, "unsuspend")],
  ["전체 관리자 지정", "permissions.manage", (a) => users.updateUserByAdmin(a, 9, "promote")],
  ["게시글 삭제", "posts.delete", (a) => posts.deletePostForAdmin(a, "lost", 1)],
  ["신고 목록", "reports.view", (a) => moderation.listReportsForAdmin(a, {} as never)],
  ["신고 상세", "reports.view", (a) => moderation.getReportForAdmin(a, 1)],
  ["신고 반려", "reports.process", (a) => moderation.dismissReport(a, 1)],
  ["신고 조치", "reports.process", (a) => moderation.applyReportAction(a, 1, "temp_hide_post", {})],
  ["임시 숨김 복원", "reports.process", (a) => moderation.restoreTempHiddenContent(a, 1)],
  ["제재 기록", "users.sanction", (a) => moderation.listSuspensionActionsForAdmin(a, {} as never)],
  ["이의신청 목록", "users.sanction", (a) => appeals.listSuspensionAppealsForAdmin(a, {} as never)],
  ["이의신청 처리", "users.sanction", (a) => appeals.markSuspensionAppealReviewed(a, 1)],
  ["재가입 요청 처리", "users.sanction", (a) => rejoin.reviewRejoinRequest(a, 1, "approve", "")],
  ["실명 열람", "reports.process", (a) => identity.viewIdentityForReport(a, { reportId: 1, targetUserId: 2, reason: "" })],
  ["신고 대화방", "reports.view", (a) => chat.getChatRoomForAdmin(1, 1, a)],
  ["외부 관계자 목록", "access.external", (a) => external.listExternalAccessGrants(a)],
  ["외부 관계자 승인", "access.external", (a) => external.createExternalAccessGrant(a, any)],
  ["외부 관계자 회수", "access.external", (a) => external.revokeExternalAccessGrant(a, 1)],
  ["기관·단체 목록", "institutions.manage", (a) => organization.listOrganizationsForAdmin(a, {} as never)],
  ["단체 신청 승인", "institutions.manage", (a) => organization.approveOrganizationCreationRequest(a, 1)],
  ["단체 상태 변경", "institutions.manage", (a) => organization.setOrganizationStatusForAdmin(a, 1, any)],
  ["공지 작성", "settings.manage", (a) => announcement.createAnnouncement(a, any)],
  ["공지 삭제", "settings.manage", (a) => announcement.deleteAnnouncement(a, 1)],
  ["서비스 의견 목록", "settings.manage", (a) => feedback.listFeedbackForAdmin(a, {} as never)],
  ["서비스 의견 상태", "settings.manage", (a) => feedback.updateFeedbackStatus(a, 1, any)],
  ["Google 테스트 모드", "settings.manage", (a) => settings.setGoogleTestMode(a, true)],
];

const holder = (keys: readonly string[]) => ({ id: 50, isAdmin: false, adminPermissions: [...keys] }) as never;
const settle = (call: Call, admin: never) => call(admin).then((r) => r, (e: Error) => e);

describe.each(GATES)("%s requires %s", (_name, needed, call) => {
  it("refuses a regular user and an account holding every other permission", async () => {
    expect(await settle(call, { id: 50, isAdmin: false } as never)).toEqual({ kind: "forbidden" });
    const others = GRANTABLE_PERMISSION_KEYS.filter((k) => k !== needed);
    expect(await settle(call, holder(others))).toEqual({ kind: "forbidden" });
  });
  it("opens for a full administrator, and for an account holding only that permission (unless it is full-admin-only)", async () => {
    const full = await settle(call, { id: 1, isAdmin: true } as never);
    expect(full).not.toEqual({ kind: "forbidden" });
    if (needed !== "permissions.manage") expect(await settle(call, holder([needed]))).not.toEqual({ kind: "forbidden" });
    else expect(await settle(call, holder([needed]))).toEqual({ kind: "forbidden" });
  });
});

describe("content moderation adds the permission of the risky action", () => {
  it("refuses deleting content or suspending a user from a report without 게시글 삭제 / 사용자 제재", async () => {
    const processOnly = holder(["reports.view", "reports.process"]);
    expect(await moderation.applyReportAction(processOnly, 1, "delete_post", {})).toEqual({ kind: "forbidden" });
    expect(await moderation.applyReportAction(processOnly, 1, "delete_comment", {})).toEqual({ kind: "forbidden" });
    expect(await moderation.applyReportAction(processOnly, 1, "suspend_user", { actionReasonCategory: "c", actionReason: "r" })).toEqual({ kind: "forbidden" });
    const withDelete = holder(["reports.process", "posts.delete"]);
    expect(await moderation.applyReportAction(withDelete, 1, "delete_post", {}).catch((e: Error) => e.message)).toBe("DB touched");
  });
});
