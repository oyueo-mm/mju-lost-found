"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { updateOrganizationProfileAction } from "@/app/(main)/organizations/[id]/settings/actions";
import { Button } from "@/components/ui/Button";

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
        <span className="font-medium text-foreground">단체명</span>
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
        <span className="font-medium text-foreground">단체 유형</span>
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
        <span className="font-medium text-foreground">활동 범위 (선택)</span>
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
        <span className="font-medium text-foreground">연락 이메일 (선택)</span>
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
        <span className="font-medium text-foreground">설명 (선택)</span>
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
      {saved && !error && <p className="text-sm text-success">저장되었습니다.</p>}

      <Button type="submit" size="sm" disabled={pending || !name.trim() || !organizationType.trim()} className="self-start">
        {pending ? "저장 중..." : "저장"}
      </Button>
    </form>
  );
}
