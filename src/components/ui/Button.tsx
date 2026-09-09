import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// Phase 17: the one button look every page shares. A plain function
// returning a className string (not a full variant library like CVA --
// this app only ever needs these 3 variants x 2 sizes, so a small map is
// simpler than a new dependency) so both <button> and <Link> call sites
// can share it without wrapping every link in a client component.
const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-card text-foreground hover:border-foreground/30",
  ghost: "text-muted-foreground hover:text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
} as const;

const SIZES = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

// Phase P-4: `transition` (covers color + transform in one
// transition-property list, see PostCard.tsx's own comment on why two
// separate transition-* utilities on one element is unreliable in
// Tailwind) plus a small `active:scale` press -- every button/LinkButton
// in the app already shares this one function, so this one change gives
// every click in the product the same brief, consistent press feedback
// without touching any call site. `motion-safe:` (Tailwind's built-in
// prefers-reduced-motion variant, no config needed) keeps the press scale
// out of the DOM entirely for a reduced-motion user, same "off means off,
// not smaller" rule globals.css's own [data-reveal]/[data-fade-in] blocks
// already follow. Kept subtle (2% scale, default duration) so it reads as
// "this responded to your tap", not a bounce.
function buttonClassName(variant: ButtonVariant, size: ButtonSize, className: string) {
  return `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium transition motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return <button className={buttonClassName(variant, size, className)} {...props} />;
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClassName(variant, size, className)}>
      {children}
    </Link>
  );
}
