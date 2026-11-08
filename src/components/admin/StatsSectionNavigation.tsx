"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

type Entry = { id: string; title: string };

// Use heading positions, rather than intersection ratios: a tall section
// stays active until the next heading crosses the same fixed reading line.
export function activeSectionIndex(tops: number[], readingLine: number, atEnd: boolean) {
  if (!tops.length) return -1;
  if (atEnd) return tops.length - 1;
  let active = 0;
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] > readingLine + 2) break; // tolerate subpixel rounding at anchors
    active = i;
  }
  return active;
}

export function StatsSectionNavigation({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const mobile = useRef<HTMLDetailsElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const root = content.current;
    if (!root) return;
    // Register only opted-in sections that the server actually rendered.
    const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-stats-section][id]"));
    setEntries(sections.map((section) => ({ id: section.id, title: section.dataset.statsSection! })));
    if (mobile.current) mobile.current.open = false;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = sections[0] ? parseFloat(getComputedStyle(sections[0]).scrollMarginTop) : 0;
      const tops = sections.map((section) => section.getBoundingClientRect().top);
      const atEnd = tops[0] <= line && root.getBoundingClientRect().bottom <= window.innerHeight + 2;
      const index = activeSectionIndex(tops, line, atEnd);
      setActive(sections[index]?.id ?? "");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const followHash = () => {
      const section = sections.find((item) => `#${item.id}` === window.location.hash);
      if (section) section.scrollIntoView({ behavior: "instant", block: "start" });
      schedule();
    };
    // Also correct the initial native anchor jump after the sticky mobile
    // navigation has mounted. Resizing charts/details schedules a new reading.
    const initial = requestAnimationFrame(followHash);
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", followHash);
    window.addEventListener("popstate", followHash);
    schedule();
    return () => {
      cancelAnimationFrame(initial);
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", followHash);
      window.removeEventListener("popstate", followHash);
    };
  }, [children]);

  function navigate(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    if (mobile.current) mobile.current.open = false;
    const url = new URL(window.location.href);
    url.hash = id;
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    setActive(id);
  }

  const links = (
    <ul className="border-l border-border">
      {entries.map(({ id, title }) => (
        <li key={id}>
          <a href={`#${id}`} onClick={(event) => navigate(event, id)} aria-current={active === id ? "location" : undefined}
            className={`-ml-px block border-l-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active === id ? "border-primary font-semibold text-primary" : "border-transparent text-foreground hover:text-primary"}`}>
            {title}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <div data-wide-board data-stats-navigation className={`min-w-0 ${entries.length ? "xl:grid xl:grid-cols-[minmax(0,1fr)_11rem] xl:items-start xl:gap-8" : ""}`}>
      {entries.length > 0 && (
        <details ref={mobile} className="sticky top-[var(--header-height)] z-20 mb-4 border-b border-border bg-background xl:hidden"
          onKeyDown={(event) => {
            if (event.key === "Escape" && mobile.current?.open) {
              mobile.current.open = false;
              mobile.current.querySelector("summary")?.focus();
            }
          }}>
          <summary className="cursor-pointer px-1 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            목차 · {entries.find((item) => item.id === active)?.title ?? entries[0]?.title}
          </summary>
          <nav aria-label="통계 섹션" className="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--header-height)-9rem)] overflow-y-auto border-b border-border bg-background p-3">{links}</nav>
        </details>
      )}
      <div ref={content} className="flex min-w-0 flex-col gap-6">{children}</div>
      {entries.length > 0 && (
        <aside className="sticky top-[calc(var(--header-height)+1rem)] hidden max-h-[calc(100dvh-var(--header-height)-2rem)] overflow-y-auto xl:block">
          <nav aria-label="통계 섹션"><p className="mb-3 text-xs font-medium text-muted-foreground">목차</p>{links}</nav>
        </aside>
      )}
    </div>
  );
}
