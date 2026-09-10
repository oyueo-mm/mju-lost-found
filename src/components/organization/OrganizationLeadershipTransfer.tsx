"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { transferLeadershipAction } from "@/app/(main)/organizations/[id]/settings/actions";
import { Button } from "@/components/ui/Button";

type Member = { user: { id: number; nickname: string | null } };

// Phase 12-4 §20: 대상은 현재 이 단체의 ADMIN/MEMBER여야 한다(본인 제외) --
// 이 셀렉트는 members prop(이미 이 단체의 구성원 목록)에서만 고르게 해서
// 외부 사용자를 대상으로 지정할 수 없도록 한다. 실제 승계는
// transferLeadership()이 다시 대상 멤버십을 조회해 검증.
export function OrganizationLeadershipTransfer({
  organizationId,
  members,
  myUserId,
}: {
  organizationId: number;
  members: Member[];
  myUserId: number;
}) {
  const router = useRouter();
  const candidates = members.filter((m) => m.user.id !== myUserId);
  const [targetUserId, setTargetUserId] = useState<number | "">(candidates[0]?.user.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTransfer() {
    if (targetUserId === "") return;
    const target = candidates.find((c) => c.user.id === targetUserId);
    if (!window.confirm(`${target?.user.nickname ?? "선택한 구성원"}에게 대표 관리자 권한을 위임하시겠습니까? 본인은 일반 관리자가 됩니다.`)) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await transferLeadershipAction(organizationId, targetUserId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">승계할 수 있는 다른 구성원이 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">위임 후 본인은 일반 관리자가 되고, 선택한 구성원이 새 대표 관리자가 됩니다.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={targetUserId}
          onChange={(e) => setTargetUserId(Number(e.target.value))}
          disabled={pending}
          className="rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60"
        >
          {candidates.map((c) => (
            <option key={c.user.id} value={c.user.id}>
              {c.user.nickname ?? `사용자 #${c.user.id}`}
            </option>
          ))}
        </select>
        <Button variant="destructive" size="sm" disabled={pending} onClick={handleTransfer}>
          {pending ? "처리 중..." : "대표 관리자 위임"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
