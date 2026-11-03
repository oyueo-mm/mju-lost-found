import { z } from "zod";
export const institutionSchema = z.object({ organizationId: z.number().int().positive().optional(), name: z.string().trim().min(1).max(100), campus: z.enum(["인문캠퍼스", "자연캠퍼스", "양쪽"]), type: z.string().trim().min(1).max(100) }).strict();
// What the 관리 권한 설정 form sends. Permission identifiers are validated on the
// server against the central list; the scope (organization/facility) only matters
// when a 물품 관리 permission is selected.
export const permissionChangeSchema = z.object({
  userId: z.number().int().positive(),
  permissions: z.array(z.string().max(60)).max(40),
  organizationId: z.number().int().positive().nullable().optional(),
  facility: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();
export type PermissionChangeInput = z.infer<typeof permissionChangeSchema>;
// "officer" is the stored value for an account holding at least one admin permission.
export const ROLE_LABELS = { member: "일반 사용자", officer: "관리 권한 보유", service: "전체 관리자" } as const;
