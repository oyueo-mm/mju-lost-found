// Phase N: chat message timestamps ("방금 전", "3분 전", "2시간 전", "3일
// 전", "2개월 전", "2년 전" -- this phase's own spec examples, verbatim).
// A sibling of CommentSection.tsx's own module-private formatRelativeTime
// (same bucket shape through the "일" step), extended with 개월/년 buckets
// that one never needed (a comment thread's own display never runs long
// enough for those to matter the way a chat history does) -- kept as a
// new shared module rather than either duplicating logic inline in
// ChatThread or reaching into CommentSection's private function, and
// deliberately not used to refactor CommentSection itself this phase (out
// of scope, unrelated feature).
export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}개월 전`;
  const years = Math.floor(days / 365);
  return `${years}년 전`;
}

// The exact date/time a relative label above rounds away -- meant for a
// `title` tooltip on hover/long-press, per this phase's own "필요한 경우
// 오래된 메시지는 정확한 날짜/시간을 확인할 수 있게 한다".
export function formatAbsoluteTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
