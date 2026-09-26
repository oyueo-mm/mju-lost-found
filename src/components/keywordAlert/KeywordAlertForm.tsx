"use client";

import { useState } from "react";

import { CAMPUSES, CATEGORIES } from "@/lib/posts/schema";
import { KEYWORD_ALERT_POST_TYPES, type KeywordAlertPostTypeValue } from "@/lib/keywordAlert/schema";
import { MAX_EXCLUDE_KEYWORDS_PER_ALERT, KEYWORD_MAX_LENGTH } from "@/lib/keywordAlert/config";
import type { KeywordAlertDTO } from "@/lib/keywordAlert/service";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import { campusLabelKey, categoryLabelKey } from "@/lib/i18n/labels";

const FIELD_CLASS =
  "rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60";

export type KeywordAlertFormValues = {
  keyword: string;
  postType: KeywordAlertPostTypeValue;
  campuses: string[];
  categories: string[];
  excludeKeywords: string[];
};

function toFormValues(alert?: KeywordAlertDTO): KeywordAlertFormValues {
  return {
    keyword: alert?.keyword ?? "",
    postType: alert?.postType ?? "all",
    campuses: alert?.campuses ?? [],
    categories: alert?.categories ?? [],
    excludeKeywords: alert?.excludeKeywords ?? [],
  };
}

// 캠퍼스/카테고리 둘 다 "선택 안 함 = 전체"라 토글마다 배열에서 추가/제거만
// 하면 된다 -- 별도의 "전체" 체크박스 항목을 만들지 않고, 빈 배열 자체가
// 곧 "전체"를 뜻한다는 걸 헬퍼 텍스트로 설명한다(아래 form.campus/
// form.category 라벨 옆 hint).
function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

// PostForm.tsx의 campus 토글 버튼과 같은 모양(Button variant 전환)이지만,
// 여기서는 여러 개를 동시에 선택할 수 있어야 해서(하나만 활성화되는 그
// 컴포넌트의 aria-pressed 규칙과 달리) 각자 독립적으로 눌렸다 떨어진다.
function MultiToggleGroup({
  ariaLabel,
  options,
  selected,
  onToggle,
  disabled,
}: {
  ariaLabel: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map(({ value, label }) => (
        <Button
          key={value}
          type="button"
          variant={selected.includes(value) ? "primary" : "secondary"}
          size="sm"
          aria-pressed={selected.includes(value)}
          disabled={disabled}
          onClick={() => onToggle(value)}
          className="h-8 px-3 text-xs"
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

// 새 키워드 알림 생성과 기존 알림 수정 둘 다 이 하나의 폼으로 처리한다 --
// `initial`이 있으면 그 값으로 시작하고 제출 시 `onSubmit`에 현재 폼
// 상태를 그대로 넘긴다(생성/수정 각각의 실제 서버 액션 호출은 부모
// (KeywordAlertList/새 알림 섹션)가 맡는다 -- 이 컴포넌트는 폼 UI와 로컬
// 검증만 책임진다).
export function KeywordAlertForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: KeywordAlertDTO;
  submitLabel: string;
  onSubmit: (values: KeywordAlertFormValues) => Promise<{ error: string } | { ok: true }>;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<KeywordAlertFormValues>(() => toFormValues(initial));
  const [excludeKeywordsText, setExcludeKeywordsText] = useState(() => (initial?.excludeKeywords ?? []).join(", "));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excludeKeywordsPreview = excludeKeywordsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tooManyExcludeKeywords = excludeKeywordsPreview.length > MAX_EXCLUDE_KEYWORDS_PER_ALERT;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await onSubmit({ ...values, excludeKeywords: excludeKeywordsPreview });
    if ("error" in result) {
      setError(result.error);
      setPending(false);
      return;
    }
    setPending(false);
    if (!initial) {
      // 생성 폼일 때만 스스로 비운다 -- 수정 폼은 부모가 성공 시 이
      // 컴포넌트를 통째로 접기 때문에 로컬 초기화가 의미 없다.
      setValues(toFormValues());
      setExcludeKeywordsText("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("keywordAlert.form.keyword")}</span>
        <input
          type="text"
          value={values.keyword}
          onChange={(e) => setValues((v) => ({ ...v, keyword: e.target.value }))}
          placeholder={t("keywordAlert.form.keywordPlaceholder")}
          maxLength={KEYWORD_MAX_LENGTH}
          required
          disabled={pending}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("keywordAlert.form.postType")}</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("keywordAlert.form.postType")}>
          {KEYWORD_ALERT_POST_TYPES.map((pt) => (
            <Button
              key={pt}
              type="button"
              variant={values.postType === pt ? "primary" : "secondary"}
              size="sm"
              aria-pressed={values.postType === pt}
              disabled={pending}
              onClick={() => setValues((v) => ({ ...v, postType: pt }))}
              className="h-8 px-3 text-xs"
            >
              {pt === "all" ? t("common.all") : pt === "lost" ? t("nav.lost") : t("nav.found")}
            </Button>
          ))}
        </div>
      </label>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("form.campus")}</span>
        <MultiToggleGroup
          ariaLabel={t("form.campusSelect")}
          options={CAMPUSES.map((c) => ({ value: c, label: t(campusLabelKey(c) ?? "form.campus") }))}
          selected={values.campuses}
          onToggle={(v) => setValues((cur) => ({ ...cur, campuses: toggleValue(cur.campuses, v) }))}
          disabled={pending}
        />
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("form.category")}</span>
        <MultiToggleGroup
          ariaLabel={t("form.category")}
          options={CATEGORIES.map((c) => ({ value: c, label: t(categoryLabelKey(c) ?? "form.category") }))}
          selected={values.categories}
          onToggle={(v) => setValues((cur) => ({ ...cur, categories: toggleValue(cur.categories, v) }))}
          disabled={pending}
        />
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-foreground">{t("keywordAlert.form.excludeKeywords")}</span>
        <input
          type="text"
          value={excludeKeywordsText}
          onChange={(e) => setExcludeKeywordsText(e.target.value)}
          placeholder={t("keywordAlert.form.excludeKeywordsPlaceholder")}
          disabled={pending}
          className={FIELD_CLASS}
        />
        <span className="text-xs text-muted-foreground">{t("keywordAlert.form.excludeKeywordsHint")}</span>
      </label>

      {tooManyExcludeKeywords && (
        <p className="text-xs text-destructive">
          {t("keywordAlert.form.excludeKeywords")}: {excludeKeywordsPreview.length}/{MAX_EXCLUDE_KEYWORDS_PER_ALERT}
        </p>
      )}

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending || !values.keyword.trim() || tooManyExcludeKeywords}
          className="self-start"
        >
          {pending ? `${submitLabel}...` : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
