"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { ChevronRightIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import type { IdentityHintSource } from "@/lib/identity/googleHints";
import { DEPARTMENT_MAX_LENGTH, REAL_NAME_MAX_LENGTH } from "@/lib/identity/validation";
import type { TranslationKey } from "@/lib/i18n/translate";
import { saveIdentityAction, type SaveIdentityState } from "./actions";

const FIELD_CLASS = "rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground disabled:opacity-60";

type IdentityFormProps = {
  initial: { realName: string; department: string } | null;
  // Already agreed with the current consent version: the box reflects that.
  consentGiven: boolean;
  // Which fields start from a Google suggestion, and from where (shown
  // with a "check this" note -- never presented as verified).
  prefilled?: { realName: IdentityHintSource | null; department: IdentityHintSource | null };
  callbackUrl: string | null;
  onboarding: boolean;
};

const NAME_NOTICE: Record<IdentityHintSource, TranslationKey> = {
  google_profile: "identity.prefilledName",
  google_display_name: "identity.prefilledNameFromDisplayName",
  google_people: "identity.prefilledName",
};
// The display-name affiliation may be a college, not a department.
const DEPARTMENT_NOTICE: Record<IdentityHintSource, TranslationKey> = {
  google_profile: "identity.prefilledDepartment",
  google_display_name: "identity.prefilledAffiliationFromDisplayName",
  google_people: "identity.prefilledDepartment",
};

export function IdentityForm({ initial, consentGiven, prefilled, callbackUrl, onboarding }: IdentityFormProps) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState<SaveIdentityState, FormData>(saveIdentityAction, null);
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      {onboarding && <input type="hidden" name="onboarding" value="1" />}

      {prefilled?.realName && prefilled.department && (
        <p className="rounded-card bg-primary-muted px-4 py-2.5 text-sm text-primary">{t("identity.prefilledReadyToSave")}</p>
      )}

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
          {prefilled?.realName && <span className="text-xs text-primary">{t(NAME_NOTICE[prefilled.realName])}</span>}
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
          {prefilled?.department && <span className="text-xs text-primary">{t(DEPARTMENT_NOTICE[prefilled.department])}</span>}
          {errors.department && <span className="text-xs text-destructive">{t(errors.department)}</span>}
        </label>

        <p className="text-xs leading-relaxed text-muted-foreground">{t("identity.selfReported")}</p>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 text-sm">
        <label className="flex items-start gap-2.5">
          <input type="checkbox" name="consent" defaultChecked={consentGiven} disabled={pending} className="mt-0.5 size-4 shrink-0" />
          <span className="font-medium text-foreground">{t("identity.consentLabel")}</span>
        </label>
        {errors.consent && <span className="text-xs text-destructive">{t(errors.consent)}</span>}
        <details className="group flex flex-col gap-2 border-t border-border pt-3">
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
