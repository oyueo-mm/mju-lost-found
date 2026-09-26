"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  createKeywordAlertAction,
  deleteKeywordAlertAction,
  updateKeywordAlertAction,
} from "@/app/(main)/me/keyword-alerts/actions";
import type { KeywordAlertDTO } from "@/lib/keywordAlert/service";
import { KeywordAlertForm, type KeywordAlertFormValues } from "./KeywordAlertForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { PenIcon, XIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { campusLabelKey, categoryLabelKey } from "@/lib/i18n/labels";

function KeywordAlertSummaryCard({
  alert,
  onEdit,
  onDelete,
  pending,
}: {
  alert: KeywordAlertDTO;
  onEdit: () => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();

  const postTypeLabel =
    alert.postType === "all" ? t("common.all") : alert.postType === "lost" ? t("nav.lost") : t("nav.found");
  const campusLabel =
    alert.campuses.length === 0 ? t("common.all") : alert.campuses.map((c) => t(campusLabelKey(c) ?? "form.campus")).join(", ");
  const categoryLabel =
    alert.categories.length === 0
      ? t("common.all")
      : alert.categories.map((c) => t(categoryLabelKey(c) ?? "form.category")).join(", ");

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-semibold text-foreground">{alert.keyword}</p>
        {/* 모바일에서도 누르기 편하도록 아이콘 버튼 두 개만 -- 텍스트
            라벨은 aria-label로만 (한 손 엄지 조작 기준 44px 안팎을
            유지하려고 size-9 유지, 다른 아이콘 버튼들과 동일한 크기). */}
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            aria-label={t("common.edit")}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <PenIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            aria-label={t("common.delete")}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive-muted hover:text-destructive disabled:opacity-50"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {postTypeLabel} · {t("form.campus")}: {campusLabel} · {t("form.category")}: {categoryLabel}
      </p>
      {alert.excludeKeywords.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("keywordAlert.form.excludeKeywords")}: {alert.excludeKeywords.join(", ")}
        </p>
      )}
    </div>
  );
}

// 이 페이지 하나가 "새 알림 만들기" 폼 + "내 키워드 알림" 목록을 함께
// 갖는다 -- FeedbackPage(제출 폼 + 내가 보낸 의견 목록)와 같은 구조. 서버
// 컴포넌트(page.tsx)가 매번 최신 목록을 이 컴포넌트의 props로 내려주므로,
// 이 컴포넌트 자신은 alerts 배열을 따로 복제해 들고 있지 않고
// router.refresh()로 부모를 다시 렌더링시킨다 -- 로컬 state는 "지금 어느
// 카드가 수정 모드인지"만 갖는다.
export function KeywordAlertManager({ alerts }: { alerts: KeywordAlertDTO[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  async function handleCreate(values: KeywordAlertFormValues) {
    const result = await createKeywordAlertAction(values);
    if ("ok" in result) router.refresh();
    return result;
  }

  async function handleUpdate(id: number, values: KeywordAlertFormValues) {
    const result = await updateKeywordAlertAction(id, values);
    if ("ok" in result) {
      setEditingId(null);
      router.refresh();
    }
    return result;
  }

  async function handleDelete(id: number) {
    if (!confirm(t("keywordAlert.deleteConfirm"))) return;
    setPendingDeleteId(id);
    setListError(null);
    const result = await deleteKeywordAlertAction(id);
    setPendingDeleteId(null);
    if ("error" in result) {
      setListError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <KeywordAlertForm submitLabel={t("keywordAlert.form.submit")} onSubmit={handleCreate} />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">{t("keywordAlert.list.title")}</h2>

        {listError && <p className="text-sm text-destructive">{listError}</p>}

        {alerts.length === 0 ? (
          <EmptyState title={t("keywordAlert.empty")} description={t("keywordAlert.empty.description")} />
        ) : (
          <div className="flex flex-col gap-3">
            {alerts.map((alert) =>
              editingId === alert.id ? (
                <KeywordAlertForm
                  key={alert.id}
                  initial={alert}
                  submitLabel={t("common.save")}
                  onSubmit={(values) => handleUpdate(alert.id, values)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <KeywordAlertSummaryCard
                  key={alert.id}
                  alert={alert}
                  onEdit={() => setEditingId(alert.id)}
                  onDelete={() => handleDelete(alert.id)}
                  pending={pendingDeleteId === alert.id}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
