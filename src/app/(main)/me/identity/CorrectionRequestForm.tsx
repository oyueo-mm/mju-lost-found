"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import { requestIdentityCorrectionAction, type CorrectionState } from "./actions";

// 정정 요청 for the read-only 실명·소속: describes what is wrong, without
// the values themselves; it reaches the admins as a 문의.
export function CorrectionRequestForm() {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState<CorrectionState, FormData>(requestIdentityCorrectionAction, null);

  if (state && "ok" in state) {
    return <p className="rounded-lg bg-success-muted px-3 py-2 text-sm text-success">{t("identity.correction.sent")}</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <textarea
        name="content"
        required
        minLength={5}
        maxLength={1000}
        rows={3}
        placeholder={t("identity.correction.placeholder")}
        disabled={pending}
        className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
      />
      {state && "error" in state && <span className="text-xs text-destructive">{t(state.error)}</span>}
      <Button type="submit" variant="secondary" size="sm" disabled={pending} className="self-start">
        {pending ? t("identity.correction.sending") : t("identity.correction.submit")}
      </Button>
    </form>
  );
}
