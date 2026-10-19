"use client";

import { useEffect, useId, useRef, useState } from "react";

import { HourlyDayPicker } from "@/components/admin/HourlyDayPicker";
import { CalendarIcon, ChevronDownIcon, XIcon } from "@/components/icons";
import { describeDays } from "@/lib/metrics/daySelection";

// 시간대 분석 날짜 선택 버튼: "날짜 선택 · 4일" plus the chosen days, opening
// the calendar (HourlyDayPicker, unchanged) over the page -- a popover under
// the button from sm up, a bottom sheet on a phone -- so the charts below
// never move. It stays open while days are picked (the charts update
// behind it) and closes with the close / 완료 button, Escape, or a press
// outside it. The calendar stays mounted while closed, so a pick made just
// before closing is still sent.
export function HourlyDayPopover({ selected, today, param }: { selected: string[]; today: string; param?: string }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(selected);
  const selectedKey = selected.join(",");
  const [shownKey, setShownKey] = useState(selectedKey);
  if (shownKey !== selectedKey) {
    setShownKey(selectedKey);
    setDays(selected);
  }
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    // into the calendar: its one tab stop (the focused day)
    panelRef.current?.querySelector<HTMLElement>('[data-day][tabindex="0"]')?.focus({ preventScroll: true });
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-9 max-w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          open ? "border-primary bg-primary-muted/60" : "border-border bg-background hover:bg-muted"
        }`}
      >
        <CalendarIcon className="size-4 shrink-0 text-primary" />
        <span className="shrink-0 font-medium text-foreground">날짜 선택 · {days.length}일</span>
        {days.length > 0 && <span className="min-w-0 truncate text-xs text-muted-foreground">{describeDays(days)}</span>}
        <ChevronDownIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* phone: dim the page behind the sheet (a press on it closes) */}
      {open && <div className="fixed inset-0 z-40 bg-foreground/20 sm:hidden" aria-hidden />}
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-label="날짜 선택"
        hidden={!open}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-card p-4 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[24rem] sm:overflow-visible sm:rounded-card"
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">날짜 선택</span>
          <button
            type="button"
            onClick={() => close(true)}
            aria-label="날짜 선택 닫기"
            className="-m-1 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <HourlyDayPicker selected={selected} today={today} onChosenChange={setDays} param={param} />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => close(true)}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          >
            완료
          </button>
        </div>
      </div>
    </div>
  );
}
