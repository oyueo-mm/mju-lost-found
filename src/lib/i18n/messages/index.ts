import type { Locale } from "../config";
import type { Dictionary } from "../translate";
import { ko } from "./ko";
import { en } from "./en";
import { zh } from "./zh";
import { vi } from "./vi";
import { mn } from "./mn";

// 5개 사전을 정적으로 import한다 -- 동적 import(코드 스플리팅)를 쓰지
// 않는 이유는, 이 사전들이 순수 문자열 테이블이라 한 언어당 수 KB
// 수준이고, 서버 컴포넌트가 렌더링 도중 await 없이 바로 읽을 수 있어야
// 하기 때문이다. 클라이언트로 내려가는 것은 이 전체가 아니라 현재
// 언어의 사전 하나뿐이다(app/layout.tsx의 I18nProvider가 고른 것 하나만
// props로 직렬화된다).
export const DICTIONARIES: Record<Locale, Dictionary> = { ko, en, zh, vi, mn };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? ko;
}
