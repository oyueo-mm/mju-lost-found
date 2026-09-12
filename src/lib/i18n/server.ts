import { cache } from "react";
import { cookies, headers } from "next/headers";

import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { getDictionary } from "./messages";
import { createTranslator, type Translator } from "./translate";

// 서버 컴포넌트(페이지/레이아웃)용 진입점. 이 앱은 화면의 대부분이 서버
// 컴포넌트이므로, 첫 HTML부터 올바른 언어로 렌더링되는 경로가 바로 이쪽
// 이다 -- 클라이언트에서 나중에 번역을 갈아끼우는 방식이 아니다.
//
// React의 cache()로 감싼 이유: 한 번의 요청 안에서 layout, page, 그 안의
// 여러 서버 컴포넌트가 각자 getTranslator()를 불러도 쿠키/헤더 파싱과
// 번역기 생성이 요청당 한 번만 일어나게 한다.
//
// cookies()/headers()를 읽으므로 이걸 쓰는 라우트는 동적 렌더링이 된다 --
// 이 앱은 원래도 모든 (main) 페이지가 getCurrentUser()로 세션 쿠키를 읽는
// 동적 렌더링이라, 새로 정적 렌더링을 포기하게 되는 페이지는 없다.
export const getLocale = cache(async (): Promise<Locale> => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerList.get("accept-language"));
});

export const getTranslator = cache(async (): Promise<Translator> => {
  const locale = await getLocale();
  return createTranslator(locale, getDictionary(locale));
});
