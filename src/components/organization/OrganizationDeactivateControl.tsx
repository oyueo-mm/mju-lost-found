"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { deactivateOrganizationAction } from "@/app/(main)/organizations/[id]/settings/actions";
import { Button } from "@/components/ui/Button";

// Phase 12-4 §22: 삭제가 아니라 ACTIVE -> INACTIVE 전환. 실행 즉시 되돌릴
// 방법이 이 UI에는 없으므로(재활성화는 이번 Phase 범위 밖, Phase 12-6의
// Platform Admin 단체 관리 페이지 몫) 확인 대화상자를 반드시 거친다.
export function OrganizationDeactivateControl({ organizationId }: { organizationId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeactivate() {
    if (!window.confirm("이 단체를 비활성화하시겠습니까? 비활성화된 단체는 새 가입 신청을 받을 수 없습니다.")) return;
    setPending(true);
    setError(null);
    const result = await deactivateOrganizationAction(organizationId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        비활성화된 단체는 목록에서 숨겨지고 새 가입 신청을 받을 수 없습니다. 기존 구성원/게시물은 영향을 받지 않습니다.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button variant="destructive" size="sm" disabled={pending} onClick={handleDeactivate} className="self-start">
        {pending ? "처리 중..." : "단체 비활성화"}
      </Button>
    </div>
  );
}
