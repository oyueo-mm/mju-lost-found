// Enter/leave tracking with hysteresis, for effects that replay when an
// element comes back into view. "Enter" needs a real share of the element
// on screen; "leave" needs it to be fully outside the viewport plus a
// margin. Between the two nothing fires, so hovering at the edge of the
// screen while scrolling never restarts anything.
export const ENTER_RATIO = 0.25;
export const LEAVE_MARGIN = "25%";

// Visible enough to count as entered: a quarter of the element, or (for an
// element taller than the screen) at least 40% of the viewport height.
export function isEnteredEnough(
  entry: Pick<IntersectionObserverEntry, "isIntersecting" | "intersectionRatio"> & { intersectionRect: { height: number } },
  viewportHeight: number,
): boolean {
  return entry.isIntersecting && (entry.intersectionRatio >= ENTER_RATIO || entry.intersectionRect.height >= viewportHeight * 0.4);
}

export function observeViewCycle(
  el: Element,
  { onEnter, onLeave }: { onEnter: () => void; onLeave: () => void },
): () => void {
  let inside = false;
  const enter = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!inside && isEnteredEnough(entry, window.innerHeight)) {
          inside = true;
          onEnter();
        }
      }
    },
    { threshold: [0, 0.1, 0.25, 0.4, 0.6, 0.8, 1] },
  );
  const leave = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (inside && !entry.isIntersecting) {
          inside = false;
          onLeave();
        }
      }
    },
    { rootMargin: `${LEAVE_MARGIN} 0px ${LEAVE_MARGIN} 0px` },
  );
  enter.observe(el);
  leave.observe(el);
  return () => {
    enter.disconnect();
    leave.disconnect();
  };
}

// Below (or above) the part of the page the reader is looking at right now
// -- the same "not reached yet" test ScrollReveal has always used.
export function isOutsideInitialView(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.top >= window.innerHeight * 0.9 || rect.bottom <= 0;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
