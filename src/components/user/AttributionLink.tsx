import Link from "next/link";

import { ShieldIcon } from "@/components/icons";
import { AuthorLink } from "./AuthorLink";

type AttributionLinkProps = {
  // Phase 12-8 §2/§3/§5: mutually exclusive with `author` below -- a
  // post/comment is either posted as an organization (in which case the
  // real author's identity is never rendered here at all, only the
  // organization) or personally (in which case this renders exactly like
  // the old plain AuthorLink). Both null/undefined means "personal".
  organizationId?: number | null;
  organizationName?: string | null;
  author: { nickname: string | null; publicId: string | null };
  className?: string;
  iconClassName?: string;
};

// Phase 12-8: the single place every "누가 올린 글/댓글인지" display now
// renders through -- PostCard, post detail, and CommentSection all use
// this instead of separately rendering an org badge *next to* AuthorLink
// (Phase 12-5's original approach). §2/§5's explicit requirement is that
// an organization-attributed post/comment shows *only* the organization
// in the UI, never the real author's nickname/publicId -- the actual
// authorUserId/organizationId columns are completely untouched by this
// (see posts/comment service layers), this component only decides what
// to render, never what's stored.
export function AttributionLink({ organizationId, organizationName, author, className, iconClassName }: AttributionLinkProps) {
  if (organizationId != null && organizationName) {
    return (
      <Link href={`/organizations/${organizationId}`} className={`inline-flex w-fit items-center gap-1 truncate ${className ?? ""}`}>
        <ShieldIcon className={iconClassName ?? "size-3.5 shrink-0"} />
        <span className="truncate">{organizationName}</span>
      </Link>
    );
  }
  return <AuthorLink nickname={author.nickname} publicId={author.publicId} className={className} />;
}
