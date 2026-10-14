"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { ChevronRightIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { DEPARTMENT_MAX_LENGTH, REAL_NAME_MAX_LENGTH } from "@/lib/identity/validation";
import { saveIdentityAction, type SaveIdentityState } from "./actions";

const FIELD_CLASS = "rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground disabled:opacity-60";

type IdentityFormProps = {
  initial: { realName: string; department: string } | null;
  // Which fields start from a plain Google name suggestion (shown with a
  // "check this" note -- never presented as verified).
  prefilled?: { realName: boolean; department: boolean };
  callbackUrl: string | null;
  onboarding: boolean;
};

// 직접 입력 -- the exception path of /me/identity, only for an account
// whose Google display name gives no usable 실명·소속 (values collected from
// Google are shown read-only instead).
export function IdentityForm({ initial, prefilled, callbackUrl, onboarding }: IdentityFormProps) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState<SaveIdentityState, FormData>(saveIdentityAction, null);
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      {onboarding && <input type="hidden" name="onboarding" value="1" />}

      {errors.form && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-4 py-2.5 text-sm text-destructive">
          {t(errors.form)}
        </p>
      )}

      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">{t("identity.realName")}</span>
          <input
            name="realName"
            type="text"
            autoComplete="name"
            required
            maxLength={REAL_NAME_MAX_LENGTH}
            placeholder={t("identity.realNamePlaceholder")}
            defaultValue={initial?.realName}
            disabled={pending}
            aria-invalid={errors.realName ? true : undefined}
            className={FIELD_CLASS}
          />
          {prefilled?.realName && <span className="text-xs text-primary">{t("identity.prefilledName")}</span>}
          {errors.realName && <span className="text-xs text-destructive">{t(errors.realName)}</span>}
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">{t("identity.department")}</span>
          <input
            name="department"
            type="text"
            autoComplete="organization"
            required
            maxLength={DEPARTMENT_MAX_LENGTH}
            placeholder={t("identity.departmentPlaceholder")}
            defaultValue={initial?.department}
            disabled={pending}
            aria-invalid={errors.department ? true : undefined}
            className={FIELD_CLASS}
          />
          <span className="text-xs text-muted-foreground">{t("identity.departmentHelp")}</span>
          {prefilled?.department && <span className="text-xs text-primary">{t("identity.prefilledDepartment")}</span>}
          {errors.department && <span className="text-xs text-destructive">{t(errors.department)}</span>}
        </label>

        <p className="text-xs leading-relaxed text-muted-foreground">{t("identity.selfReported")}</p>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 text-sm">
        {/* 이름·소속 are required items of the 개인정보 동의 the member already
            gave -- shown here for reference, no separate checkbox. */}
        <details className="group flex flex-col gap-2">
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-primary">
            {t("identity.consentDetails")}
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            <li>{t("identity.consent.items")}</li>
            <li>{t("identity.consent.prefill")}</li>
            <li>{t("identity.consent.purpose")}</li>
            <li>{t("identity.consent.access")}</li>
            <li>{t("identity.consent.retention")}</li>
            <li>{t("identity.consent.refuse")}</li>
          </ul>
          <Link href="/policy/privacy" target="_blank" className="mt-1 w-fit text-xs font-medium text-primary hover:opacity-80">
            {t("identity.policyLink")}
          </Link>
        </details>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? t("identity.saving") : t("identity.save")}
        </Button>
        {onboarding && (
          <Link href={callbackUrl ?? "/"} className="py-2 text-center text-sm text-muted-foreground hover:text-foreground sm:px-3">
            {t("identity.later")}
          </Link>
        )}
      </div>
    </form>
  );
}
