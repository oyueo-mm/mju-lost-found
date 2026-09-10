"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { deactivateOrganizationAction } from "@/app/(main)/organizations/[id]/settings/actions";
import { Button } from "@/components/ui/Button";

// Phase 12-4 §22 / Phase 12-9 §7/§8: 삭제가 아니라 ACTIVE -> INACTIVE
// 전환(사용자 화면 표현은 "폐쇄" -- 내부적으로는 기존 deactivateOrganization()
// 서비스 함수/OrganizationStatus.INACTIVE를 그대로 재사용, 새 상태를 추가하지
// 않는다). LEADER 본인이 실행 즉시 되돌릴 방법이 이 UI에는 없으므로(재활성화는
// Phase 12-6의 Platform Admin 단체 관리 페이지 전용) 확인 대화상자를 반드시
// 거친다.
export function OrganizationDeactivateControl({ organizationId }: { organizationId: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeactivate() {
    if (
      !window.confirm(
        "단체를 폐쇄하시겠습니까?\n\n폐쇄 후 새로운 단체 활동(게시글/댓글 작성, 가입 신청 등)을 할 수 없습니다.\n기존 게시글과 기록은 유지됩니다.",
      )
    )
      return;
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
        폐쇄된 단체는 목록에서 숨겨지고 새 게시글/댓글 귀속·가입 신청을 받을 수 없습니다. 기존 구성원/게시글/댓글/기록은 그대로 유지됩니다.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button variant="destructive" size="sm" disabled={pending} onClick={handleDeactivate} className="self-start">
        {pending ? "처리 중..." : "단체 폐쇄"}
      </Button>
    </div>
  );
}
