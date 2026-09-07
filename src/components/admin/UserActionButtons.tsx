"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { AdminUserDTO } from "@/lib/admin/users";
import { SUSPEND_DURATION_DAY_OPTIONS } from "@/lib/moderation/schema";
import { Button } from "@/components/ui/Button";

type UserActionButtonsProps = {
  user: AdminUserDTO;
  isSelf: boolean;
};

type SuspendChoice = `${(typeof SUSPEND_DURATION_DAY_OPTIONS)[number]}` | "permanent" | "custom";

const MIN_CUSTOM_DAYS = 1;
const MAX_CUSTOM_DAYS = 365;

// Two independent toggles (관리자 권한, 정지 상태) on the same row -- unlike
// ReportProcessForm's single decision + multi-step confirm flow, these are
// two unrelated mutations, so each gets its own lightweight confirm()
// gate (same pattern CommentSection.tsx's delete button already uses)
// instead of a shared form. Server-side (updateUserByAdmin) re-checks
// isAdmin and rejects self-demote/self-suspend regardless of what this
// component disables -- the `disabled` props here are UX guidance only,
// never the actual safeguard.
//
// Phase F-2: the suspend toggle grew a duration picker (same
// 1일/3일/7일/30일/영구/사용자 지정 shape as ReportProcessForm's own picker,
// see that component) instead of a single confirm() that always suspended
// permanently. Which button renders (정지 vs 정지 해제) is driven by
// user.currentlySuspended -- the isCurrentlySuspended()-derived field from
// admin/users.ts -- not the raw isSuspended flag, so an admin never sees
// "정지 해제" for a timed suspension that has already expired.
export function UserActionButtons({ user, isSelf }: UserActionButtonsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"role" | "suspend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suspendMenuOpen, setSuspendMenuOpen] = useState(false);
  const [suspendChoice, setSuspendChoice] = useState<SuspendChoice>(`${SUSPEND_DURATION_DAY_OPTIONS[0]}`);
  const [customDays, setCustomDays] = useState("");

  async function callAction(
    action: "promote" | "demote" | "suspend" | "unsuspend",
    kind: "role" | "suspend",
    suspendDurationDays?: number,
  ) {
    setPending(kind);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suspendDurationDays !== undefined ? { action, suspendDurationDays } : { action }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "처리하지 못했습니다.");
        return;
      }
      setSuspendMenuOpen(false);
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

  function handleUnsuspend() {
    const label = user.nickname ?? user.email;
    if (!confirm(`${label}님의 정지를 해제하시겠습니까?`)) return;
    callAction("unsuspend", "suspend");
  }

  // Client-side range check only -- purely so a mistyped custom value
  // shows an inline message instead of a round trip to the server. The
  // real gate is the server's own suspendDurationDays schema (positive,
  // int, max 365, see admin/schema.ts), which runs regardless of this.
  function handleSuspendConfirm() {
    let duration: number | undefined;
    if (suspendChoice === "permanent") {
      duration = undefined;
    } else if (suspendChoice === "custom") {
      const n = Number(customDays);
      if (!Number.isInteger(n) || n < MIN_CUSTOM_DAYS || n > MAX_CUSTOM_DAYS) {
        setError(`사용자 지정 기간은 ${MIN_CUSTOM_DAYS}~${MAX_CUSTOM_DAYS}일 사이의 정수여야 합니다.`);
        return;
      }
      duration = n;
    } else {
      duration = Number(suspendChoice);
    }

    const label = user.nickname ?? user.email;
    const durationLabel = duration ? `${duration}일` : "영구";
    if (!confirm(`${label}님을 ${durationLabel} 정지하시겠습니까?`)) return;
    callAction("suspend", "suspend", duration);
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
        {user.currentlySuspended ? (
          <Button type="button" variant="secondary" size="sm" onClick={handleUnsuspend} disabled={pending !== null}>
            {pending === "suspend" ? "처리 중..." : "정지 해제"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              setError(null);
              setSuspendMenuOpen((open) => !open);
            }}
            disabled={pending !== null || isSelf}
          >
            정지
          </Button>
        )}
      </div>

      {suspendMenuOpen && (
        <div className="flex w-full max-w-xs flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive-muted p-3 text-xs">
          <div className="flex flex-wrap gap-2.5">
            {SUSPEND_DURATION_DAY_OPTIONS.map((d) => (
              <label key={d} className="flex items-center gap-1 text-foreground">
                <input
                  type="radio"
                  name={`suspend-duration-${user.id}`}
                  checked={suspendChoice === `${d}`}
                  onChange={() => setSuspendChoice(`${d}`)}
                />
                {d}일
              </label>
            ))}
            <label className="flex items-center gap-1 text-foreground">
              <input
                type="radio"
                name={`suspend-duration-${user.id}`}
                checked={suspendChoice === "permanent"}
                onChange={() => setSuspendChoice("permanent")}
              />
              영구
            </label>
            <label className="flex items-center gap-1 text-foreground">
              <input
                type="radio"
                name={`suspend-duration-${user.id}`}
                checked={suspendChoice === "custom"}
                onChange={() => setSuspendChoice("custom")}
              />
              사용자 지정
            </label>
          </div>
          {suspendChoice === "custom" && (
            <label className="flex items-center gap-1.5 text-foreground">
              <input
                type="number"
                min={MIN_CUSTOM_DAYS}
                max={MAX_CUSTOM_DAYS}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                className="w-16 rounded border border-border bg-card px-1.5 py-1"
              />
              일 ({MIN_CUSTOM_DAYS}~{MAX_CUSTOM_DAYS})
            </label>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleSuspendConfirm}
              disabled={pending !== null}
            >
              {pending === "suspend" ? "처리 중..." : "확인"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSuspendMenuOpen(false)}
              disabled={pending !== null}
            >
              취소
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
