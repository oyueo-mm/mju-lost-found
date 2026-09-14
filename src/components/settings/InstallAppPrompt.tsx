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
import { useI18n } from "@/lib/i18n/client";

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
  const { t } = useI18n();
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
    <div className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-sm md:hidden">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">{t("install.title")}</span>
          <span className="text-xs text-muted-foreground">
            {deferredPrompt
              ? t("install.description")
              : t("install.iosDescription")}
          </span>
        </div>
        <button
          type="button"
          onClick={dismissInstallPrompt}
          aria-label={t("install.close")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {deferredPrompt && (
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void triggerInstallPrompt()}>
            {t("install.add")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={dismissInstallPrompt}>
            {t("install.later")}
          </Button>
        </div>
      )}
    </div>
  );
}
