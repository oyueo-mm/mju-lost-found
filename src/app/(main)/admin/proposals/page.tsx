import { requireAdmin } from "@/lib/auth/session";
import { listAdminActionProposalsForAdmin } from "@/lib/admin/proposals";
import { AdminActionProposalRow } from "@/components/admin/AdminActionProposalRow";
import { ShieldIcon } from "@/components/icons";

// Phase 관리자 승인제: this app's own creation UI for an AdminActionProposal
// is the *existing* /admin/users action buttons (관리자 지정/해제, 정지,
// 정지 해제) -- see admin/users.ts::updateUserByAdmin()'s own comment for
// why the exact same server action/API endpoint a regular-user toggle
// already uses is what silently becomes "제안 생성" when the target
// requires it. This page is only the read/decide side of the workflow:
// the pending queue (with 승인/제안 취소) and the executed/cancelled/
// expired history, both driven by the same list so nothing here duplicates
// admin/proposals.ts's own status/approval logic.
export default async function AdminProposalsPage() {
  const admin = await requireAdmin();

  const result = await listAdminActionProposalsForAdmin(admin);
  const proposals = result.kind === "ok" ? result.data : [];
  const pending = proposals.filter((p) => p.status === "pending");
  const history = proposals.filter((p) => p.status !== "pending");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <ShieldIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">관리자 조치 제안</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        관리자를 대상으로 한 정지·정지 해제·관리자 권한 부여·해제는 이 화면(또는 /admin/users의 동일한 버튼)을 통해
        제안으로 생성되며, 제안자·대상자를 제외한 다른 활성 관리자의 승인을 받아야 실제로 적용됩니다. 필요한 승인 수는
        승인 시점에 다시 계산하며, 승인할 수 있는 활성 관리자(정지된 관리자·제안자·대상자 제외) 수와 2 중 작은 값입니다.
        활성 관리자가 1명뿐일 때는 관리자 권한 부여와 관리자 정지 해제만 그 관리자가 단독으로 즉시 실행할 수
        있고(감사 로그에 예외 사유 기록), 관리자 권한 해제·관리자 정지는 승인할 수 있는 관리자가 없으면 실행되지
        않습니다. 활성 관리자가 0명이 되는 조치는 항상 거부됩니다.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">대기 중인 제안 ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">대기 중인 제안이 없습니다.</p>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-card">
            {pending.map((p) => (
              <AdminActionProposalRow key={p.id} proposal={p} isProposer={p.proposedBy?.id === admin.id} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">처리 기록</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 처리된 제안이 없습니다.</p>
        ) : (
          <div className="overflow-hidden rounded-card border border-border bg-card">
            {history.map((p) => (
              <AdminActionProposalRow key={p.id} proposal={p} isProposer={p.proposedBy?.id === admin.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
