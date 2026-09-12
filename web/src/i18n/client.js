"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT } from "./t";
import { DEFAULT_LOCALE } from "./locales";

const LocaleContext = createContext(DEFAULT_LOCALE);

// 루트 레이아웃에서 감싸서 클라이언트 컴포넌트가 useT() 로 같은 사전을 쓰게 한다.
export function LocaleProvider({ locale, children }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useT() {
  const locale = useLocale();
  return useMemo(() => makeT(locale), [locale]);
}
