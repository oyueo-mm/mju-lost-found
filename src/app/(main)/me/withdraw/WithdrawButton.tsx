"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";

// Phase 10: same checkbox-gates-button pattern as
// privacy-consent/PrivacyConsentButton.tsx -- disabled until the box is
// checked, no forced scroll. The actual mutation goes through POST
// /api/me/withdraw; this component never sends anything beyond that
// authenticated request and the chosen mode (no userId) -- the server
// resolves who's withdrawing from the session alone.
//
// 회원탈퇴: mode "deactivate" (reversible) or "delete" (irreversible).
const COPY = {
  deactivate: {
    agree: "위 내용을 확인했으며, 계정 비활성화에 동의합니다.",
    button: "계정 비활성화하기",
    failed: "계정 비활성화를 처리하지 못했습니다. 다시 시도해주세요.",
  },
  delete: {
    agree: "탈퇴하면 이 계정을 복구할 수 없다는 것을 확인했으며, 회원탈퇴에 동의합니다.",
    button: "회원탈퇴하기",
    failed: "회원탈퇴를 처리하지 못했습니다. 다시 시도해주세요.",
  },
} as const;

export function WithdrawButton({ mode }: { mode: "deactivate" | "delete" }) {
  const { t } = useI18n();
  const router = useRouter();
  const checkboxId = useId();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];

  async function handleWithdraw() {
    if (submitting || !checked) return;
    if (mode === "delete" && !window.confirm("회원탈퇴는 되돌릴 수 없습니다. 정말 탈퇴할까요?")) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/me/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? copy.failed);
        return;
      }
      // The API already cleared the session cookie (signOut) -- landing
      // on "/" shows the logged-out LandingHero, same destination /me's
      // own logout button already uses.
      router.push("/");
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <label htmlFor={checkboxId} className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground">
        <input
          id={checkboxId}
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={submitting}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border-border text-destructive accent-destructive disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span>{copy.agree}</span>
      </label>

      <Button
        type="button"
        variant="destructive"
        onClick={handleWithdraw}
        disabled={submitting || !checked}
        className="w-full"
      >
        {submitting ? "처리 중..." : copy.button}
      </Button>
    </div>
  );
}
