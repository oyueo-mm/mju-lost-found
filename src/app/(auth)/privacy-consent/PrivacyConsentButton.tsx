"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";

type PrivacyConsentButtonProps = {
  // Already sanitized server-side (see page.tsx's own sanitizeCallbackUrl
  // call) -- this component just uses it as-is.
  callbackUrl: string | null;
};

// Phase 8 (checkbox revision): the checkbox is purely a client-side gate
// on the button -- it does not change what's sent to the server, and it
// isn't "scroll to the bottom to unlock" (this phase's spec explicitly
// rules that pattern out). The actual mutation still goes through POST
// /api/me/privacy-consent (not a Server Action -- server generates the
// timestamp itself, see auth/user.ts's recordPrivacyConsent), and the
// server never sees or trusts whether/when the checkbox was checked --
// only that the request happened, from an authenticated session. Checking
// the box and never clicking the button leaves privacyConsentAt exactly
// as it was (still NULL for a first-time user).
export function PrivacyConsentButton({ callbackUrl }: PrivacyConsentButtonProps) {
  const router = useRouter();
  const checkboxId = useId();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAgree() {
    if (submitting || !checked) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/me/privacy-consent", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "동의를 처리하지 못했습니다. 다시 시도해주세요.");
        return;
      }
      // router.refresh() so the next server render picks up the just-set
      // privacyConsentAt (getCurrentUser() re-reads the DB, see
      // session.ts) -- push alone would navigate but could still hit a
      // stale RSC cache of this same route's own layout/page tree.
      router.push(callbackUrl ?? "/");
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
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
          // size-5 (not the browser default ~13px) so the tap target is
          // comfortable at 375/390px -- this phase's own mobile checklist
          // explicitly calls out "checkbox 터치 영역 충분".
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border-border text-primary accent-primary disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span>개인정보 수집·이용에 동의합니다.</span>
      </label>

      {/* "시작하기" reads friendlier than "동의하고 계속하기", but the
          checkbox right above it (and its explicit "개인정보 수집·이용에
          동의합니다." label) is what keeps the button's actual meaning --
          agreeing to the privacy notice -- unambiguous, per this phase's
          own "버튼이 동의하는 행위라는 사실이 명확하게 드러나야 한다". */}
      <Button type="button" onClick={handleAgree} disabled={submitting || !checked} className="w-full">
        {submitting ? "처리 중..." : "시작하기"}
      </Button>
    </div>
  );
}
