"use client";

// LOST112 연계 Phase: 검색 결과가 없을 때 경찰청 유실물 서비스로 안내하는
// 정적 카드. 실제 API 연동/데이터 공유는 전혀 없다 -- 그냥 공식 외부
// 서비스로의 링크 하나뿐이다(§6: 역할을 과장하지 않는다). 처음에는 독립
// 사이트(www.lost112.go.kr)를 가리켰으나 유실물 서비스가 경찰민원24로
// 옮겨져, 경찰민원24 메인의 "유실물 민원 > 습득물 검색" 링크와 같은 주소
// (로그인 없이 열리는 공개 검색 페이지)를 쓴다. 컴포넌트/메시지 키
// 이름(lost112.*)은 그대로 둔다.
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
        href="https://minwon24.police.go.kr/cvlcpt/cvlcptAply.do?cvlcptId=MW-201"
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
