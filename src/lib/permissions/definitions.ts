// The one place that defines the admin permissions. Identifiers are stored in
// the DB and never shown in the UI; labels/descriptions are what users see.
// A permission check anywhere else goes through can() in ./check.ts.

export const PERMISSION_KEYS = [
  "items.receive", "items.custody", "items.return", "items.transfer", "items.restore",
  "posts.manage", "posts.delete",
  "reports.view", "reports.process",
  "users.view", "users.sanction",
  "stats.operations", "stats.users", "stats.admins",
  "access.external", "institutions.manage",
  "promotion.manage", "settings.manage",
  "permissions.manage",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// Only a full administrator (User.isAdmin) holds this one. It cannot be stored
// as a grant, so it can never be delegated through the permission editor.
export const SUPER_ONLY_PERMISSION: PermissionKey = "permissions.manage";
export type GrantablePermissionKey = Exclude<PermissionKey, "permissions.manage">;
export const GRANTABLE_PERMISSION_KEYS = PERMISSION_KEYS.filter((k) => k !== SUPER_ONLY_PERMISSION) as GrantablePermissionKey[];

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}
export function isGrantablePermissionKey(value: unknown): value is GrantablePermissionKey {
  return isPermissionKey(value) && value !== SUPER_ONLY_PERMISSION;
}

export type PermissionInfo = { label: string; description: string };
export const PERMISSION_INFO: Record<PermissionKey, PermissionInfo> = {
  "items.receive": { label: "물품 접수", description: "타인이 올린 습득물을 실제로 받았는지 확인하고 보관 기관을 확정합니다." },
  "items.custody": { label: "보관 관리", description: "접수된 물품의 보관 장소와 상태를 관리합니다." },
  "items.return": { label: "물품 반환", description: "주인에게 돌려준 물품을 반환 완료로 처리하고 작성자에게 알립니다." },
  "items.transfer": { label: "기관 인계", description: "다른 기관으로 물품 인계를 요청하거나 받은 인계를 확인합니다." },
  "items.restore": { label: "상태 복구", description: "잘못 처리된 접수·반환·완료 상태를 사유와 함께 되돌립니다." },
  "posts.manage": { label: "게시글 관리", description: "타인 게시글을 확인하고 숨김·복원 같은 관리 작업을 합니다." },
  "posts.delete": { label: "게시글 삭제", description: "정책을 위반한 타인 게시글을 삭제합니다." },
  "reports.view": { label: "신고 조회", description: "신고 목록과 상세 내용, 처리 상태를 봅니다." },
  "reports.process": { label: "신고 처리", description: "신고를 승인·반려하고 처리 상태를 바꿉니다." },
  "users.view": { label: "사용자 조회", description: "사용자 목록과 상세 정보를 검색해 봅니다." },
  "users.sanction": { label: "사용자 제재", description: "사용자를 정지하거나 정지를 해제합니다." },
  "stats.operations": { label: "운영 통계 조회", description: "일반 사용자의 방문·검색·게시글 등록 통계를 봅니다." },
  "stats.users": { label: "사용자 통계 조회", description: "일반 사용자의 가입·활성·재방문 통계를 봅니다." },
  "stats.admins": { label: "관리자 통계 조회", description: "관리 권한 보유자의 활동과 기관별 물품 처리 실적을 봅니다." },
  "access.external": { label: "외부 관계자 승인", description: "외부 Google 계정의 로그인 승인을 허용·변경·회수합니다." },
  "institutions.manage": { label: "기관 관리", description: "물품을 보관하는 기관과 단체를 등록하고 정보를 수정합니다." },
  "promotion.manage": { label: "홍보 관리", description: "홍보 링크와 QR 코드를 만들고 관리합니다." },
  "settings.manage": { label: "운영 설정", description: "공지·서비스 의견·재가입 요청 등 서비스 운영 설정을 관리합니다." },
  "permissions.manage": { label: "권한 관리", description: "다른 사용자에게 관리 권한을 부여·변경·회수합니다. 전체 관리자만 사용할 수 있습니다." },
};

export type PermissionGroup = { id: string; label: string; keys: PermissionKey[] };
export const PERMISSION_GROUPS: PermissionGroup[] = [
  { id: "items", label: "물품 관리", keys: ["items.receive", "items.custody", "items.return", "items.transfer", "items.restore"] },
  { id: "posts", label: "게시글 관리", keys: ["posts.manage", "posts.delete"] },
  { id: "reports", label: "신고 관리", keys: ["reports.view", "reports.process"] },
  { id: "users", label: "사용자 관리", keys: ["users.view", "users.sanction"] },
  { id: "stats", label: "통계", keys: ["stats.operations", "stats.users", "stats.admins"] },
  { id: "access", label: "기관·외부 계정", keys: ["access.external", "institutions.manage"] },
  { id: "service", label: "서비스 운영", keys: ["promotion.manage", "settings.manage"] },
  { id: "permissions", label: "권한 관리", keys: ["permissions.manage"] },
];

// Selecting the right-hand permission needs the left-hand one to be usable at
// all (you cannot process a report you cannot see). Applied on save.
export const PERMISSION_REQUIRES: Partial<Record<GrantablePermissionKey, GrantablePermissionKey>> = {
  "reports.process": "reports.view",
  "users.sanction": "users.view",
};
export function withRequiredPermissions(keys: Iterable<GrantablePermissionKey>): GrantablePermissionKey[] {
  const set = new Set<GrantablePermissionKey>(keys);
  for (const k of [...set]) {
    const need = PERMISSION_REQUIRES[k];
    if (need) set.add(need);
  }
  return GRANTABLE_PERMISSION_KEYS.filter((k) => set.has(k));
}

// Presets only pre-fill the editor; they are not roles and are never stored.
export type PermissionPreset = { id: string; label: string; keys: GrantablePermissionKey[] };
export const PERMISSION_PRESETS: PermissionPreset[] = [
  { id: "none", label: "일반 사용자", keys: [] },
  { id: "items", label: "물품 관리 담당", keys: ["items.receive", "items.custody", "items.return", "items.transfer"] },
  { id: "content", label: "콘텐츠 관리 담당", keys: ["posts.manage", "reports.view", "reports.process"] },
  { id: "promotion", label: "운영·홍보 담당", keys: ["stats.operations", "stats.users", "promotion.manage"] },
];
export function matchingPresetId(keys: readonly GrantablePermissionKey[]): string {
  const sorted = [...keys].sort().join(",");
  return PERMISSION_PRESETS.find((p) => [...p.keys].sort().join(",") === sorted)?.id ?? "custom";
}

export const ITEM_PERMISSION_KEYS: GrantablePermissionKey[] = ["items.receive", "items.custody", "items.return", "items.transfer", "items.restore"];

// Admin menu: an entry shows when the viewer holds ANY of its permissions.
export type AdminMenuEntry = { href: string; label: string; anyOf: PermissionKey[] };
export const ADMIN_MENU: AdminMenuEntry[] = [
  { href: "/items", label: "물품 관리", anyOf: ITEM_PERMISSION_KEYS },
  { href: "/admin/reports", label: "신고 관리", anyOf: ["reports.view", "reports.process"] },
  { href: "/admin/posts", label: "게시글 관리", anyOf: ["posts.manage", "posts.delete"] },
  { href: "/admin/users", label: "사용자 관리", anyOf: ["users.view", "users.sanction", "permissions.manage"] },
  { href: "/admin/sanctions", label: "제재 기록", anyOf: ["users.sanction"] },
  { href: "/admin/stats", label: "통계", anyOf: ["stats.operations", "stats.users", "stats.admins"] },
  { href: "/admin/utm", label: "UTM 링크 생성", anyOf: ["promotion.manage"] },
  { href: "/admin/external-access", label: "외부 관계자 승인", anyOf: ["access.external"] },
  { href: "/admin/organizations", label: "기관·단체 관리", anyOf: ["institutions.manage"] },
  { href: "/admin/announcements", label: "공지사항", anyOf: ["settings.manage"] },
  { href: "/admin/feedback", label: "서비스 의견", anyOf: ["settings.manage"] },
];
