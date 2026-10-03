import Link from "next/link";

import { ExternalVerifiedBadge } from "./ExternalVerifiedBadge";

type AuthorLinkProps = {
  nickname: string | null;
  // Phase H-7: nullable only for the rare case a caller can't resolve a
  // real user row (see chat/service.ts's resolveCounterpart fallback) --
  // renders as plain, non-clickable text in that case rather than a link
  // to a profile that doesn't exist.
  publicId: string | null;
  className?: string;
  // External access Phase: "EXTERNAL_VERIFIED" adds the "인증된 외부 관계자"
  // badge after the name. Comes from the server-side User.userType only.
  userType?: string | null;
};

// Phase H-7: the single place every "누가 올린 글/댓글/메시지인지" display links
// to /profile/[publicId] -- PostCard, Post Detail, CommentSection, and the
// chat room header all render through this one component so the link
// target/behavior stays identical everywhere ("가능한 곳은 동일한 방식으로
// 프로필 링크를 사용한다", per this phase's own spec) instead of four
// separate hand-rolled <Link>s. Own profile posts/comments link here too,
// same as anyone else's -- no special-casing "is this me" anywhere.
export function AuthorLink({ nickname, publicId, className, userType }: AuthorLinkProps) {
  const link = <AuthorName nickname={nickname} publicId={publicId} className={className} />;
  if (userType !== "EXTERNAL_VERIFIED") return link;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {link}
      <ExternalVerifiedBadge />
    </span>
  );
}

function AuthorName({ nickname, publicId, className }: Omit<AuthorLinkProps, "userType">) {
  const label = nickname ?? "알 수 없음";
  if (!publicId) return <span className={className}>{label}</span>;
  return (
    <Link href={`/profile/${publicId}`} className={className}>
      {label}
    </Link>
  );
}
