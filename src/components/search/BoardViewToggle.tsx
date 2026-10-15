"use client";

import { useSyncExternalStore } from "react";

import { GridIcon, ListIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { applyBoardView, BOARD_VIEW_EVENT, DEFAULT_BOARD_VIEW, readBoardView, type BoardView } from "@/lib/boardView";
import type { TranslationKey } from "@/lib/i18n/translate";

function subscribe(onChange: () => void) {
  window.addEventListener(BOARD_VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BOARD_VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const OPTIONS: { value: BoardView; labelKey: TranslationKey; Icon: typeof GridIcon }[] = [
  { value: "grid", labelKey: "board.view.grid", Icon: GridIcon },
  { value: "list", labelKey: "board.view.list", Icon: ListIcon },
];

// 게시판 보기 방식 전환 (phone only -- tablets and desktops have one
// layout). Two icon buttons in one segmented control; the choice is a
// browser preference (lib/boardView.ts), not a URL parameter, so the
// search, filters, sort and page all stay exactly as they are.
export function BoardViewToggle({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const view = useSyncExternalStore(subscribe, readBoardView, () => DEFAULT_BOARD_VIEW);

  return (
    <div role="radiogroup" aria-label={t("board.view.label")} className={`inline-flex shrink-0 rounded-full bg-muted p-0.5 sm:hidden ${className}`}>
      {OPTIONS.map(({ value, labelKey, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          aria-label={t(labelKey)}
          title={t(labelKey)}
          onClick={() => applyBoardView(value)}
          className={`flex size-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
            view === value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon aria-hidden="true" className="size-4.5" />
        </button>
      ))}
    </div>
  );
}
