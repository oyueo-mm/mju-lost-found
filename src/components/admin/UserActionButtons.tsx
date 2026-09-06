"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { AdminUserDTO } from "@/lib/admin/users";
import { Button } from "@/components/ui/Button";

type UserActionButtonsProps = {
  user: AdminUserDTO;
  isSelf: boolean;
};

// Two independent toggles (관리자 권한, 정지 상태) on the same row -- unlike
// ReportProcessForm's single decision + multi-step confirm flow, these are
// two unrelated mutations, so each gets its own lightweight confirm()
// gate (same pattern CommentSection.tsx's delete button already uses)
// instead of a shared form. Server-side (updateUserByAdmin) re-checks
// isAdmin and rejects self-demote/self-suspend regardless of what this
// component disables -- the `disabled` props here are UX guidance only,
// never the actual safeguard.
export function UserActionButtons({ user, isSelf }: UserActionButtonsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"role" | "suspend" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callAction(action: "promote" | "demote" | "suspend" | "unsuspend", kind: "role" | "suspend") {
    setPending(kind);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "처리하지 못했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPending(null);
    }
  }

  function handleToggleRole() {
    const label = user.nickname ?? user.email;
    const message = user.isAdmin
      ? `${label}님의 관리자 권한을 해제하시겠습니까?`
      : `${label}님을 관리자로 지정하시겠습니까?`;
    if (!confirm(message)) return;
    callAction(user.isAdmin ? "demote" : "promote", "role");
  }

  function handleToggleSuspend() {
    const label = user.nickname ?? user.email;
    const message = user.isSuspended
      ? `${label}님의 정지를 해제하시겠습니까?`
      : `${label}님을 정지하시겠습니까?`;
    if (!confirm(message)) return;
    callAction(user.isSuspended ? "unsuspend" : "suspend", "suspend");
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={user.isAdmin ? "secondary" : "primary"}
          size="sm"
          onClick={handleToggleRole}
          disabled={pending !== null || (isSelf && user.isAdmin)}
        >
          {pending === "role" ? "처리 중..." : user.isAdmin ? "관리자 해제" : "관리자 지정"}
        </Button>
        <Button
          type="button"
          variant={user.isSuspended ? "secondary" : "destructive"}
          size="sm"
          onClick={handleToggleSuspend}
          disabled={pending !== null || (isSelf && !user.isSuspended)}
        >
          {pending === "suspend" ? "처리 중..." : user.isSuspended ? "정지 해제" : "정지"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
