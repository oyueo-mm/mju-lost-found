"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PlusIcon } from "@/components/icons";

// 게시판 리디자인 다듬기 Phase: the phone register button. A permanent
// floating "+" covered the right edge of whichever card scrolled under it
// (title end, date, the card's own tap target). Now:
// - the header's register button (BoardHeader) is the main entry point
//   and is always there at the top of the board;
// - this floating button only appears once that header button has
//   scrolled out of view AND the visitor scrolls back up -- the usual
//   "I want to do something else now" gesture. While scrolling down
//   through the list it stays hidden, so it never sits on the cards being
//   read, and the last card is reachable without anything over it;
// - it carries its label ("습득물 등록"), not just "+", and sits above the
//   bottom navigation and the safe area. Below md only (BottomNav's range).
// While hidden it is out of the tab order and hidden from assistive tech;
// the header button stays reachable either way.
export function BoardFab({ href, label, watchId }: { href: string; label: string; watchId: string }) {
  const [headerVisible, setHeaderVisible] = useState(true);
  const [scrollingUp, setScrollingUp] = useState(false);

  useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setHeaderVisible(entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchId]);

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        // Ignore tiny jitters (momentum scroll, address-bar resizes).
        if (Math.abs(y - lastY) < 12) return;
        setScrollingUp(y < lastY);
        lastY = y;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const shown = !headerVisible && scrollingUp;

  return (
    <Link
      href={href}
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      data-board-fab
      data-shown={shown}
      className={`fixed right-4 bottom-[calc(3.75rem+env(safe-area-inset-bottom)+0.75rem)] z-30 inline-flex h-12 items-center gap-1.5 rounded-full bg-primary pr-5 pl-4 text-sm font-semibold text-primary-foreground shadow-lg transition duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none md:hidden ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <PlusIcon aria-hidden="true" className="size-5" />
      {label}
    </Link>
  );
}
