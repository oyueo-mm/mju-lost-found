import { ko } from "./messages/ko";
import type { Locale } from "./config";

// 사전은 "점으로 구분된 평평한 키 -> 문자열" 하나짜리 Record다. 중첩
// 객체 대신 평평한 키를 쓰는 이유는 (1) 한국어 사전과 나머지 언어 사전의
// 차이를 눈으로도 도구로도 바로 비교할 수 있고, (2) 아래 TranslationKey
// 타입이 그대로 "존재하는 키 목록"이 되어 오타가 컴파일 단계에서 잡히기
// 때문이다.
export type TranslationKey = keyof typeof ko;

// 한국어(ko)만 모든 키를 반드시 가진 완전한 사전이고, 나머지 언어는
// 부분 사전이다 -- 번역이 아직 없는 키는 한국어 문장으로 떨어진다.
// 일부러 이렇게 설계했다: 이 서비스는 이미 운영 중이고, 새 문구가
// 추가될 때마다 5개 언어 번역이 모두 갖춰지기 전에는 배포할 수 없게
// 만들면 오히려 한국어 화면조차 막히게 된다. 화면에 키 이름("post.title"
// 같은 개발자용 문자열)이 노출되는 일은 절대 없다.
export type Dictionary = Partial<Record<TranslationKey, string>>;

export type TranslationValues = Record<string, string | number>;

// `{name}` 형태의 자리표시자만 치환한다 -- 값이 넘어오지 않은
// 자리표시자는 그대로 두지 않고 빈 문자열로 지운다(문장 안에 "{count}"가
// 그대로 보이는 것보다 낫다).
function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match,
  );
}

export type Translator = {
  (key: TranslationKey, values?: TranslationValues): string;
  locale: Locale;
};

// 이 앱 전체가 쓰는 단 하나의 번역 함수. 조회 순서는
//   선택된 언어의 사전 -> 한국어 사전 -> (그래도 없으면) 키 자체.
// 마지막 단계는 실질적으로 도달할 수 없다(TranslationKey 타입이 한국어
// 사전의 키로 제한돼 있으므로) -- 런타임에서 사전이 어떤 이유로든
// 깨졌을 때 화면이 빈칸이 되지 않게 하는 마지막 방어선일 뿐이다.
export function createTranslator(locale: Locale, dictionary: Dictionary): Translator {
  const t = (key: TranslationKey, values?: TranslationValues): string => {
    const template = dictionary[key] ?? ko[key] ?? key;
    return interpolate(template, values);
  };
  t.locale = locale;
  return t;
}
