"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateOrganizationProfileAction } from "@/app/(main)/organizations/[id]/settings/actions";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";

const FIELD_CLASS =
  "rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60";

// Phase 12-4 §11: name/organizationType/description/scope/contactEmail만
// 편집 가능 -- OrganizationStatus는 이 폼에 아예 없다(별도
// OrganizationDeactivateControl 전용).
export function OrganizationProfileEditForm({
  organizationId,
  organization,
}: {
  organizationId: number;
  organization: {
    name: string;
    organizationType: string;
    description: string | null;
    scope: string | null;
    contactEmail: string | null;
  };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState(organization.name);
  const [organizationType, setOrganizationType] = useState(organization.organizationType);
  const [description, setDescription] = useState(organization.description ?? "");
  const [scope, setScope] = useState(organization.scope ?? "");
  const [contactEmail, setContactEmail] = useState(organization.contactEmail ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(false);

    const result = await updateOrganizationProfileAction(organizationId, {
      name,
      organizationType,
      description: description.trim() || undefined,
      scope: scope.trim() || undefined,
      contactEmail: contactEmail.trim() || undefined,
    });

    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("organization.name")}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
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
          maxLength={200}
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("organization.email")} ({t("organization.optional")})</span>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          maxLength={200}
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("organization.description")} ({t("organization.optional")})</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={4}
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-success">{t("organization.saved")}</p>}

      <Button type="submit" size="sm" disabled={pending || !name.trim() || !organizationType.trim()} className="self-start">
        {pending ? t("organization.saving") : t("organization.save")}
      </Button>
    </form>
  );
}
