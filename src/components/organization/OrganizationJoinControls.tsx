"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  cancelOrganizationJoinRequestAction,
  createOrganizationJoinRequestAction,
  leaveOrganizationAction,
} from "@/app/(main)/organizations/[id]/actions";
import { Button, LinkButton } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";

// Phase 12-4 §9/§21: 단체 프로필 페이지의 "가입/탈퇴" 상태 전이를 하나의
// 클라이언트 컴포넌트에서 담당한다 -- 서버가 내려준 초기 상태(myRole/
// pendingRequestId)로 어떤 UI를 보여줄지 결정하고, 실제 mutation 가능 여부는
// 매번 각 Server Action(-> service 함수)이 다시 검증한다(이 컴포넌트는 그
// 결과의 성공/실패만 반영).
export function OrganizationJoinControls({
  organizationId,
  organizationStatus,
  isLoggedIn,
  myRole,
  pendingRequestId,
}: {
  organizationId: number;
  organizationStatus: "active" | "inactive";
  isLoggedIn: boolean;
  myRole: "leader" | "admin" | "member" | null;
  pendingRequestId: number | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setPending(true);
    setError(null);
    const result = await createOrganizationJoinRequestAction(organizationId, { message: message.trim() || undefined });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleCancel() {
    if (pendingRequestId === null) return;
    setPending(true);
    setError(null);
    const result = await cancelOrganizationJoinRequestAction(organizationId, pendingRequestId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleLeave() {
    if (!window.confirm(t("organization.leave"))) return;
    setPending(true);
    setError(null);
    const result = await leaveOrganizationAction(organizationId);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (!isLoggedIn) {
    return (
      <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">로그인 후 가입 신청할 수 있습니다.</p>
        <LinkButton href="/login" size="sm" className="self-start">
          로그인
        </LinkButton>
      </div>
    );
  }

  if (myRole !== null) {
    return (
      <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">{t("organization.joined")}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="secondary" size="sm" className="self-start" disabled={pending} onClick={handleLeave}>
          {pending ? t("organization.processing") : t("organization.leave")}
        </Button>
      </div>
    );
  }

  if (pendingRequestId !== null) {
    return (
      <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">{t("organization.pending")}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="secondary" size="sm" className="self-start" disabled={pending} onClick={handleCancel}>
          {pending ? t("organization.processing") : t("organization.cancelRequest")}
        </Button>
      </div>
    );
  }

  if (organizationStatus === "inactive") {
    return (
      <div className="rounded-card border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">비활성화된 단체에는 가입 신청할 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground">{t("organization.join")}</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="가입 신청 메시지 (선택)"
        disabled={pending}
        className="rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="sm" className="self-start" disabled={pending} onClick={handleJoin}>
        {pending ? t("organization.submitting") : t("organization.join")}
      </Button>
    </div>
  );
}
