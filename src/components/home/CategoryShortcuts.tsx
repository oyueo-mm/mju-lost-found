import Link from "next/link";

import { CATEGORIES } from "@/lib/posts/schema";

// Phase 17: real CATEGORIES (posts/schema.ts) only -- never a hardcoded
// list that could drift from what search/filter forms actually accept.
// Emoji here (not this app's custom icon set in icons.tsx) is a
// deliberate exception: distinguishing 9 different physical-object
// categories at a glance needs real per-category glyphs, and hand-drawing
// 9 more bespoke SVGs for a single homepage section isn't worth it next
// to Unicode's existing, universally-rendered set -- icons.tsx stays
// reserved for the small, reused set of *UI-chrome* icons (nav, status,
// metadata) where a consistent stroke language actually matters.
const CATEGORY_EMOJI: Record<string, string> = {
  전자기기: "🎧",
  필기구: "✏️",
  책: "📚",
  지갑: "👛",
  카드: "💳",
  의류: "👕",
  가방: "🎒",
  액세서리: "💍",
  기타: "📦",
};

export function CategoryShortcuts() {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 md:grid-cols-9">
      {CATEGORIES.map((category) => (
        <Link
          key={category}
          href={`/search?category=${encodeURIComponent(category)}`}
          className="flex flex-col items-center gap-1.5 rounded-card border border-border bg-card px-2 py-3.5 text-center transition-colors hover:border-foreground/30"
        >
          <span className="text-2xl" aria-hidden>
            {CATEGORY_EMOJI[category] ?? "📦"}
          </span>
          <span className="text-xs font-medium text-foreground">{category}</span>
        </Link>
      ))}
    </div>
  );
}
