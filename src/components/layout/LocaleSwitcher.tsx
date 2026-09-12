"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/config";
import { persistLocale, useI18n } from "@/lib/i18n/client";

// 다국어(i18n) Phase: Footer의 언어 선택 UI. 각 언어는 그 언어 자신의
// 표기로만 보여준다(LOCALE_LABELS) -- "中文"을 한국어로 "중국어"라고
// 적어두면 정작 중국어 사용자가 자기 언어를 못 찾는다.
//
// 동작: 쿠키에 저장(persistLocale) -> router.refresh(). 서버 컴포넌트가
// 새 쿠키로 다시 렌더링되면서 화면 전체가 그 언어로 바뀐다 -- 별도의
// 클라이언트 측 문구 교체 경로를 만들지 않았다(첫 렌더링과 언어 변경
// 후 렌더링이 완전히 같은 경로를 타므로 둘이 어긋날 수 없다). 쿠키에
// 저장되므로 새로고침하거나 나중에 다시 방문해도 그대로 유지된다.
//
// 로그인/DB는 전혀 건드리지 않는다 -- User 테이블에 언어 컬럼을
// 추가하지 않았고(이번 작업의 제약), 로그아웃 상태에서도 똑같이 동작한다.
export function LocaleSwitcher() {
  const router = useRouter();
  const { locale: current, t } = useI18n();
  const [pending, startTransition] = useTransition();

  function handleSelect(next: Locale) {
    if (next === current) return;
    persistLocale(next);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-xs font-semibold text-foreground">{t("locale.label")}</h3>
      {/* radiogroup: 서로 배타적인 하나의 선택이라는 점이 보조기술에도
          그대로 전달된다(이 앱의 SearchModeToggle이 쓰는 것과 같은 패턴). */}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("locale.change")}>
        {LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            role="radio"
            aria-checked={locale === current}
            // lang: 이 버튼의 글자만큼은 그 언어라고 알려준다 -- 한국어
            // 페이지 안의 "Монгол" 한 단어를 스크린 리더가 한국어로
            // 읽어버리지 않게 한다.
            lang={locale}
            disabled={pending}
            onClick={() => handleSelect(locale)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
              locale === current
                ? "border-primary bg-primary-muted text-primary"
                : "border-border text-muted-foreground hover:border-foreground/30"
            }`}
          >
            {LOCALE_LABELS[locale]}
          </button>
        ))}
      </div>
    </div>
  );
}
