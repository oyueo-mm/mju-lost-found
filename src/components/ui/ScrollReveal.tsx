"use client";

import { useEffect, useRef, type ReactNode } from "react";

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  // Stagger for items revealed together (a grid row, a pair of cards).
  // Kept to small multiples of ~70ms -- long enough to read as a sequence,
  // short enough that the last item never feels late.
  delayMs?: number;
};

// Phase K: fade+rise a section in the first time it scrolls into view.
//
// Three deliberate properties, in order of how much they matter:
//
// 1. It can never hide content. The element renders with no `data-reveal`
//    attribute at all, so the server HTML (and the first client paint) is
//    fully visible. The hidden state is only applied below, after mount,
//    and only to elements that are still *outside* the viewport at that
//    moment -- so a reader never sees something they were already looking
//    at blink out, and a failed/slow hydration leaves a completely normal
//    page rather than a blank one.
// 2. It respects prefers-reduced-motion, twice over: the CSS in
//    globals.css only defines the hidden/transition state inside a
//    `no-preference` media query, and this component also skips
//    instrumenting anything at all when the user asks for reduced motion.
// 3. It reveals once and then stops observing -- scrolling back up never
//    re-animates, which is what makes repeated scrolling feel calm rather
//    than busy.
export function ScrollReveal({ children, className = "", delayMs = 0 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Already on screen (or scrolled past) when hydration finished: leave
    // it exactly as rendered. Only content the reader hasn't reached yet
    // is worth animating.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    el.dataset.reveal = "hidden";
    if (delayMs > 0) el.style.transitionDelay = `${delayMs}ms`;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          el.dataset.reveal = "visible";
          observer.disconnect();
        }
      },
      // A little bottom inset so a section finishes arriving as it enters,
      // rather than starting to fade only once it's already fully on
      // screen.
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delayMs]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
