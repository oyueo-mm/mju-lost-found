"use client";

import { useEffect, useRef, useState } from "react";

import { HomeSearchBar } from "./HomeSearchBar";

// Phase K: Home's hero search, plus a compact copy of itself that slides
// in under the Header once the hero one scrolls away.
//
// Why a second instance rather than moving the original: the hero search
// is part of the page's opening statement (centered, roomy, next to the
// headline) and shouldn't be yanked out of that layout the moment you
// scroll. HomeSearchBar keeps its own input state and only ever navigates
// on submit, so two instances can't disagree -- whichever one you type
// into is the one that searches.
//
// `inert` (not just aria-hidden) while it's off-screen: otherwise the
// invisible copy would still take a Tab stop and be announced.
export function StickyHomeSearch() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Only "stuck" once the hero search has left *upward* -- being
        // below the viewport is also non-intersecting (e.g. right after a
        // back-navigation restores scroll position).
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      },
      // Trip the moment the hero bar passes under the Header, rather than
      // when it clears the very top of the window.
      { rootMargin: "-72px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} className="w-full">
        <HomeSearchBar />
      </div>

      <div
        inert={!stuck}
        className={`fixed inset-x-0 top-[var(--header-height)] z-20 border-b border-border bg-card/95 backdrop-blur-sm transition-all duration-200 ease-out ${
          stuck ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
      >
        <div className="mx-auto w-full max-w-4xl px-4 py-2 md:px-6">
          <HomeSearchBar compact />
        </div>
      </div>
    </>
  );
}
