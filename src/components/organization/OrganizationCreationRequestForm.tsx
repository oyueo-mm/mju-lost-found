"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createOrganizationCreationRequestAction } from "@/app/(main)/organizations/create/actions";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";

const FIELD_CLASS =
  "rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60";

// Phase 12-3: same "direct Server Action call inside a plain async
// handler, not useActionState" convention CreateAnnouncementForm.tsx/
// FeedbackForm.tsx already establish for this app's create-forms.
export function OrganizationCreationRequestForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [organizationType, setOrganizationType] = useState("");
  const [scope, setScope] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [purpose, setPurpose] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await createOrganizationCreationRequestAction({
      organizationName,
      organizationType,
      scope: scope.trim() || undefined,
      contactEmail,
      purpose,
    });
    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    setPending(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{t("organization.createRequest")}</h2>
      <p className="text-xs text-muted-foreground">
        학과 학생회, 동아리, 총학생회 등 단체 계정을 신청하면 운영자 검토 후 승인됩니다.
      </p>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("organization.name")}</span>
        <input
          type="text"
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          maxLength={200}
          required
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("organization.type")}</span>
        <input
          type="text"
          value={organizationType}
          onChange={(e) => setOrganizationType(e.target.value)}
          placeholder="예: 학생회, 동아리, 총학생회"
          maxLength={100}
          required
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("organization.scope")} ({t("organization.optional")})</span>
        <input
          type="text"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder="예: 컴퓨터공학과, 전체"
          maxLength={200}
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("organization.email")}</span>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          maxLength={200}
          required
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("organization.purpose")}</span>
        <textarea
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          maxLength={2000}
          rows={5}
          required
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="sm"
        disabled={pending || !organizationName.trim() || !organizationType.trim() || !contactEmail.trim() || !purpose.trim()}
        className="self-start"
      >
        {pending ? t("organization.submitting") : t("organization.submit")}
      </Button>
    </form>
  );
}
