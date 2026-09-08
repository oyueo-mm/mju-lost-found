import { LinkButton } from "@/components/ui/Button";

// Phase K: the id lets LandingStickyCta hide its floating button while
// this section is on screen, so the page never shows two "로그인하고
// 시작하기" buttons at once. Styling unchanged.
export function FinalCta() {
  return (
    <section
      id="landing-final-cta"
      className="flex flex-col items-center gap-5 rounded-card border border-border bg-primary-muted/40 px-6 py-14 text-center md:py-16"
    >
      <h2 className="max-w-md text-2xl font-bold text-balance text-foreground md:text-3xl">
        잃어버린 물건을 찾고 계신가요?
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground md:text-base">
        지금 로그인하고 명지대학교 분실물 센터를 이용하실 수 있습니다.
      </p>
      <LinkButton href="/login" size="md" className="px-8">
        로그인하고 시작하기
      </LinkButton>
    </section>
  );
}
