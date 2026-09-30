"use client";

import { useI18n } from "@/lib/i18n/client";
import { taxonomyCategoryLabelKey, taxonomySubcategoryLabelKey } from "@/lib/i18n/labels";
import { CATEGORY_CODES, isCategoryCode, isSubcategoryCode, parentCategoryOf, subcategoriesOf } from "@/lib/posts/categoryTaxonomy";
import type { CategoryFilterState } from "./categoryFilterParams";

type CategoryFilterSelectsProps = {
  value: CategoryFilterState;
  onChange: (next: CategoryFilterState) => void;
  selectClassName: string;
};

// 검색 필터의 대분류 -> 소분류 select 한 쌍. 대분류만 고르면 그 대분류 전체,
// 소분류까지 고르면 그 소분류로 좁힌다. 대분류를 바꾸면 소분류는 "전체"로
// 돌아간다. 소분류 select는 대분류를 고른 뒤에만 나타난다.
export function CategoryFilterSelects({ value, onChange, selectClassName }: CategoryFilterSelectsProps) {
  const { t } = useI18n();
  return (
    <>
      <select
        aria-label={t("search.filter.category")}
        value={value.categoryCode ?? (value.legacyCategory ? `legacy:${value.legacyCategory}` : "")}
        onChange={(event) => {
          const next = event.target.value;
          onChange({ categoryCode: isCategoryCode(next) ? next : null, subcategory: null, legacyCategory: null });
        }}
        className={selectClassName}
      >
        <option value="">{t("search.filter.categoryAll")}</option>
        {value.legacyCategory && <option value={`legacy:${value.legacyCategory}`}>{value.legacyCategory}</option>}
        {CATEGORY_CODES.map((code) => (
          <option key={code} value={code}>
            {t(taxonomyCategoryLabelKey(code))}
          </option>
        ))}
      </select>

      {value.categoryCode && (
        <select
          aria-label={t("search.filter.subcategory")}
          value={value.subcategory ?? ""}
          onChange={(event) => {
            const next = event.target.value;
            const subcategory = isSubcategoryCode(next) && parentCategoryOf(next) === value.categoryCode ? next : null;
            onChange({ ...value, subcategory });
          }}
          className={selectClassName}
        >
          <option value="">{t("search.filter.subcategoryAll")}</option>
          {subcategoriesOf(value.categoryCode).map((code) => (
            <option key={code} value={code}>
              {t(taxonomySubcategoryLabelKey(code))}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
