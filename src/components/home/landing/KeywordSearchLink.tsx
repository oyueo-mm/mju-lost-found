"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { keywordSearchHref } from "@/components/search/searchModeParams";

// The landing's "잃어버린 물건 찾기" (FinalCta, LandingStickyCta): 키워드 검색
// on /search. Words already typed into the hero's search box go along, so
// they are searched right away; otherwise the empty keyword search opens.
// A plain link underneath (new tab, no JavaScript: the empty search).
export const HERO_SEARCH_ID = "landing-hero-cta";

export function KeywordSearchLink({ className, tabIndex, children }: { className: string; tabIndex?: number; children: ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href={keywordSearchHref()}
      tabIndex={tabIndex}
      className={className}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const typed = document.querySelector<HTMLInputElement>(`#${HERO_SEARCH_ID} input[type="search"], #${HERO_SEARCH_ID} input[type="text"]`)?.value.trim();
        if (!typed) return;
        e.preventDefault();
        router.push(keywordSearchHref(typed));
      }}
    >
      {children}
    </Link>
  );
}
