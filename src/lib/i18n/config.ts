// 다국어(i18n) Phase: 명지대학교에는 한국어를 읽지 못하는 유학생도 많이
// 이용할 수 있어야 한다 -- 참고 자료에서 확인된 주요 유학생 국적(중국,
// 베트남, 몽골)에 맞춰 최소 5개 언어를 지원한다. 한국어가 기본 언어이고,
// 나머지는 "번역이 있으면 그 문장, 없으면 한국어"로 항상 안전하게
// 떨어진다(translate.ts 참고).
//
// 일부러 외부 i18n 라이브러리(next-intl, react-i18next 등)를 추가하지
// 않았다 -- 이 앱은 URL에 로케일 세그먼트를 넣지 않고(기존 URL 구조를
// 바꾸지 않는 것이 이번 작업의 제약), 복수형/성별 변화 같은 고급 기능도
// 쓰지 않으며, 필요한 것은 "쿠키로 고른 언어 하나 + 평평한 문자열 사전"
// 뿐이다. 그 정도는 아래 100줄 남짓으로 충분하고, 새 의존성과 미들웨어
// 라우팅 규칙을 들여오는 쪽이 오히려 기존 구조를 더 크게 건드린다.
export const LOCALES = ["ko", "en", "zh", "vi", "mn"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ko";

// 언어 선택은 쿠키에 저장한다 -- 서버 컴포넌트가 대부분인 이 앱에서
// 첫 렌더링부터 올바른 언어로 HTML을 내려주려면 서버가 읽을 수 있는
// 저장소여야 하고(localStorage는 서버에서 읽을 수 없어 첫 화면이 항상
// 한국어로 깜빡인다), 로그인/DB 구조는 이 기능 때문에 바꾸지 않기로 한
// 제약도 그대로 지킬 수 있다(User 테이블에 컬럼을 추가하지 않는다).
export const LOCALE_COOKIE = "locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Footer의 언어 선택 UI에 그대로 쓰이는 라벨 -- 각 언어는 항상 그 언어
// 자신의 표기로 보여준다("中文"을 한국어로 "중국어"라고 쓰면 정작 그
// 언어 사용자가 자기 언어를 못 찾는다).
export const LOCALE_LABELS: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  zh: "中文",
  vi: "Tiếng Việt",
  mn: "Монгол",
};

// <html lang>과 Intl.DateTimeFormat에 넘길 BCP 47 태그. 중국어는
// 간체(zh-Hans)를 쓴다 -- 이 앱의 번역문이 간체로 작성돼 있다.
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  ko: "ko",
  en: "en",
  zh: "zh-Hans",
  vi: "vi",
  mn: "mn",
};

// 날짜/시간 표시에 쓰는 Intl 로케일. 기존 코드가 하드코딩하던 "ko-KR"을
// 대체한다 -- 타임존(Asia/Seoul)은 언어와 무관하게 그대로다(명지대학교
// 캠퍼스에서 일어난 일의 시각이므로, 보는 사람의 언어가 바뀐다고 기준
// 시간대까지 바뀌면 오히려 틀린 정보가 된다).
export const LOCALE_INTL_TAG: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
  zh: "zh-CN",
  vi: "vi-VN",
  mn: "mn-MN",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// Accept-Language 헤더에서 이 앱이 지원하는 언어 하나를 고른다 --
// q-value(가중치)를 존중하되, 지원하지 않는 언어는 건너뛴다. "zh-CN",
// "zh-Hans-CN", "en-GB"처럼 지역/문자 서브태그가 붙은 값은 앞의 기본
// 언어 서브태그만 보고 매칭한다. 지원 언어가 하나도 없으면 null --
// 호출자(resolveLocale)가 그때 기본 언어로 떨어진다.
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const entries = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag !== "" && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}

// 이번 작업의 언어 결정 우선순위를 한 곳에 모아 둔 함수:
//   1. 사용자가 직접 선택한 언어  -> 선택 즉시 쿠키에 저장되므로
//   2. 저장된 언어 설정           -> 이 두 단계가 같은 `cookieValue`다
//   3. 브라우저 언어              -> Accept-Language 헤더
//   4. 한국어                     -> DEFAULT_LOCALE
// 1과 2를 굳이 따로 읽지 않는 이유: 사용자가 고른 값이 곧바로 저장되는
// 값이라 둘은 언제나 같은 출처이고, 따로 관리하면 "고른 언어"와 "저장된
// 언어"가 어긋날 수 있는 상태를 새로 만들 뿐이다.
export function resolveLocale(cookieValue: string | undefined, acceptLanguage?: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
