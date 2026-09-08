"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Phase K: the landing page's floating "로그인하고 시작하기".
//
// The landing page is long (hero -> features -> two showcases -> how it
// works -> final CTA) and until now the only way to act on it was to
// scroll back to the top or all the way to the bottom. This keeps the one
// action always one tap away *without* adding a second competing CTA:
//
//   - hidden while the hero's own CTA is still on screen
//   - hidden again once the final CTA section arrives
//   - so it only ever exists in the stretch where no other CTA is visible
//
// It watches the two existing CTAs by id rather than taking refs, so Hero
// and FinalCta stay Server Components (they only gained an id attribute).
const HERO_CTA_ID = "landing-hero-cta";
const FINAL_CTA_ID = "landing-final-cta";

export function LandingStickyCta() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(HERO_CTA_ID);
    const final = document.getElementById(FINAL_CTA_ID);
    if (!hero || !final) return;
    if (typeof IntersectionObserver === "undefined") return;

    // Two independent facts, one derived visibility -- tracked as locals
    // (not state) so a scroll that changes both in the same frame only
    // produces one update.
    let heroOnScreen = true;
    let finalOnScreen = false;

    const sync = () => setVisible(!heroOnScreen && !finalOnScreen);

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) heroOnScreen = entry.isIntersecting;
        if (entry.target === final) finalOnScreen = entry.isIntersecting;
      }
      sync();
    });

    observer.observe(hero);
    observer.observe(final);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      // aria-hidden while off-screen so a screen reader never reaches a
      // duplicate of the CTA that's already in the page content.
      aria-hidden={!visible}
      // Sits directly above BottomNav on mobile (that bar is fixed at
      // bottom-0 and ~3.75rem tall, plus the device's safe area); on md+
      // BottomNav is hidden, so it drops to a normal corner offset.
      className={`pointer-events-none fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom)+0.75rem)] z-30 flex justify-center px-4 transition-all duration-300 ease-out md:inset-x-auto md:right-6 md:bottom-6 md:justify-end ${
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <Link
        href="/login"
        tabIndex={visible ? undefined : -1}
        className={`inline-flex h-11 w-full max-w-sm items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90 md:w-auto ${
          visible ? "pointer-events-auto" : ""
        }`}
      >
        로그인하고 시작하기
      </Link>
    </div>
  );
}
