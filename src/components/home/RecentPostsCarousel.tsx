"use client";

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FallbackImage } from "@/components/ui/FallbackImage";
import Link from "next/link";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { categoryIconFor } from "@/components/post/categoryIcons";
import { useI18n } from "@/lib/i18n/client";
import { formatKstDate } from "@/lib/i18n/formatDate";
import { FOUND_STATUSES, LOST_STATUSES } from "@/lib/posts/schema";

// 홈 최근 분실물·습득물: one row of small cards (photo, title, date) that
// drifts slowly to the left and loops without a seam.
//
// How it moves: the row is an ordinary horizontal scroller, so touch
// swipes, trackpads and keyboard focus scroll it natively; a
// requestAnimationFrame loop nudges scrollLeft by SPEED px/s while nobody
// is using it. For the loop the cards are rendered three times (the copies
// are aria-hidden and inert, so screen readers and Tab see each post
// once); the position stays inside the middle copy, jumping by exactly one
// copy's width at either end, which looks identical.
//
// It stands still -- no copies, a plain row -- when the cards fit (few
// posts: nothing repeats), under prefers-reduced-motion, after the pause
// button, and while it is hovered, focused, touched, off screen or in a
// background tab; after a swipe or an arrow press it waits RESUME_MS
// before drifting on.
export type SlidePost = {
  id: number;
  type: "lost" | "found";
  title: string;
  imageUrl: string | null;
  createdAt: Date;
  status: string;
  category: string;
  categoryCode: string | null;
};

const SPEED = 22; // px per second: slow enough to read the titles
const RESUME_MS = 3500;
const COPIES = 3;

function isResolved(post: SlidePost): boolean {
  return post.status !== (post.type === "lost" ? LOST_STATUSES[0] : FOUND_STATUSES[0]);
}

function CategoryTile({ post }: { post: SlidePost }) {
  return (
    <div className="flex size-full items-center justify-center bg-primary-muted/70">
      <span className="flex size-11 items-center justify-center rounded-full bg-card text-primary shadow-sm">
        {createElement(categoryIconFor(post), { "aria-hidden": true, className: "size-5" })}
      </span>
    </div>
  );
}

function SlideCard({ post }: { post: SlidePost }) {
  const { locale } = useI18n();
  return (
    <Link
      href={`/post/${post.id}?type=${post.type}`}
      prefetch={false}
      draggable={false}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-border bg-card transition-colors duration-150 hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <div className="relative aspect-4/3 w-full shrink-0 overflow-hidden bg-muted">
        {post.imageUrl ? (
          // the original photo if optimization fails, then the category tile
          <FallbackImage
            src={post.imageUrl}
            alt=""
            fill
            sizes="(min-width: 768px) 192px, (min-width: 640px) 176px, 160px"
            loading="lazy"
            draggable={false}
            className="object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
            fallback={<CategoryTile post={post} />}
          />
        ) : (
          <CategoryTile post={post} />
        )}
        {isResolved(post) && (
          <span className="absolute top-2 left-2 inline-flex rounded-full bg-card shadow-sm">
            <StatusBadge status={post.status} compact />
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5 sm:p-3">
        <h3 className="line-clamp-2 min-h-[2lh] text-sm leading-snug font-semibold [overflow-wrap:anywhere] text-foreground">{post.title}</h3>
        <time className="mt-auto text-xs text-muted-foreground" dateTime={post.createdAt.toISOString()}>
          {formatKstDate(post.createdAt, locale)}
        </time>
      </div>
    </Link>
  );
}

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
    </button>
  );
}

function PauseGlyph({ paused }: { paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
      <path d="M5 3.5v9l7-4.5z" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden className="size-3.5" fill="currentColor">
      <rect x="4" y="3.5" width="2.6" height="9" rx="0.8" />
      <rect x="9.4" y="3.5" width="2.6" height="9" rx="0.8" />
    </svg>
  );
}

export function RecentPostsCarousel({ posts, label }: { posts: SlidePost[]; label: string }) {
  const { t } = useI18n();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const loop = overflowing && !reducedMotion && posts.length > 1;

  // what holds the drift, read by the animation loop every frame
  const hold = useRef({ hover: false, focus: false, touch: false, until: 0, inView: false });
  const setWidth = useRef(0);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // One copy's width (first card of the first copy to the first card of
  // the second, gap included) and whether one copy is wider than the row.
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const cards = el.querySelectorAll<HTMLElement>("[data-slide]");
    if (cards.length === 0) return;
    const first = cards[0];
    const last = cards[posts.length - 1];
    const span = last.offsetLeft + last.offsetWidth - first.offsetLeft;
    setOverflowing(span > el.clientWidth + 1);
    setWidth.current = cards.length > posts.length ? cards[posts.length].offsetLeft - first.offsetLeft : 0;
  }, [posts.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const seen = new IntersectionObserver(([entry]) => {
      hold.current.inView = entry.isIntersecting;
    });
    seen.observe(el);
    return () => {
      resize.disconnect();
      seen.disconnect();
    };
  }, [measure, loop]);

  // Start inside the middle copy once the copies exist.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !loop) return;
    measure();
    if (el.scrollLeft < setWidth.current) el.scrollLeft += setWidth.current;
  }, [loop, measure]);

  // The drift.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !loop || userPaused) return;
    let frame = 0;
    let last = performance.now();
    // pos keeps the fraction the browser may round scrollLeft to; when
    // something else moved the row (a swipe, focus, the end jump) it
    // follows from there
    let pos = el.scrollLeft;
    let expected = pos;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      if (Math.abs(el.scrollLeft - expected) > 1.5) pos = el.scrollLeft;
      const h = hold.current;
      const held = h.hover || h.focus || h.touch || now < h.until || !h.inView || document.hidden;
      if (held || setWidth.current <= 0) {
        pos = el.scrollLeft;
      } else {
        pos += (SPEED * dt) / 1000;
        if (pos >= 2 * setWidth.current) pos -= setWidth.current;
        el.scrollLeft = pos;
      }
      expected = el.scrollLeft;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [loop, userPaused]);

  // A swipe or a scroll past either end jumps back by one copy.
  const onScroll = () => {
    const el = scrollerRef.current;
    const w = setWidth.current;
    if (!el || !loop || w <= 0) return;
    if (el.scrollLeft >= 2 * w) el.scrollLeft -= w;
    else if (el.scrollLeft <= 0) el.scrollLeft += w;
  };

  const pauseForAWhile = () => {
    hold.current.until = performance.now() + RESUME_MS;
  };

  const step = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-slide]");
    const gap = parseFloat(getComputedStyle(el.firstElementChild as HTMLElement).columnGap) || 0;
    const one = card ? card.offsetWidth + gap : el.clientWidth;
    const distance = Math.max(one, Math.floor(el.clientWidth / one) * one);
    const w = setWidth.current;
    // keep the whole smooth scroll inside the copies (no jump mid-way)
    if (loop && w > 0) {
      if (direction > 0 && el.scrollLeft + distance >= 2 * w) el.scrollLeft -= w;
      if (direction < 0 && el.scrollLeft - distance <= 0) el.scrollLeft += w;
    }
    pauseForAWhile();
    el.scrollBy({ left: direction * distance, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const copies = loop ? COPIES : 1;

  return (
    <div
      className="flex flex-col gap-2"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") hold.current.hover = true;
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") hold.current.hover = false;
      }}
      onFocus={() => {
        hold.current.focus = true;
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold.current.focus = false;
      }}
    >
      <div
        ref={scrollerRef}
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        onScroll={onScroll}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") hold.current.touch = true;
        }}
        onPointerUp={() => {
          hold.current.touch = false;
          pauseForAWhile();
        }}
        onPointerCancel={() => {
          hold.current.touch = false;
          pauseForAWhile();
        }}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) pauseForAWhile();
        }}
        className={`scroll-rail -mx-4 overflow-x-auto overscroll-x-contain px-4 py-1 sm:mx-0 sm:px-0 ${
          overflowing ? "[mask-image:linear-gradient(to_right,transparent,#000_1.25rem,#000_calc(100%-1.25rem),transparent)]" : ""
        }`}
      >
        <ul className="flex w-max min-w-full justify-center-safe gap-3 sm:gap-4">
          {Array.from({ length: copies }, (_, copy) =>
            posts.map((post) => (
              <li
                key={`${copy}-${post.type}-${post.id}`}
                data-slide
                aria-hidden={copy > 0 || undefined}
                inert={copy > 0 || undefined}
                className="w-40 shrink-0 sm:w-44 md:w-48"
              >
                <SlideCard post={post} />
              </li>
            )),
          )}
        </ul>
      </div>
      {overflowing && (
        <div className="flex items-center justify-end gap-1.5">
          {loop && (
            <ControlButton label={userPaused ? t("home.carousel.play") : t("home.carousel.pause")} onClick={() => setUserPaused((v) => !v)}>
              <PauseGlyph paused={userPaused} />
            </ControlButton>
          )}
          <ControlButton label={t("home.carousel.prev")} onClick={() => step(-1)}>
            <ChevronLeftIcon className="size-4" />
          </ControlButton>
          <ControlButton label={t("home.carousel.next")} onClick={() => step(1)}>
            <ChevronRightIcon className="size-4" />
          </ControlButton>
        </div>
      )}
    </div>
  );
}
