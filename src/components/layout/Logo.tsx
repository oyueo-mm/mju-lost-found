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
// The mark: a location pin (where a lost item turns up) with a checkmark
// cut into its head (confirmed / recovered) -- one simple, single
// silhouette that reads at a glance as both "위치" and "확인/신뢰" without
// stacking every possible motif (M / search / tag / connection) into one
// symbol, per this phase's own design brief ("심플한 하나의 핵심 형태를
// 우선한다"). Renders cleanly down to favicon size: the pin is a single
// filled shape, the checkmark a single bold stroke, no fine detail to
// smear at 16-32px.
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
        <path
          d="M16 7.5C12.41 7.5 9.5 10.41 9.5 14C9.5 18.5 16 24.5 16 24.5C16 24.5 22.5 18.5 22.5 14C22.5 10.41 19.59 7.5 16 7.5Z"
          fill="var(--primary-foreground)"
        />
        <path
          d="M12.2 13.6L14.7 16.3L19.6 10.8"
          stroke="var(--primary)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
