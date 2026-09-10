import Link from "next/link";

import { getCurrentUser, requireActiveUser } from "@/lib/auth/session";
import {
  getMyOrganizationJoinRequests,
  getMyOrganizationMemberships,
  getMyPendingOrganizationCreationRequest,
  listActiveOrganizations,
} from "@/lib/organization/service";
import { ORGANIZATION_REQUEST_STATUS_LABELS } from "@/lib/organization/schema";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";
import { ShieldIcon, PlusIcon } from "@/components/icons";
import { OrganizationHelpTooltip } from "@/components/organization/OrganizationHelpTooltip";

const ROLE_LABELS = { leader: "대표 관리자", admin: "관리자", member: "구성원" } as const;

const TABS = [
  { key: "my", label: "내 단체" },
  { key: "find", label: "단체 찾기" },
  { key: "requests", label: "신청 내역" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function tabHref(tab: TabKey): string {
  return tab === "find" ? "/organizations" : `/organizations?tab=${tab}`;
}

// Phase 12-10 §2/§3: "단체 허브" -- 기존 /organizations(단체 찾기)를 그대로
// 재사용하면서 여기에 내 단체/신청 내역 탭을 추가한 하나의 진입점으로
// 통합한다. 기존 개별 페이지(/organizations/create 등)는 삭제하지 않고
// 탭/버튼에서 그대로 연결한다. tab 쿼리 파라미터가 없으면 기존 동작과
// 동일하게 "단체 찾기"(공개, 로그인 불필요)가 기본값이다 -- 이 페이지로
// 들어오는 기존 링크(북마크 등)의 동작을 바꾸지 않기 위해서다. "내 정보"의
// "단체" 메뉴는 ?tab=my로 직접 연결해 로그인 사용자에게는 내 단체가 먼저
// 보이게 한다(page.tsx의 me/page.tsx 자체 코멘트 참고).
export default async function OrganizationsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const { tab: tabParam, status: statusParam } = await searchParams;
  const tab: TabKey = tabParam === "my" || tabParam === "requests" ? tabParam : "find";
  const memberStatusFilter: "active" | "inactive" = statusParam === "inactive" ? "inactive" : "active";

  // Phase 12-10 §3/§5: "내 단체"/"신청 내역" 탭은 본인 데이터를 보여주므로
  // 로그인이 필요하다 -- "단체 찾기"는 /lost, /found와 동일하게 비로그인도
  // 볼 수 있는 기존 동작을 그대로 유지한다.
  const currentUser = tab === "find" ? await getCurrentUser() : await requireActiveUser();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold text-foreground">단체</h1>
          <OrganizationHelpTooltip />
        </div>
        <LinkButton href="/organizations/create" variant="secondary" size="sm">
          <PlusIcon className="size-4" />
          단체 만들기
        </LinkButton>
      </div>

      <nav aria-label="단체 허브 탭" className="flex gap-1.5 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "find" && <FindTab />}
      {tab === "my" && currentUser && <MyTab userId={currentUser.id} statusFilter={memberStatusFilter} />}
      {tab === "requests" && currentUser && <RequestsTab userId={currentUser.id} />}
    </div>
  );
}

// Phase 12-4 §4/§24 그대로 -- ACTIVE 단체만, 이름순. 이번 phase에서 조회/
// 표시 로직은 바꾸지 않고 허브의 한 탭으로 옮기기만 했다.
async function FindTab() {
  const organizations = await listActiveOrganizations();

  if (organizations.length === 0) {
    return <EmptyState title="등록된 단체가 없습니다" description="아직 승인된 단체가 없습니다." />;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {organizations.map((org) => (
        <li key={org.id}>
          <Link
            href={`/organizations/${org.id}`}
            className="flex items-center gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
              <ShieldIcon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium text-foreground">{org.name}</span>
              <span className="text-xs text-muted-foreground">
                {org.organizationType}
                {org.scope ? ` · ${org.scope}` : ""}
              </span>
              {org.description && <span className="line-clamp-1 text-xs text-muted-foreground">{org.description}</span>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Phase 12-10 §3: 기본은 ACTIVE만, "폐쇄된 단체" 필터를 명시적으로 선택했을
// 때만 INACTIVE를 보여준다. getMyOrganizationMemberships 자체는 상태 필터
// 없이 전부 반환하므로(Phase 12-4), 여기서 클라이언트 쪽 필터링 없이
// 서버에서 한 번에 걸러낸다.
async function MyTab({ userId, statusFilter }: { userId: number; statusFilter: "active" | "inactive" }) {
  const memberships = await getMyOrganizationMemberships(userId);
  const filtered = memberships.filter((m) => m.organizationStatus === statusFilter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5" role="group" aria-label="단체 상태 필터">
        <Link
          href="/organizations?tab=my"
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            statusFilter === "active"
              ? "border-primary bg-primary-muted text-primary"
              : "border-border text-muted-foreground hover:border-foreground/30"
          }`}
        >
          활성 단체
        </Link>
        <Link
          href="/organizations?tab=my&status=inactive"
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            statusFilter === "inactive"
              ? "border-primary bg-primary-muted text-primary"
              : "border-border text-muted-foreground hover:border-foreground/30"
          }`}
        >
          폐쇄된 단체
        </Link>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={statusFilter === "active" ? "가입한 활성 단체가 없습니다" : "폐쇄된 단체가 없습니다"}
          description={statusFilter === "active" ? "단체 찾기 탭에서 가입할 단체를 찾아보세요." : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((m) => (
            <li key={m.organizationId}>
              <Link
                href={`/organizations/${m.organizationId}`}
                className="flex items-center gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:border-foreground/30"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
                  <ShieldIcon className="size-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium text-foreground">{m.organizationName}</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABELS[m.role]} · {m.organizationStatus === "active" ? "활성" : "폐쇄됨"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Phase 12-10 §5: 가입 신청(여러 단체에 걸친 전체 내역) + 단체 생성 신청
// (현재 PENDING 1건, 기존 §6 중복 신청 정책상 그 이상 있을 수 없음)을 한
// 화면에 모은다. 두 신청 유형 모두 기존 서비스 함수를 그대로 재사용하고,
// 여기서는 새 승인/거절 로직을 추가하지 않는다 -- 가입 신청 취소는 기존
// 단체 프로필 페이지(OrganizationJoinControls)에서, 생성 신청 취소는 기존
// /organizations/create(PendingOrganizationRequestCard)에서 그대로 처리한다.
async function RequestsTab({ userId }: { userId: number }) {
  const [joinRequests, creationRequest] = await Promise.all([
    getMyOrganizationJoinRequests(userId),
    getMyPendingOrganizationCreationRequest(userId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">가입 신청</h2>
        {joinRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">가입 신청 내역이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {joinRequests.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/organizations/${r.organizationId}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-border bg-card p-3.5 text-sm transition-colors hover:border-foreground/30"
                >
                  <span className="truncate font-medium text-foreground">{r.organizationName}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {ORGANIZATION_REQUEST_STATUS_LABELS[r.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">단체 생성 신청</h2>
        {creationRequest ? (
          <Link
            href="/organizations/create"
            className="flex items-center justify-between gap-3 rounded-card border border-border bg-card p-3.5 text-sm transition-colors hover:border-foreground/30"
          >
            <span className="truncate font-medium text-foreground">{creationRequest.organizationName}</span>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {ORGANIZATION_REQUEST_STATUS_LABELS[creationRequest.status]}
            </span>
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">단체 생성 신청 내역이 없습니다.</p>
        )}
      </section>
    </div>
  );
}
