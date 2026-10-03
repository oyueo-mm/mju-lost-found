import { requireAdmin } from "@/lib/auth/session";
import { listExternalAccessGrants } from "@/lib/externalAccess/service";
import { ExternalAccessForm } from "@/components/admin/ExternalAccessForm";
import { ExternalAccessRow } from "@/components/admin/ExternalAccessRow";
import { ShieldIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(date);
}

// Approved external accounts (경비원·시설관리자·협력업체 등). Reached from the
// 관리자 센터 dashboard tile. Same page-level requireAdmin() as every other
// /admin page; the list call and every action re-check admin rights.
export default async function AdminExternalAccessPage() {
  const admin = await requireAdmin();
  const result = await listExternalAccessGrants(admin);
  const grants = result.kind === "ok" ? result.data : [];
  const activeCount = grants.filter((g) => g.status === "ACTIVE").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ShieldIcon className="size-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">외부 관계자 승인</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          승인된 이메일의 Google 계정은 &lsquo;인증된 외부 관계자&rsquo;로 로그인합니다. 승인을 취소하면 즉시 이용이
          중단됩니다. 단체 명의로 활동해야 한다면 해당 단체에 가입시킨 뒤 운영진으로 지정해주세요.
        </p>
      </div>

      <ExternalAccessForm />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-foreground">
          등록된 외부 관계자 <span className="text-sm font-normal text-muted-foreground">승인 {activeCount}명 · 전체 {grants.length}명</span>
        </h2>
        {grants.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            아직 등록된 외부 관계자가 없어요.
          </p>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-card">
            {grants.map((g) => (
              <ExternalAccessRow
                key={g.id}
                grant={{
                  id: g.id,
                  email: g.email,
                  name: g.name,
                  affiliation: g.affiliation,
                  campus: g.campus,
                  status: g.status,
                  createdAtLabel: formatDate(g.createdAt),
                  createdByNickname: g.createdByNickname,
                  revokedAtLabel: g.revokedAt ? formatDate(g.revokedAt) : null,
                  revokedByNickname: g.revokedByNickname,
                  account: g.account,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
