"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";

type GoogleTestModeToggleProps = {
  initialEnabled: boolean;
  updatedByNickname: string | null;
  updatedAt: Date | null;
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

// Phase H-3: the button here toggling is UX only -- src/lib/auth/auth.ts's
// signIn callback and PATCH /api/admin/settings both re-verify server-side
// (fresh DB-sourced isAdmin for the API call, fail-closed read for the
// signIn gate) regardless of what this component shows or lets a viewer
// click. Server state (initialEnabled) is what actually governs sign-in
// until this component's own PATCH call changes it -- there is no client-
// only bypass anywhere in this flow.
export function GoogleTestModeToggle({ initialEnabled, updatedByNickname, updatedAt }: GoogleTestModeToggleProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (pending) return;
    const next = !enabled;
    const message = next
      ? "일반 Google 계정의 테스트 로그인을 허용하시겠습니까? OFF 하기 전까지 @mju.ac.kr이 아닌 계정도 로그인할 수 있습니다."
      : "테스트 모드를 끄시겠습니까? 이후 @mju.ac.kr 계정만 로그인할 수 있습니다.";
    if (!confirm(message)) return;

    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleTestModeEnabled: next }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "설정을 변경하지 못했습니다.");
        return;
      }
      setEnabled(next);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold text-foreground">일반 Google 계정 테스트 허용</h2>
          <p className="text-xs text-muted-foreground">
            OFF(기본값)일 때는 @mju.ac.kr 계정만 로그인할 수 있습니다. ON으로 켜면 일반 Google 계정도 임시로
            로그인할 수 있으며, 다시 OFF 하면 즉시 @mju.ac.kr 전용 정책으로 돌아갑니다.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            enabled ? "bg-warning-muted text-warning" : "bg-muted text-muted-foreground"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="button"
        variant={enabled ? "destructive" : "primary"}
        size="sm"
        onClick={handleToggle}
        disabled={pending}
        className="w-fit"
      >
        {pending ? "처리 중..." : enabled ? "테스트 모드 끄기" : "테스트 모드 켜기"}
      </Button>

      {updatedByNickname && updatedAt && (
        <p className="text-xs text-muted-foreground">
          마지막 변경: {updatedByNickname} · {formatDate(updatedAt)}
        </p>
      )}
    </section>
  );
}
