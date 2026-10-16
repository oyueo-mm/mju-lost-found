"use client";

import Link from "next/link";

import { InfoIcon, XIcon } from "@/components/icons";
import { PRIVACY_NOTICE_STORAGE_KEY, type PrivacyNotice } from "@/lib/policy/privacyNotice";

// 개인정보처리방침 변경 안내 bar (lib/policy/privacyNotice.ts): never blocks
// anything, closes for this 시행일 in this browser.
export function PrivacyPolicyNotice({ notice }: { notice: NonNullable<PrivacyNotice> }) {
  const close = () => {
    document.documentElement.setAttribute("data-privacy-notice", "closed");
    try {
      window.localStorage.setItem(PRIVACY_NOTICE_STORAGE_KEY, notice.id);
    } catch {
      // no storage: hidden for this page only
    }
  };
  return (
    <div data-privacy-notice-bar role="note" className="border-b border-border bg-primary-muted/60">
      <div className="mx-auto flex w-full max-w-4xl items-start gap-2 px-4 py-2 text-xs leading-relaxed text-foreground wide-board:max-w-6xl md:px-6">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 break-keep">
          <span className="font-semibold">{notice.text}</span> <span className="text-muted-foreground">{notice.summary}</span>{" "}
          <Link href={notice.href} className="font-medium whitespace-nowrap text-primary underline-offset-2 hover:underline">
            변경 내용 보기
          </Link>
        </p>
        <button
          type="button"
          onClick={close}
          aria-label="변경 안내 닫기"
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
