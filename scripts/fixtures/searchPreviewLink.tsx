import type { AnchorHTMLAttributes } from "react";

export default function PreviewLink({ href, prefetch, scroll, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean; scroll?: boolean }) {
  void prefetch; void scroll;
  return <a href={href} {...props} />;
}
