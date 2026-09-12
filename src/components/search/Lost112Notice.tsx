"use client";

// LOST112 연계 Phase: 검색 결과가 없을 때 경찰청 유실물 통합포털(LOST112)로
// 안내하는 정적 카드. 실제 API 연동/데이터 공유는 전혀 없다 -- 그냥 공식
// 외부 서비스로의 링크 하나뿐이다(§6: 역할을 과장하지 않는다). URL은
// 여러 독립된 출처(정부 시스템 자체 도메인, 구글 플레이 앱 설명, 언론/블로그
// 소개 글)로 교차 확인한 공식 도메인(www.lost112.go.kr)이다.
//
// EmptyState(components/ui/EmptyState.tsx)를 대체하지 않고 그 아래에 별도
// 카드로 추가한다 -- EmptyState는 채팅/알림 등 이 안내가 전혀 의미 없는
// 곳에서도 재사용되는 범용 컴포넌트라, LOST112 관련 문구를 그 안에
// 하드코딩하지 않는다.
import { useI18n } from "@/lib/i18n/client";

const EXTERNAL_LINK_ANCHOR_CLASS =
  "inline-flex w-fit items-center gap-1.5 self-start rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-foreground/30";

export function Lost112Notice() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-2 rounded-card border border-dashed border-border px-6 py-5 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{t("lost112.title")}</p>
      <p>
        {t("lost112.description1")}
        <br className="hidden sm:inline" /> {t("lost112.description2")}
      </p>
      <a
        href="https://www.lost112.go.kr"
        target="_blank"
        rel="noopener noreferrer"
        className={`${EXTERNAL_LINK_ANCHOR_CLASS} mx-auto`}
      >
        {t("lost112.cta")}
        <span aria-hidden="true">↗</span>
        <span className="sr-only">{t("common.openInNewWindow")}</span>
      </a>
    </div>
  );
}
