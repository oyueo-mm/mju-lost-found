// Enter/leave tracking with hysteresis, for effects that replay when an
// element comes back into view. "Enter" needs a real share of the element
// on screen; "leave" needs it to be fully outside the viewport plus a
// margin. Between the two nothing fires, so hovering at the edge of the
// screen while scrolling never restarts anything.
export const ENTER_RATIO = 0.25;
export const LEAVE_MARGIN = "25%";

// Phones (below Tailwind's md, 768px): a section only counts as entered once
// it is well on screen -- 60% of it, or (for a tall one) 22% of the
// viewport height -- so its reveal plays where the reader is looking, not
// at the bottom edge under their thumb.
export const PHONE_QUERY = "(max-width: 767px)";
export const PHONE_ENTER_RATIO = 0.6;
export const PHONE_ENTER_VIEWPORT = 0.22;

// Visible enough to count as entered: a quarter of the element, or (for an
// element taller than the screen) at least 40% of the viewport height. On a
// phone: see PHONE_ENTER_RATIO above.
export function isEnteredEnough(
  entry: Pick<IntersectionObserverEntry, "isIntersecting" | "intersectionRatio"> & { intersectionRect: { height: number }; boundingClientRect: { height: number } },
  viewportHeight: number,
  phone = false,
): boolean {
  if (!entry.isIntersecting) return false;
  if (phone) {
    const needed = Math.min(entry.boundingClientRect.height * PHONE_ENTER_RATIO, viewportHeight * PHONE_ENTER_VIEWPORT);
    return entry.intersectionRect.height >= needed - 1;
  }
  return entry.intersectionRatio >= ENTER_RATIO || entry.intersectionRect.height >= viewportHeight * 0.4;
}

// Ratios at which the enter observer re-checks: every 5%, so the phone rule
// (whose needed share depends on the element's height) fires close to the
// moment it is met rather than at the next coarse step.
const ENTER_THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

export function isPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}

export function observeViewCycle(
  el: Element,
  { onEnter, onLeave }: { onEnter: () => void; onLeave: () => void },
): () => void {
  let inside = false;
  const enter = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!inside && isEnteredEnough(entry, window.innerHeight, isPhoneViewport())) {
          inside = true;
          onEnter();
        }
      }
    },
    { threshold: ENTER_THRESHOLDS },
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
