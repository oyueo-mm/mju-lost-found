"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/client";
import { taxonomyCategoryLabelKey, taxonomySubcategoryLabelKey } from "@/lib/i18n/labels";
import { suggestCategory } from "@/lib/posts/categorySuggest";
import { CATEGORY_CODES, isCategoryCode, subcategoriesOf } from "@/lib/posts/categoryTaxonomy";
import { shouldShowSuggestion, suggestionKey, type CategoryFormValue } from "./categoryFormState";

const FIELD_CLASS =
  "rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground disabled:opacity-60";

type CategoryPickerProps = {
  value: CategoryFormValue;
  onChange: (value: CategoryFormValue) => void;
  // false only when editing a post whose legacy category has no new code
  // yet -- leaving it empty then keeps the legacy value.
  required: boolean;
  legacyUnmapped: string | null;
  // Live title/description, only for the suggestion hint.
  title: string;
  description: string;
  disabled?: boolean;
};

// 1단계: 대분류 select. 2단계: 그 대분류의 소분류 chips, "선택 안 함"(미분류,
// null)이 "기타 ○○"와 별개의 첫 chip이다. suggestCategory()는 제목/설명에서
// 추천만 하고, 현재 선택과 다를 때 눌러야 적용되는 제안 한 줄을 보여줄 뿐
// 선택을 스스로 바꾸지 않는다.
export function CategoryPicker({ value, onChange, required, legacyUnmapped, title, description, disabled }: CategoryPickerProps) {
  const { t } = useI18n();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const suggestion = suggestCategory({ title, description });
  const showSuggestion = shouldShowSuggestion(suggestion, value, dismissedKey);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-foreground">
          {t("form.category")}
          {required && (
            <span className="text-destructive" aria-hidden="true">
              {" "}
              *
            </span>
          )}
        </span>
        <select
          name="categoryCode"
          required={required}
          value={value.categoryCode ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            onChange({ categoryCode: isCategoryCode(next) ? next : null, subcategory: null });
          }}
          disabled={disabled}
          className={FIELD_CLASS}
        >
          <option value="" disabled={required}>
            {t("form.categorySelectPlaceholder")}
          </option>
          {CATEGORY_CODES.map((code) => (
            <option key={code} value={code}>
              {t(taxonomyCategoryLabelKey(code))}
            </option>
          ))}
        </select>
      </label>

      {legacyUnmapped !== null && value.categoryCode === null && (
        <p className="rounded-lg border border-border px-3.5 py-2.5 text-xs text-muted-foreground">
          {t("form.legacyCategoryNotice", { category: legacyUnmapped })}
        </p>
      )}

      {value.categoryCode !== null && (
        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground">
            {t("form.subcategory")} <span className="font-normal text-muted-foreground">{t("form.subcategoryOptional")}</span>
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("form.subcategory")}>
            {[null, ...subcategoriesOf(value.categoryCode)].map((sub) => {
              const selected = value.subcategory === sub;
              return (
                <Button
                  key={sub ?? "none"}
                  type="button"
                  variant={selected ? "primary" : "secondary"}
                  size="sm"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onChange({ categoryCode: value.categoryCode, subcategory: sub })}
                  className="h-8 px-3 text-xs"
                >
                  {sub === null ? t("form.subcategoryNone") : t(taxonomySubcategoryLabelKey(sub))}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {showSuggestion && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-primary-muted px-3.5 py-2.5 text-xs text-primary"
        >
          <span>
            {t("form.categorySuggestion", {
              label:
                t(taxonomyCategoryLabelKey(suggestion.category)) +
                (suggestion.subcategory ? ` › ${t(taxonomySubcategoryLabelKey(suggestion.subcategory))}` : ""),
            })}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ categoryCode: suggestion.category, subcategory: suggestion.subcategory })}
              className="font-medium underline underline-offset-2 disabled:opacity-60"
            >
              {t("form.categorySuggestionApply")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDismissedKey(suggestionKey(suggestion))}
              className="text-primary/80 underline-offset-2 hover:underline disabled:opacity-60"
            >
              {t("form.categorySuggestionDismiss")}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
