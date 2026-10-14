"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

type GalleryImage = { id: number; imageUrl: string; isPrimary: boolean };

type PostImageGalleryProps = {
  images: GalleryImage[];
  title: string;
};

// Previous/next wrap around: past the last photo is the first, before the
// first is the last.
export function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

// A horizontal swipe of at least SWIPE_MIN_PX that is more sideways than
// up/down: +1 (next, finger moved left) or -1 (previous). Anything else --
// a tap, a vertical page scroll -- is not a swipe.
const SWIPE_MIN_PX = 40;
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

// Arrow keys typed into a field (comment box, search) stay with the field.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const NAV_BUTTON_CLASS =
  "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// Phase 11-4D: only rendered by post/[id]/page.tsx when a post has 2+
// images -- 0 and 1 keep that page's own pre-existing single-image/
// no-image markup unchanged (see this component's own non-use there), so
// this never has to reproduce those states. "use client" only because
// thumbnail selection needs local state; the images themselves are still
// plain server-fetched data (post.images, ordered by displayOrder), no
// client fetch of its own.
//
// Navigation: ‹ / › buttons over the photo, swipe on touch screens, and
// the ←/→ keys (unless typing in a field); all wrap around, and the
// thumbnail strip and the "n / total" badge follow the current photo.
export function PostImageGallery({ images, title }: PostImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const count = images.length;
  const multiple = count > 1;
  const selected = images[selectedIndex] ?? images[0];
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const go = (step: number) => setSelectedIndex((index) => wrapIndex(index + step, count));

  useEffect(() => {
    if (!multiple) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft") setSelectedIndex((index) => wrapIndex(index - 1, count));
      else if (event.key === "ArrowRight") setSelectedIndex((index) => wrapIndex(index + 1, count));
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [multiple, count]);

  // Keep the current thumbnail visible in the strip -- scrolls the strip
  // sideways only, never the page.
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.children[selectedIndex] as HTMLElement | undefined;
    if (!strip || !thumb) return;
    if (thumb.offsetLeft < strip.scrollLeft || thumb.offsetLeft + thumb.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2, behavior: "smooth" });
    }
  }, [selectedIndex]);

  return (
    <div className="flex flex-col gap-2">
      {/* Same box treatment (aspect/height bounds, object-contain, muted
          letterbox) as the single-image case this replaces -- see
          post/[id]/page.tsx's own comment on why `fill` + `object-contain`
          inside a height-bounded box was chosen there. touch-pan-y leaves
          vertical scrolling to the browser while a sideways swipe changes
          the photo. */}
      <div
        className="relative h-[45vh] w-full touch-pan-y overflow-hidden rounded-card border border-border bg-muted md:h-[65vh]"
        aria-roledescription="carousel"
        aria-label={title}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          const touch = event.changedTouches[0];
          touchStart.current = null;
          if (!multiple || !start || !touch) return;
          const step = swipeStep(touch.clientX - start.x, touch.clientY - start.y);
          if (step !== 0) go(step);
        }}
      >
        <Image
          key={selected.id}
          src={selected.imageUrl}
          alt={multiple ? `${title} (${selectedIndex + 1}/${count})` : title}
          fill
          sizes="(min-width: 768px) 768px, 100vw"
          className="object-contain"
          priority
        />

        {multiple && (
          <>
            <span
              aria-live="polite"
              className="absolute top-2.5 right-2.5 rounded-full bg-black/50 px-2.5 py-0.5 text-xs font-medium text-white tabular-nums"
            >
              {selectedIndex + 1} / {count}
            </span>
            <button type="button" aria-label="이전 이미지" onClick={() => go(-1)} className={`${NAV_BUTTON_CLASS} left-2.5`}>
              <ChevronLeftIcon className="size-5" />
            </button>
            <button type="button" aria-label="다음 이미지" onClick={() => go(1)} className={`${NAV_BUTTON_CLASS} right-2.5`}>
              <ChevronRightIcon className="size-5" />
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip -- horizontally scrollable (never wraps into a
          grid that would push the rest of the page down unpredictably)
          since a post can have up to 5 images; each thumbnail is a real
          <button> (keyboard-operable, not a div with an onClick) with an
          aria-label naming its position, and aria-current marks the one
          currently shown in the hero above. */}
      {multiple && (
        <div ref={stripRef} role="tablist" aria-label="이미지 목록" className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              role="tab"
              aria-selected={index === selectedIndex}
              aria-current={index === selectedIndex}
              aria-label={`${index + 1}번째 이미지${image.isPrimary ? " (대표)" : ""} 보기`}
              onClick={() => setSelectedIndex(index)}
              className={`relative size-16 shrink-0 overflow-hidden rounded-lg border transition-colors ${
                index === selectedIndex ? "border-primary" : "border-border hover:border-foreground/30"
              }`}
            >
              <Image src={image.imageUrl} alt="" fill sizes="64px" className="object-cover" />
              {image.isPrimary && (
                <span className="absolute right-0.5 bottom-0.5 rounded-full bg-card/90 px-1 text-[9px] font-medium text-foreground shadow-sm">
                  대표
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
