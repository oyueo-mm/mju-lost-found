"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { kstDateKey, dateHeading, formatDateClock } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import TimeAgo from "./TimeAgo";
import { useT, useLocale } from "@/i18n/client";
import {
  deleteNotifications,
  markNotificationsRead,
} from "@/lib/notif-actions";
import Icon from "./Icon";

const ICON = {
  message: "chat",
  chat: "chat",
  comment: "chat",
  match: "link",
  deal: "check",
  report_processed: "shield",
  appeal: "shield",
  notice: "bell",
  inquiry: "chat",
};

const DELETE_AT = 80; // 왼쪽으로 이만큼 끌면 삭제
const READ_AT = 80; // 오른쪽으로 이만큼 끌면 읽음
const CLAMP = 120;

export default function NotificationList({ items, userId }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  // 낙관적 로컬 오버레이 — 서버가 새 목록을 내려줘도 유지된다.
  const [removed, setRemoved] = useState(() => new Set());
  const [readKeys, setReadKeys] = useState(() => new Set());

  // 새 알림·삭제를 실시간으로 반영
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let timer;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    let channel;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      channel = supabase
        .channel(`notif-list-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          bump,
        )
        .subscribe();
    })();
    return () => {
      clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, router]);

  const list = items
    .filter((g) => !removed.has(g.key))
    .map((g) => (readKeys.has(g.key) ? { ...g, unread: false } : g));

  function remove(group) {
    setRemoved((s) => new Set(s).add(group.key));
    deleteNotifications(group.ids);
  }

  function markRead(group) {
    if (!group.unread) return;
    setReadKeys((s) => new Set(s).add(group.key));
    markNotificationsRead(group.ids);
  }

  if (list.length === 0) {
    return (
      <div className="card-dashed p-12 text-center text-ink-faint">
        <Icon name="bell" size={28} className="mx-auto" strokeWidth={1.6} />
        <p className="mt-3 text-sm">{t("notif.empty")}</p>
      </div>
    );
  }

  // 날짜별 묶음 (오늘 / 어제 / 9월 10일 (수) …) — 목록은 최신순이라 순서대로 끊으면 됨
  const sections = [];
  for (const n of list) {
    const key = kstDateKey(n.created_at);
    const last = sections[sections.length - 1];
    if (last && last.key === key) last.items.push(n);
    else sections.push({ key, items: [n] });
  }

  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <section key={s.key}>
          <h2 className="mb-2 flex items-baseline gap-2 px-0.5">
            <span className="text-[13px] font-bold">
              {dateHeading(s.key, Date.now(), { today: t("notif.today"), yesterday: t("notif.yesterday"), locale })}
            </span>
            <span className="num text-[11px] text-ink-faint">
              {s.items.length}
              {s.items.some((n) => n.unread) && (
                <span className="ml-1.5 text-brand">
                  · {t("notif.unread", { n: s.items.filter((n) => n.unread).length })}
                </span>
              )}
            </span>
          </h2>
          <div className="-mx-4 divide-y divide-line-soft border-y border-line-soft bg-surface sm:mx-0 sm:overflow-hidden sm:rounded-[var(--radius)] sm:border">
            {s.items.map((n) => (
              <SwipeRow
                key={n.key}
                n={n}
                onDelete={() => remove(n)}
                onRead={() => markRead(n)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SwipeRow({ n, onDelete, onRead }) {
  const t = useT();
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [gone, setGone] = useState(false);
  const start = useRef({ x: 0, y: 0 });
  const axis = useRef(null); // "x" | "y" | null
  const active = useRef(false);
  const dxRef = useRef(0);
  const swiped = useRef(false); // 이번 제스처가 "탭"이 아니라 "스와이프"였나

  function setX(v) {
    dxRef.current = v;
    setDx(v);
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    active.current = true;
    axis.current = null;
    swiped.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  }

  function onMove(e) {
    if (!active.current) return;
    const mx = e.clientX - start.current.x;
    const my = e.clientY - start.current.y;

    if (!axis.current) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis.current = Math.abs(mx) > Math.abs(my) * 1.3 ? "x" : "y";
      if (axis.current === "x") {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
      }
    }
    if (axis.current !== "x") {
      active.current = false;
      setDragging(false);
      setX(0);
      return;
    }

    e.preventDefault();
    if (Math.abs(mx) > 10) swiped.current = true;
    let d = mx;
    if (d > 0 && !n.unread) d = d * 0.25; // 이미 읽었으면 오른쪽은 고무줄
    setX(Math.max(Math.min(d, CLAMP), -CLAMP));
  }

  function finish() {
    if (!active.current) return;
    active.current = false;
    setDragging(false);
    const v = dxRef.current;

    if (v <= -DELETE_AT) {
      setX(-600);
      setGone(true);
      setTimeout(onDelete, 180);
    } else if (v >= READ_AT && n.unread) {
      setX(0);
      onRead();
    } else {
      setX(0);
    }
  }

  function hardDelete() {
    setX(-600);
    setGone(true);
    setTimeout(onDelete, 180);
  }

  const armedDelete = dx <= -DELETE_AT;
  const armedRead = dx >= READ_AT && n.unread;

  return (
    <div
      className="group relative overflow-hidden bg-surface transition-[max-height,opacity] duration-200"
      style={gone ? { maxHeight: 0, opacity: 0 } : undefined}
    >
      {/* 뒤 레이어: 읽음(왼쪽) / 삭제(오른쪽) */}
      <div className="pointer-events-none absolute inset-0 flex items-stretch">
        <div
          className={`flex flex-1 items-center px-5 text-sm font-bold text-white transition-colors ${
            dx > 0 ? (armedRead ? "bg-brand" : "bg-brand-soft") : "bg-transparent"
          }`}
        >
          {dx > 0 && (
            <span className="flex items-center gap-1.5">
              <Icon name="check" size={16} /> {t("notif.read")}
            </span>
          )}
        </div>
        <div
          className={`flex flex-1 items-center justify-end px-5 text-sm font-bold text-white transition-colors ${
            dx < 0
              ? armedDelete
                ? "bg-rose-500"
                : "bg-rose-400"
              : "bg-transparent"
          }`}
        >
          {dx < 0 && (
            <span className="flex items-center gap-1.5">
              <Icon name="trash" size={16} /> {t("detail.delete")}
            </span>
          )}
        </div>
      </div>

      {/* 앞면 */}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className="relative touch-pan-y select-none bg-surface"
        style={{
          transform: `translate3d(${dx}px,0,0)`,
          transition: dragging
            ? "none"
            : "transform 0.22s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <Row
          n={n}
          onNavigate={(e) => {
            if (swiped.current) {
              e.preventDefault();
              return;
            }
            if (n.unread) onRead();
          }}
          onDelete={hardDelete}
        />
      </div>
    </div>
  );
}

function Row({ n, onNavigate, onDelete }) {
  const inner = (
    <div className="flex items-start gap-3 px-4 py-3.5">
      {!n.unread ? null : (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[3px] bg-brand"
        />
      )}
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
          n.unread
            ? "bg-brand text-white"
            : "bg-sunken text-ink-faint"
        }`}
      >
        <Icon name={ICON[n.type] || "bell"} size={17} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={`truncate text-sm ${
                n.unread ? "font-bold" : "font-semibold text-ink-soft"
              }`}
            >
              {n.title}
            </span>
            {n.count > 1 && (
              <span className="num shrink-0 rounded-full bg-brand-tint px-1.5 text-[11px] font-bold leading-5 text-brand-deep">
                {n.count}
              </span>
            )}
          </span>
          <TimeAgo value={n.created_at} className="shrink-0 text-xs text-ink-faint" />
        </div>
        {n.body && (
          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-faint">
            {n.body}
          </p>
        )}
        <p className="num mt-1 text-[11px] text-ink-faint">
          {formatDateClock(n.created_at, Date.now(), locale)}
        </p>
      </div>

      {/* 데스크톱: 호버 시 삭제 버튼 */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        aria-label={t("detail.delete")}
        className="-mr-1 hidden shrink-0 self-center rounded-full p-1.5 text-ink-faint transition hover:bg-sunken hover:text-ink group-hover:block"
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );

  return n.link ? (
    <Link
      href={n.link}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onClick={onNavigate}
      className="relative block"
    >
      {inner}
    </Link>
  ) : (
    <div className="relative">{inner}</div>
  );
}
