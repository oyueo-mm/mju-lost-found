type LogoMarkProps = {
  // px -- matches the exact circle sizes the old "M" badge used at each
  // call site (Header: 32 / size-8, login+onboarding: 56 / size-14), kept
  // as an explicit number rather than a Tailwind size-* class so this one
  // component serves every existing size without new utility variants.
  size: number;
  className?: string;
};

// Phase H-8: single source of truth for the brand mark, replacing the
// "rounded-full bg-primary" circle + literal "M" text that used to be
// copy-pasted across Header.tsx, login/page.tsx, and onboarding/page.tsx.
//
// The magnifying glass and checkmark represent searching and finding.
//
// Colored via the existing `--primary`/`--primary-foreground` CSS custom
// properties (the exact two tokens the old "M" badge already used, see
// globals.css's own "Used for the brand mark" comment) -- not hardcoded
// hex values -- so the mark keeps following light/dark theme AND the
// accent-color system (data-accent="green"/"purple"/"rose"/"amber")
// automatically, with zero extra wiring. The static favicon/apple-icon/
// og-image assets are separate files (browsers/crawlers render those
// outside this app's CSS, so they can't read a custom property) and use
// hardcoded brand-blue instead -- see icon.svg's own comment for how that
// file still adapts to dark mode via a plain CSS media query.
export function LogoMark({ size, className }: LogoMarkProps) {
  const iconSize = Math.round(size * 0.6);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 32 32" aria-hidden="true">
        <g fill="none" stroke="var(--primary-foreground)" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="13.5" r="8" />
          <path d="m19.5 19.5 7 7M10 13.5l2.5 2.5 4.5-4.5" />
        </g>
      </svg>
    </span>
  );
}
