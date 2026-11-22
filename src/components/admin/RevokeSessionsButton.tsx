"use client";

import { useState } from "react";

// Security audit P-5: 로그인 강제 종료 -- ends every session of this member
// (all devices) without suspending the account. The server re-checks the
// permission (users.sanction; a full administrator for an admin target).
export function RevokeSessionsButton({ userId, nickname }: { userId: number; nickname: string | null }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function revoke() {
    if (!window.confirm(`${nickname ?? "이 사용자"}님의 모든 기기 로그인을 종료할까요? 계정은 정지되지 않으며, 다시 로그인할 수 있어요.`)) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke_sessions" }),
      });
      setMessage(res.ok ? "모든 기기의 로그인을 종료했어요." : res.status === 403 ? "이 사용자의 로그인을 종료할 권한이 없어요." : "로그인을 종료하지 못했어요. 잠시 후 다시 시도해주세요.");
    } catch {
      setMessage("로그인을 종료하지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={revoke}
        disabled={pending}
        className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-60"
      >
        {pending ? "처리 중..." : "로그인 강제 종료"}
      </button>
      {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
    </div>
  );
}
