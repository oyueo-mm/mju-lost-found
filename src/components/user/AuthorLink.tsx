import Link from "next/link";

type AuthorLinkProps = {
  nickname: string | null;
  // Phase H-7: nullable only for the rare case a caller can't resolve a
  // real user row (see chat/service.ts's resolveCounterpart fallback) --
  // renders as plain, non-clickable text in that case rather than a link
  // to a profile that doesn't exist.
  publicId: string | null;
  className?: string;
};

// Phase H-7: the single place every "누가 올린 글/댓글/메시지인지" display links
// to /profile/[publicId] -- PostCard, Post Detail, CommentSection, and the
// chat room header all render through this one component so the link
// target/behavior stays identical everywhere ("가능한 곳은 동일한 방식으로
// 프로필 링크를 사용한다", per this phase's own spec) instead of four
// separate hand-rolled <Link>s. Own profile posts/comments link here too,
// same as anyone else's -- no special-casing "is this me" anywhere.
export function AuthorLink({ nickname, publicId, className }: AuthorLinkProps) {
  const label = nickname ?? "알 수 없음";
  if (!publicId) return <span className={className}>{label}</span>;
  return (
    <Link href={`/profile/${publicId}`} className={className}>
      {label}
    </Link>
  );
}
