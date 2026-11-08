"use client";

import { useMemo } from "react";

import { AISearchPanel } from "@/components/search/AISearchPanel";
import { keywordSearchHref } from "@/components/search/searchModeParams";
import { useI18n } from "@/lib/i18n/client";

// A fixed list (not counted from real searches). A tap opens unified search
// for that word; the intent rule keeps these short keywords free of inference.
export const HOME_POPULAR_SEARCHES = ["카드", "지갑", "버즈", "에어팟", "휴대폰"] as const;

// landing hero: the bar a little taller and lifted (the page's main action),
// the popular searches small and quiet underneath
const LANDING_CONTROLS =
  "!gap-2.5 [&>form]:border-border [&>form]:bg-card [&>form]:py-2 [&>div]:gap-1.5 [&>div>span]:font-normal [&>div>a]:border-transparent [&>div>a]:bg-card [&>div>a]:px-2.5 [&>div>a]:py-0.5";

// Home text queries enter the shared unified search; photo queries retain
// AISearchPanel's existing image flow. The default board remains found.
export function HomeSearchBar({ variant = "home" }: { variant?: "home" | "landing" }) {
  const landing = variant === "landing";
  const { t, locale } = useI18n();
  const quickSearchItems = [
    { query: HOME_POPULAR_SEARCHES[0], label: t("home.popular.card") },
    { query: HOME_POPULAR_SEARCHES[1], label: t("home.popular.wallet") },
    { query: HOME_POPULAR_SEARCHES[2], label: t("home.popular.buds") },
    { query: HOME_POPULAR_SEARCHES[3], label: t("home.popular.airpods") },
    { query: HOME_POPULAR_SEARCHES[4], label: t("home.popular.phone") },
  ];
  const animatedPlaceholders = useMemo(
    () => [
      t("home.aiPlaceholder.1"),
      t("home.aiPlaceholder.2"),
      t("home.aiPlaceholder.3"),
      t("home.aiPlaceholder.4"),
      t("home.aiPlaceholder.5"),
      t("home.aiPlaceholder.6"),
    ].flatMap((phraseGroup) => phraseGroup.split("\n").filter(Boolean)),
    [t],
  );
  const mobileAnimatedPlaceholders = useMemo(
    () => [
      t("home.aiPlaceholderMobile.1"),
      t("home.aiPlaceholderMobile.2"),
      t("home.aiPlaceholderMobile.3"),
      t("home.aiPlaceholderMobile.4"),
      t("home.aiPlaceholderMobile.5"),
      t("home.aiPlaceholderMobile.6"),
      t("home.aiPlaceholderMobile.7"),
      t("home.aiPlaceholderMobile.8"),
      t("home.aiPlaceholderMobile.9"),
    ],
    [t],
  );

  return (
    <AISearchPanel
      type="found"
      placeholder={animatedPlaceholders[0] ?? t("home.aiPlaceholder")}
      quickSearchLabel={t("home.popularSearches")}
      quickSearchItems={quickSearchItems}
      quickSearchHref={keywordSearchHref}
      controlsClassName={`w-full max-w-xl ${landing ? "" : "mx-auto text-center [&>div]:justify-center [&>p]:text-center"} ${
        locale === "fr" ? "!gap-2 sm:!gap-3 [&>div]:gap-1.5 sm:[&>div]:gap-2" : ""
      } ${landing ? LANDING_CONTROLS : ""}`}
      hideHint={landing}
      animatedPlaceholders={animatedPlaceholders}
      mobileAnimatedPlaceholders={mobileAnimatedPlaceholders}
    />
  );
}
