import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";

// 홈 하단의 교내 협력 안내. 크고 화려한 배너가 아니라 작은 제목 + 한 줄
// 설명이다. 협력 사실만 적고 "공식 운영·지정"처럼 확인되지 않은 표현은
// 쓰지 않는다(공식 서비스가 아니라는 푸터 고지는 그대로 유지). 협력기관의
// 로고·교표는 사용하지 않는다. 기존 이용 안내(운영정책)로 연결한다.
export async function CampusPartners() {
  const t = await getTranslator();
  return (
    <section aria-labelledby="campus-partners-title" className="mt-8 flex flex-col gap-1 border-t border-border pt-4 text-sm md:mt-10">
      <h2 id="campus-partners-title" className="text-sm font-semibold text-foreground">
        {t("home.partners.title")}
      </h2>
      <p className="leading-relaxed break-keep text-muted-foreground">{t("home.partners.body")}</p>
      <Link href="/policy/community" className="w-fit text-sm font-medium text-primary hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {t("footer.link.community")} <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
