import { z } from "zod";

// Phase 12-2: same length-cap convention as announcement/schema.ts and
// feedback/schema.ts (trim + min(1) required text, a sane max) -- no
// precedent in this app for different numbers for this class of
// short-to-medium admin-reviewed text, so those are reused here too.

export const organizationIdSchema = z.coerce.number().int().positive();

// Phase 12-6: same 필터 탭 상수 convention as ORGANIZATION_REQUEST_STATUSES
// below -- backs /admin/organizations's ALL/ACTIVE/INACTIVE filter tabs.
export const ORGANIZATION_STATUSES = ["active", "inactive"] as const;
export type OrganizationStatusValue = (typeof ORGANIZATION_STATUSES)[number];

export const ORGANIZATION_STATUS_LABELS: Record<OrganizationStatusValue, string> = {
  active: "활성",
  inactive: "비활성",
};

// Phase 12-3: same string-literal-union + 필터 탭 상수 convention
// feedback/schema.ts's FEEDBACK_STATUSES/FEEDBACK_STATUS_LABELS already
// establishes -- reused here for OrganizationCreationRequest.status.
export const ORGANIZATION_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type OrganizationRequestStatusValue = (typeof ORGANIZATION_REQUEST_STATUSES)[number];

export const ORGANIZATION_REQUEST_STATUS_LABELS: Record<OrganizationRequestStatusValue, string> = {
  pending: "대기 중",
  approved: "승인됨",
  rejected: "거절됨",
  cancelled: "취소됨",
};

// "단체 생성 요청" -- reviewed by a Platform Admin (requireAdmin()), never
// self-service (see organization/service.ts::createOrganizationCreationRequest).
export const organizationCreationRequestSchema = z.object({
  organizationName: z.string().trim().min(1, "단체명을 입력해주세요.").max(200, "단체명은 200자를 넘을 수 없습니다."),
  organizationType: z.string().trim().min(1, "단체 유형을 입력해주세요.").max(100, "단체 유형은 100자를 넘을 수 없습니다."),
  scope: z.string().trim().min(1).max(200, "소속은 200자를 넘을 수 없습니다.").optional(),
  contactEmail: z.string().trim().email("올바른 이메일 주소를 입력해주세요.").max(200),
  purpose: z.string().trim().min(1, "단체 생성 목적을 입력해주세요.").max(2000, "단체 생성 목적은 2000자를 넘을 수 없습니다."),
});
export type CreateOrganizationCreationRequestInput = z.infer<typeof organizationCreationRequestSchema>;

// Platform Admin의 승인 -- 거절과 달리 사유가 필수가 아니므로(승인은
// 자기설명적) adminNote만 선택적으로 받는다.
export const approveOrganizationCreationRequestSchema = z.object({
  adminNote: z.string().trim().max(2000, "관리자 메모는 2000자를 넘을 수 없습니다.").optional(),
});
export type ApproveOrganizationCreationRequestInput = z.infer<typeof approveOrganizationCreationRequestSchema>;

// Platform Admin의 거절 -- Phase 12-3 §11: "거절에는 반드시 사유를 받는다."
// rejectionReason은 approve와 달리 필수(min(1)) -- 승인/거절을 하나의
// optional-필드 스키마로 묶지 않고 분리한 이유.
export const rejectOrganizationCreationRequestSchema = z.object({
  rejectionReason: z.string().trim().min(1, "거절 사유를 입력해주세요.").max(1000, "거절 사유는 1000자를 넘을 수 없습니다."),
  adminNote: z.string().trim().max(2000, "관리자 메모는 2000자를 넘을 수 없습니다.").optional(),
});
export type RejectOrganizationCreationRequestInput = z.infer<typeof rejectOrganizationCreationRequestSchema>;

// "단체 가입 요청" -- organizationId는 body가 아니라 항상 호출부(경로 파라미터
// 등)에서 별도로 전달되고 서버가 재검증하므로 이 스키마에는 포함하지 않는다
// (attachImageSchema 등 기존 스키마들도 postId를 body에 신뢰하지 않는 것과
// 동일한 이유).
export const organizationJoinRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000, "메시지는 1000자를 넘을 수 없습니다.").optional(),
});
export type CreateOrganizationJoinRequestInput = z.infer<typeof organizationJoinRequestSchema>;

export const reviewOrganizationJoinRequestSchema = z.object({
  rejectionReason: z.string().trim().max(1000, "거절 사유는 1000자를 넘을 수 없습니다.").optional(),
});
export type ReviewOrganizationJoinRequestInput = z.infer<typeof reviewOrganizationJoinRequestSchema>;

// Phase 12-4 §11: 단체 기본 정보 수정 -- name/organizationType은
// Organization 생성 시(승인 워크플로) 이미 필수였던 것과 동일하게 필수로
// 유지, description/scope/contactEmail은 Organization 테이블 자체가
// nullable인 것과 맞춰 선택으로 둔다. OrganizationStatus는 이 스키마에
// 포함하지 않는다 -- 활성화/비활성화는 별도 action(deactivateOrganization)
// 전용이며, 일반 정보 수정 폼으로 상태를 바꿀 수 없게 하는 것이 이번 Phase의
// 명시적 요구사항이다.
export const organizationProfileUpdateSchema = z.object({
  name: z.string().trim().min(1, "단체명을 입력해주세요.").max(200, "단체명은 200자를 넘을 수 없습니다."),
  organizationType: z.string().trim().min(1, "단체 유형을 입력해주세요.").max(100, "단체 유형은 100자를 넘을 수 없습니다."),
  description: z.string().trim().max(2000, "설명은 2000자를 넘을 수 없습니다.").optional(),
  scope: z.string().trim().max(200, "활동 범위는 200자를 넘을 수 없습니다.").optional(),
  contactEmail: z.string().trim().email("올바른 이메일 주소를 입력해주세요.").max(200).optional().or(z.literal("")),
});
export type OrganizationProfileUpdateInput = z.infer<typeof organizationProfileUpdateSchema>;
