"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cancelOrganizationCreationRequestAction } from "@/app/(main)/organizations/create/actions";
import { Button } from "@/components/ui/Button";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";

function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

type PendingOrganizationRequestCardProps = {
  request: {
    id: number;
    organizationName: string;
    organizationType: string;
    scope: string | null;
    contactEmail: string;
    purpose: string;
    createdAt: Date;
  };
};

// Phase 12-3: /organizations/create가 폼 대신 이 카드를 보여주는 것은 이
// 사용자에게 이미 PENDING 상태인 신청이 있을 때뿐 -- 새 신청을 만들 수
// 없는 이유(§6 중복 신청 정책)를 그대로 보여주고, 취소만 가능하게 한다.
export function PendingOrganizationRequestCard({ request }: PendingOrganizationRequestCardProps) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await cancelOrganizationCreationRequestAction(request.id);
    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }

    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t("organization.createRequest")}</h2>
        <span className="shrink-0 rounded-full bg-warning-muted px-2.5 py-1 text-xs font-medium text-warning">{t("organization.pending")}</span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-foreground">
          {request.organizationType} · {request.organizationName}
        </span>
        {request.scope && <span className="text-muted-foreground">{t("organization.scope")}: {request.scope}</span>}
        <span className="text-muted-foreground">{t("organization.email")}: {request.contactEmail}</span>
        <span className="whitespace-pre-wrap text-muted-foreground">{request.purpose}</span>
        <span className="text-xs text-muted-foreground/70">{t("organization.requestDate", { date: formatDate(request.createdAt, locale) })}</span>
      </div>

      <p className="text-xs text-muted-foreground">
        운영자가 검토 중입니다. 처리 결과는 알림으로 안내됩니다. 검토가 끝나기 전까지는 새 신청을 만들 수 없어요.
      </p>

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="button" variant="secondary" size="sm" onClick={handleCancel} disabled={pending} className="self-start">
        {pending ? t("organization.canceling") : t("organization.cancelRequest")}
      </Button>
    </div>
  );
}
