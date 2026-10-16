"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react";

import { ChevronRightIcon } from "@/components/icons";
import {
  addDays,
  addMonths,
  applyRange,
  describeDays,
  EARLIEST_SELECTABLE_DAY,
  encodeDays,
  lastDays,
  MAX_SELECTED_DAYS,
  monthGrid,
  selectableDay,
  type DragMode,
} from "@/lib/metrics/daySelection";

// 시간대 분석 날짜 선택: one calendar for any set of days. Click (or tap,
// or Enter/Space) toggles a day; dragging marks every day passed over --
// starting on an unselected day adds them, on a selected day takes them
// away -- and keeps everything chosen before. On touch screens a drag starts
// after holding a day for a moment, so a plain swipe still scrolls the page.
// The range is highlighted while dragging; the page's statistics follow
// once the drag ends (a quick series of taps is sent once). The choice
// lives in the URL (`d`, lib/metrics/daySelection.ts), so the server, the
// export and a shared link all read the same days.

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const HOLD_MS = 350;
const MOVE_CANCEL_PX = 10;
const TAP_COMMIT_MS = 450;
type Drag = { anchor: string; current: string; mode: DragMode };

const dayFromPoint = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-day]") as HTMLElement | null)?.dataset.day ?? null;

export function HourlyDayPicker({
  selected,
  today,
  onChosenChange,
}: {
  selected: string[];
  today: string;
  // told of every accepted change at once (the date button's label), before the page follows
  onChosenChange?: (days: string[]) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState(() => new Set(selected));
  const [month, setMonth] = useState(() => (selected.at(-1) ?? today).slice(0, 7));
  const [focusDay, setFocusDay] = useState(() => selected.at(-1) ?? today);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ day: string; x: number; y: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardFocus = useRef(false);

  // the server's selection wins after a navigation (back / forward, links)
  // (adjusted while rendering, React's pattern for state that follows a prop)
  const selectedKey = selected.join(",");
  const [shownKey, setShownKey] = useState(selectedKey);
  if (shownKey !== selectedKey) {
    setShownKey(selectedKey);
    setChosen(new Set(selected));
  }

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const navigate = (days: Set<string>, delay: number) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("d", encodeDays([...days]));
      startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
    }, delay);
  };

  // A new selection: refused (and explained) past the limit.
  const commit = (next: Set<string>, delay = 0) => {
    if (next.size > MAX_SELECTED_DAYS) {
      setMessage(`최대 ${MAX_SELECTED_DAYS}일까지 고를 수 있습니다. 지금 ${chosen.size}일이 선택돼 있어 이번 선택은 반영하지 않았습니다.`);
      return;
    }
    setMessage(null);
    setChosen(next);
    onChosenChange?.([...next].sort());
    navigate(next, delay);
  };

  const toggle = (day: string) => {
    if (!selectableDay(day, today)) return;
    commit(applyRange(chosen, day, day, chosen.has(day) ? "remove" : "add", today), TAP_COMMIT_MS);
  };

  const finishDrag = () => {
    const d = dragRef.current;
    setDragState(null);
    if (d) commit(applyRange(chosen, d.anchor, d.current, d.mode, today), d.anchor === d.current ? TAP_COMMIT_MS : 0);
  };

  // what the calendar shows: the selection with the drag in progress applied
  const shown = useMemo(() => (drag ? applyRange(chosen, drag.anchor, drag.current, drag.mode, today) : chosen), [chosen, drag, today]);

  // ---- mouse / pen: drag at once
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const day = (e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
    if (!day || !selectableDay(day, today)) return;
    e.preventDefault(); // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    setFocusDay(day);
    setDragState({ anchor: day, current: day, mode: chosen.has(day) ? "remove" : "add" });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerType === "touch") return;
    const day = dayFromPoint(e.clientX, e.clientY);
    if (day && day !== d.current && selectableDay(day, today)) setDragState({ ...d, current: day });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" && dragRef.current) finishDrag();
  };

  // ---- touch: a tap toggles; hold, then drag to mark a range
  const onTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    const day = (e.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
    if (e.touches.length !== 1 || !day || !selectableDay(day, today)) return;
    const timer = setTimeout(() => {
      if (!touch.current) return;
      touch.current.timer = null;
      setDragState({ anchor: day, current: day, mode: chosen.has(day) ? "remove" : "add" });
      navigator.vibrate?.(10);
    }, HOLD_MS);
    touch.current = { day, x: t.clientX, y: t.clientY, timer };
  };
  const onTouchEnd = (e: ReactTouchEvent<HTMLDivElement>) => {
    const t = touch.current;
    touch.current = null;
    if (dragRef.current) {
      e.preventDefault(); // no click after the drag
      finishDrag();
    } else if (t?.timer) {
      clearTimeout(t.timer);
      e.preventDefault(); // the tap is handled here, not by a click
      setFocusDay(t.day);
      toggle(t.day);
    }
  };
  // touchmove must be able to stop the page from scrolling while dragging:
  // a native, non-passive listener (React's are passive)
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onMove = (e: TouchEvent) => {
      const t = touch.current;
      const p = e.touches[0];
      const d = dragRef.current;
      if (d) {
        e.preventDefault();
        const day = dayFromPoint(p.clientX, p.clientY);
        if (day && day !== d.current && selectableDay(day, today)) setDragState({ ...d, current: day });
      } else if (t?.timer && Math.hypot(p.clientX - t.x, p.clientY - t.y) > MOVE_CANCEL_PX) {
        clearTimeout(t.timer); // a swipe: the page scrolls
        touch.current = null;
      }
    };
    const onCancel = () => {
      if (touch.current?.timer) clearTimeout(touch.current.timer);
      touch.current = null;
      setDragState(null);
    };
    grid.addEventListener("touchmove", onMove, { passive: false });
    grid.addEventListener("touchcancel", onCancel);
    return () => {
      grid.removeEventListener("touchmove", onMove);
      grid.removeEventListener("touchcancel", onCancel);
    };
  }, [today]);

  // ---- keyboard: arrows move, Enter / Space toggles
  const moveFocus = (day: string) => {
    const clamped = day > today ? today : day < EARLIEST_SELECTABLE_DAY ? EARLIEST_SELECTABLE_DAY : day;
    keyboardFocus.current = true;
    setFocusDay(clamped);
    setMonth(clamped.slice(0, 7));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) moveFocus(addDays(focusDay, step[e.key]));
    else if (e.key === "PageUp" || e.key === "PageDown") moveFocus(`${addMonths(focusDay.slice(0, 7), e.key === "PageUp" ? -1 : 1)}-${focusDay.slice(8)}`.replace(/-(29|30|31)$/, "-28"));
    else if (e.key === "Enter" || e.key === " ") toggle(focusDay);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    if (!keyboardFocus.current) return;
    keyboardFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, month]);

  const days = monthGrid(month);
  const todayMonth = today.slice(0, 7);
  const chip = "rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const navButton =
    "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const sorted = [...chosen].sort();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="빠른 선택">
        {[7, 14, 30].map((n) => (
          <button key={n} type="button" className={chip} onClick={() => commit(new Set(lastDays(today, n)))}>
            최근 {n}일
          </button>
        ))}
        <button type="button" className={chip} onClick={() => commit(new Set())} disabled={chosen.size === 0}>
          전체 선택 해제
        </button>
      </div>

      <div className="w-full rounded-card border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" className={navButton} aria-label="이전 달" disabled={month <= EARLIEST_SELECTABLE_DAY.slice(0, 7)} onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronRightIcon className="size-4 rotate-180" />
          </button>
          <span className="text-sm font-semibold text-foreground" aria-live="polite">
            {month.slice(0, 4)}년 {Number(month.slice(5, 7))}월
          </span>
          <button type="button" className={navButton} aria-label="다음 달" disabled={month >= todayMonth} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground" aria-hidden>
          {DOW.map((d) => (
            <span key={d} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div
          ref={gridRef}
          role="group"
          aria-label={`${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월 날짜 선택`}
          className="grid grid-cols-7 gap-1 select-none [-webkit-touch-callout:none]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDragState(null)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => drag && e.preventDefault()}
        >
          {days.map((day) => {
            const enabled = selectableDay(day, today);
            const on = shown.has(day);
            const was = chosen.has(day);
            const inMonth = day.slice(0, 7) === month;
            const previewing = drag !== null && on !== was;
            return (
              <button
                key={day}
                type="button"
                data-day={day}
                disabled={!enabled}
                tabIndex={day === focusDay ? 0 : -1}
                aria-pressed={on}
                aria-label={`${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일${day === today ? " 오늘" : ""}${on ? " 선택됨" : ""}`}
                // keyboard activation by assistive tech arrives as a click with detail 0
                onClick={(e) => e.detail === 0 && toggle(day)}
                onFocus={() => setFocusDay(day)}
                className={[
                  "relative flex h-9 items-center justify-center rounded-lg text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  !enabled
                    ? "cursor-not-allowed text-muted-foreground/30"
                    : on
                      ? `bg-primary font-semibold text-primary-foreground ${previewing ? "opacity-70 ring-2 ring-primary/40" : ""}`
                      : previewing
                        ? "bg-muted font-medium text-muted-foreground line-through ring-2 ring-border"
                        : `hover:bg-muted ${inMonth ? "text-foreground" : "text-muted-foreground/60"}`,
                  day === today && !on ? "ring-1 ring-primary/60" : "",
                ].join(" ")}
              >
                {Number(day.slice(8, 10))}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
        <p role="status" className="text-xs">
          <b className="font-semibold text-foreground">
            선택 {sorted.length}일 / 최대 {MAX_SELECTED_DAYS}일
          </b>
          {sorted.length > 0 && <> · {describeDays(sorted)}</>}
          {pending && <span className="ml-1 text-primary">통계 갱신 중…</span>}
        </p>
        {message && (
          <p role="alert" className="text-destructive">
            {message}
          </p>
        )}
        <p>
          누르면 선택·해제, 끌면 여러 날을 한꺼번에(선택된 날에서 시작하면 해제). 터치는 잠깐 누른 뒤 끌기. 키보드: 방향키·Enter·PageUp/Down.
        </p>
      </div>
    </div>
  );
}
