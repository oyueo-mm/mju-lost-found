import Link from "next/link";

import { listActiveOrganizations } from "@/lib/organization/service";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShieldIcon } from "@/components/icons";

// Phase 12-4 §4/§24: /lost, /found와 동일하게 로그인 여부와 무관하게 누구나
// 볼 수 있는 목록 -- (main)/layout.tsx는 정지된 로그인 사용자만 리다이렉트할
// 뿐, 비로그인 사용자를 막지 않는다(그 패턴을 그대로 따름). ACTIVE 단체만
// 노출하며(listActiveOrganizations 자체가 이미 ACTIVE만 조회), 이름순 정렬.
export default async function OrganizationsPage() {
  const organizations = await listActiveOrganizations();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">단체</h1>

      {organizations.length === 0 ? (
        <EmptyState title="등록된 단체가 없습니다" description="아직 승인된 단체가 없습니다." />
      ) : (
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
      )}
    </div>
  );
}
