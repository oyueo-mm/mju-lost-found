import { LinkButton } from "@/components/ui/Button";

// Phase 30: the page's first viewport -- a soft, blurred blue glow behind
// the copy (pure decoration, `pointer-events-none` + `-z-10`) is the only
// "visual flourish" here, kept faint (10% opacity) per this phase's own
// "no heavy gradients" rule. Everything else is just large type + one CTA.
export function Hero() {
  return (
    <section className="relative flex flex-col items-center gap-6 overflow-hidden px-2 pt-10 pb-4 text-center md:gap-8 md:pt-16">
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-3xl md:h-96 md:w-96"
      />

      <span className="rounded-full bg-primary-muted px-3 py-1 text-xs font-medium text-primary">
        명지대학교 전용 서비스
      </span>

      <h1 className="max-w-2xl text-3xl leading-tight font-bold text-balance text-foreground md:text-5xl">
        잃어버린 물건,
        <br />
        <span className="text-primary">AI</span>가 대신 찾아드립니다
      </h1>

      <p className="max-w-md text-sm text-muted-foreground md:max-w-lg md:text-base">
        명지대학교 캠퍼스 전용 분실물 · 습득물 서비스입니다. 등록만 하면 AI가 비슷한 물건을 자동으로 찾아 연결해드립니다.
      </p>

      <LinkButton href="/login" size="md" className="mt-2 px-8">
        로그인하고 시작하기
      </LinkButton>
    </section>
  );
}
