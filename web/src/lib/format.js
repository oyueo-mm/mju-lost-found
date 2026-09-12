// 이 서비스는 한국 전용 → 모든 표시는 KST(Asia/Seoul) 기준.
const TZ = "Asia/Seoul";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", {
    timeZone: TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", {
    timeZone: TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function timeAgo(value) {
  if (!value) return "";
  const d = new Date(value);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString("ko-KR", {
    timeZone: TZ,
    month: "long",
    day: "numeric",
  });
}

// KST 기준 "YYYY-MM-DD" (날짜별 묶기용)
export function kstDateKey(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
}

// 날짜 키 → "오늘" / "어제" / "9월 10일 (수)" / 해가 다르면 "2025년 12월 3일 (수)"
const INTL = { ko: "ko-KR", en: "en-US", zh: "zh-CN", vi: "vi-VN", mn: "mn-MN" };

export function dateHeading(key, now = Date.now(), opts = {}) {
  if (!key) return "";
  const today = kstDateKey(now);
  if (key === today) return opts.today || "오늘";
  if (key === kstDateKey(now - 86400000)) return opts.yesterday || "어제";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12)); // 정오 → 요일 계산 안전
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString(INTL[opts.locale] || "ko-KR", {
    timeZone: TZ,
    ...(sameYear ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

// KST "9월 12일 (금) 오후 2:35" — 해가 다르면 연도까지
export function formatDateClock(value, now = Date.now(), locale = "ko") {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = kstDateKey(d).slice(0, 4) === kstDateKey(now).slice(0, 4);
  return d.toLocaleString(INTL[locale] || "ko-KR", {
    timeZone: TZ,
    ...(sameYear ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// KST "오후 2:35"
export function formatClock(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
}

// datetime-local input 표시용 (YYYY-MM-DDTHH:mm) — KST 벽시계 기준.
// 서버(UTC)에서 렌더돼도 한국 시각이 나오도록 오프셋을 직접 적용.
export function toDateTimeLocalValue(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
  );
}

// datetime-local 로 입력받은 벽시계 문자열을 KST 로 해석해 ISO(UTC) 로 변환.
export function kstLocalToISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi)),
  ).toISOString();
}
