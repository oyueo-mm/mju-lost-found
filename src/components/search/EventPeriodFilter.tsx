"use client";

import { useId } from "react";

import { useI18n } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/translate";
import type { PostListType } from "@/lib/posts/schema";
import { EVENT_PERIODS } from "@/lib/posts/eventPeriod";
import { isPeriodRangeInvalid, type PeriodState } from "./periodParams";

const LABEL_KEY: Record<PostListType, TranslationKey> = {
  lost: "search.period.label.lost",
  found: "search.period.label.found",
  all: "search.period.label.all",
};

const OPTION_KEY: Record<(typeof EVENT_PERIODS)[number], TranslationKey> = {
  today: "search.period.today",
  "3d": "search.period.3d",
  "1w": "search.period.1w",
  "1m": "search.period.1m",
  custom: "search.period.custom",
};

// 기간 검색 필터 (분실/습득 시점 기준): one controlled control shared by the
// keyword filter row and the AI search panel. The label names the board's
// own time field -- 분실 시점 / 습득 시점 / 분실·습득 시점 -- so it never reads
// as a registration-date filter. "시간 모름 포함" only appears while a period
// is selected: with 전체 기간 nothing is filtered by time at all.
export function EventPeriodFilter({
  value,
  onChange,
  boardType,
  size = "md",
}: {
  value: PeriodState;
  onChange: (next: PeriodState) => void;
  boardType: PostListType;
  size?: "md" | "sm";
}) {
  const { t } = useI18n();
  const id = useId();
  const control =
    size === "sm"
      ? "rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm"
      : "rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground";
  const invalid = isPeriodRangeInvalid(value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${id}-period`} className={size === "sm" ? "text-xs text-muted-foreground" : "sr-only"}>
        {t(LABEL_KEY[boardType])}
      </label>
      <select
        id={`${id}-period`}
        aria-label={t(LABEL_KEY[boardType])}
        value={value.period}
        onChange={(e) =>
          onChange({ ...value, period: e.target.value as PeriodState["period"], ...(e.target.value !== "custom" && { from: "", to: "" }) })
        }
        className={control}
      >
        <option value="">
          {size === "sm" ? t("search.period.any") : `${t(LABEL_KEY[boardType])}: ${t("search.period.any")}`}
        </option>
        {EVENT_PERIODS.map((p) => (
          <option key={p} value={p}>
            {size === "sm" ? t(OPTION_KEY[p]) : `${t(LABEL_KEY[boardType])}: ${t(OPTION_KEY[p])}`}
          </option>
        ))}
      </select>

      {value.period === "custom" && (
        <>
          <input
            type="date"
            aria-label={t("search.period.from")}
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className={control}
          />
          <span aria-hidden="true" className="text-xs text-muted-foreground">
            ~
          </span>
          <input
            type="date"
            aria-label={t("search.period.to")}
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className={control}
          />
        </>
      )}

      {value.period && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={value.includeUnknown}
            onChange={(e) => onChange({ ...value, includeUnknown: e.target.checked })}
          />
          {t("search.period.includeUnknown")}
        </label>
      )}

      {invalid && (
        <p role="alert" className="w-full text-xs text-destructive">
          {t("search.period.invalidRange")}
        </p>
      )}
    </div>
  );
}
