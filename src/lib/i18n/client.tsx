"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "./config";
import { ko } from "./messages/ko";
import { createTranslator, type Dictionary, type Translator } from "./translate";

// 클라이언트 컴포넌트용 진입점. 서버가 이미 고른 언어와 그 언어의 사전
// 하나만 props로 내려받아(app/layout.tsx의 I18nProvider) context에 담는다
// -- 클라이언트 번들에 5개 언어 사전이 모두 들어가지 않는다.
type I18nContextValue = { locale: Locale; t: Translator };

// 기본값은 한국어 -- Provider 바깥에서 렌더링되는 컴포넌트가 생기더라도
// 예외를 던지는 대신 기존과 똑같은 한국어 화면이 나온다(이미 운영 중인
// 서비스이므로, 번역 계층이 화면을 깨뜨릴 수 있는 형태로 만들지 않는다).
const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: createTranslator(DEFAULT_LOCALE, ko),
});

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ locale, t: createTranslator(locale, messages) }),
    [locale, messages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// 클라이언트 컴포넌트는 이 훅 하나만 쓴다: `const { t } = useI18n();`
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

// 언어 선택을 브라우저에 저장한다. 서버가 읽을 수 있어야 하므로
// localStorage가 아니라 쿠키다(config.ts의 LOCALE_COOKIE 주석 참고).
// SameSite=Lax/1년 만료 -- 로그인 세션이나 DB는 전혀 건드리지 않는다.
export function persistLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}
