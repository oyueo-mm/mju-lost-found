"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  dismissInstallPrompt,
  getInstallPromptServerSnapshot,
  getInstallPromptSnapshot,
  subscribeInstallPromptState,
  syncInstallPromptFromBrowser,
  triggerInstallPrompt,
} from "@/lib/pwa/installPrompt";
import { Button } from "@/components/ui/Button";
import { XIcon } from "@/components/icons";

// Phase 11-5: "앱처럼 설치하기" CTA -- Android/Chrome/Edge get a real
// install button (the captured `beforeinstallprompt` event, see
// lib/pwa/installPrompt.ts); iOS Safari never fires that event at all
// (Apple's own, long-standing limitation), so it gets short instructions
// instead of a broken/no-op button. Every other browser (desktop Firefox,
// browsers that don't support installable PWAs) shows nothing at all -- no
// dead CTA, no "설치 기능을 지원하지 않아요" message either (this phase's
// own spec: "설치가 불가능한 환경에서는 해당 CTA가 사용자에게 혼란을 주지
// 않도록 한다").
//
// `mounted` (part of the store's own state) is what keeps SSR/pre-hydration
// output identical (both render null) -- see installPrompt.ts's own
// comment for why this is a useSyncExternalStore store instead of
// useState+useEffect.
export function InstallAppPrompt() {
  const { deferredPrompt, isIos, hidden, mounted } = useSyncExternalStore(
    subscribeInstallPromptState,
    getInstallPromptSnapshot,
    getInstallPromptServerSnapshot,
  );

  useEffect(() => {
    syncInstallPromptFromBrowser();
  }, []);

  if (!mounted || hidden) return null;
  if (!deferredPrompt && !isIos) return null; // nothing this browser can offer -- stay silent, not broken

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">앱처럼 설치하기</span>
          <span className="text-xs text-muted-foreground">
            {deferredPrompt
              ? "홈 화면에 추가하면 더 빠르게 접속할 수 있어요."
              : "Safari 하단 공유 버튼을 누른 뒤 \"홈 화면에 추가\"를 선택하면 설치할 수 있어요."}
          </span>
        </div>
        <button
          type="button"
          onClick={dismissInstallPrompt}
          aria-label="앱 설치 안내 닫기"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {deferredPrompt && (
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void triggerInstallPrompt()}>
            앱 추가하기
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={dismissInstallPrompt}>
            나중에
          </Button>
        </div>
      )}
    </div>
  );
}
