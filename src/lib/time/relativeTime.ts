import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/translate";

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
//
// 다국어(i18n) Phase: 버킷 경계(1분/60분/24시간/30일/12개월)와 반올림
// 방식은 하나도 바뀌지 않았다 -- 라벨만 호출자가 넘겨준 번역기를 통해
// 현재 언어로 나온다.
export function formatRelativeTime(date: Date, t: Translator): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return t("time.justNow");
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("time.daysAgo", { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("time.monthsAgo", { count: months });
  const years = Math.floor(days / 365);
  return t("time.yearsAgo", { count: years });
}

// The exact date/time a relative label above rounds away -- meant for a
// `title` tooltip on hover/long-press, per this phase's own "필요한 경우
// 오래된 메시지는 정확한 날짜/시간을 확인할 수 있게 한다".
export function formatAbsoluteTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    // 타임존은 언제나 Asia/Seoul -- 캠퍼스에서 실제로 일어난 일의
    // 시각이므로 보는 사람의 언어에 따라 바뀌면 안 된다.
    timeZone: "Asia/Seoul",
  }).format(date);
}
