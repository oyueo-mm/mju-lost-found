"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { setOrganizationStatusAction } from "@/app/(main)/admin/organizations/actions";
import { Button } from "@/components/ui/Button";

// Phase 12-6 §8/§9/§26: 양방향(ACTIVE↔INACTIVE) 전환을 하나의 버튼으로 --
// 현재 상태에 따라 라벨/variant/다음 상태가 달라진다("현재 ACTIVE → 단체
// 비활성화" / "현재 INACTIVE → 단체 활성화", §26의 명시적 요구). 확인
// 대화상자를 거쳐야만 실제 요청이 나간다 -- 실수로 바로 전환되지 않도록.
export function OrganizationStatusToggle({
  organizationId,
  status,
}: {
  organizationId: number;
  status: "active" | "inactive";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus = status === "active" ? "inactive" : "active";
  const actionLabel = status === "active" ? "단체 비활성화" : "단체 활성화";
  const confirmMessage =
    status === "active"
      ? "이 단체를 비활성화하시겠습니까? 새 게시글/댓글/가입 신청이 차단되며, 기존 게시글/댓글/구성원은 그대로 유지됩니다."
      : "이 단체를 다시 활성화하시겠습니까?";

  async function handleClick() {
    if (!window.confirm(confirmMessage)) return;
    setPending(true);
    setError(null);
    const result = await setOrganizationStatusAction(organizationId, nextStatus);
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
        현재 상태:{" "}
        <span className="font-medium text-foreground">{status === "active" ? "ACTIVE" : "INACTIVE"}</span>
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        variant={status === "active" ? "destructive" : "primary"}
        size="sm"
        disabled={pending}
        onClick={handleClick}
        aria-label={`${actionLabel} (현재 ${status === "active" ? "ACTIVE" : "INACTIVE"})`}
        className="self-start"
      >
        {pending ? "처리 중..." : actionLabel}
      </Button>
    </div>
  );
}
