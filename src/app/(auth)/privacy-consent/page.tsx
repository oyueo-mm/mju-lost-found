import { redirect } from "next/navigation";
import Link from "next/link";

import { hasRequiredConsents, requireUser, sanitizeCallbackUrl } from "@/lib/auth/session";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms";
import { signOut } from "@/lib/auth/auth";
import { LogoMark } from "@/components/layout/Logo";
import { ShieldIcon, ChevronRightIcon, BookIcon } from "@/components/icons";
import { PrivacyConsentButton } from "./PrivacyConsentButton";

// Phase 8: the actual items/purposes below are drawn directly from this
// app's real schema and features (see prisma/schema.prisma, and this
// phase's own investigation) -- nothing here is a stand-in for legal
// items the app doesn't actually collect, and nothing states a retention
// period more specific than what the code itself guarantees (rows are
// kept for as long as the account/content exists; there is no separate
// data-retention job in this codebase). This is a service-level notice,
// not legal advice -- it doesn't cite statutes or claim legal review.
// Never lists gender/locale/other Google public-profile fields -- the
// app never reads them (see auth.ts's own comment on why the OAuth scope
// was narrowed to "openid email").
//
// 이용약관 동의 Phase: this screen now also gates on the separate terms
// consent (see hasRequiredConsents()) -- this page's own top comment
// above used to say "there is no separate terms-of-service in this app
// today", which is no longer true (/policy/terms exists), so this screen
// now asks for that consent too, as its own independent checkbox/DB field
// (User.termsAcceptedAt/termsVersion), never merged into the privacy
// checkbox above it. The two documents/consents stay wherever this
// phase's own design put them: /policy/terms and /policy/community are
// only linked from here, never reproduced inline (that content lives in
// its own pages, same as this one never repeats a URL's real content).
const COLLECTED_ITEMS: { label: string; detail: string }[] = [
  { label: "Google 계정 식별 정보", detail: "Google 계정의 고유 식별자(구글 로그인 시 발급)" },
  { label: "이메일 주소", detail: "Google 계정의 이메일 주소" },
  { label: "이름 및 닉네임", detail: "Google 계정 이름(또는 이메일 기반 대체명), 직접 설정한 닉네임" },
  { label: "게시글 정보", detail: "분실물/습득물 게시글의 제목, 내용, 장소, 날짜, 첨부 이미지" },
  { label: "댓글/답글", detail: "게시글에 작성한 댓글 및 답글 내용" },
  { label: "채팅 메시지", detail: "다른 이용자와 주고받은 채팅 메시지, 채팅으로 전송한 사진" },
  { label: "서비스 이용 기록", detail: "로그인 일시, 게시글 조회 기록, 신고/알림 등 서비스 이용 내역" },
];

export default async function PrivacyConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const user = await requireUser(); // redirects to /login if not signed in
  const { callbackUrl: rawCallbackUrl } = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(rawCallbackUrl) ?? null;

  // 이용약관 동의 Phase: each consent's "still needed" flag is computed
  // independently -- an existing user who already agreed to the privacy
  // notice long ago but has never agreed to the terms (every pre-this-
  // phase account) only needs `needsTerms`; a first-time visitor needs
  // both. Passed down to PrivacyConsentButton so it can render each
  // checkbox as either interactive (still needed) or an already-done
  // state (see that component's own comment) -- never re-demanding a
  // consent this user already gave.
  const needsPrivacy = user.privacyConsentAt === null;
  const needsTerms = user.termsAcceptedAt === null || user.termsVersion !== CURRENT_TERMS_VERSION;

  // Already consented to everything currently required (e.g. re-visiting
  // this URL directly, or a race with a second tab) -- send them straight
  // on instead of showing the notice again. Prevents any redirect loop
  // with requireReadyUser/onboarding/login, all of which only ever send a
  // user *here* when hasRequiredConsents() is false.
  if (hasRequiredConsents(user)) {
    redirect(callbackUrl ?? "/");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6 py-12">
      {/* [data-fade-in]: the exact same on-load fade+rise the login card
          already uses (see globals.css) -- this phase's own instruction is
          to reuse the site's existing animation system, not invent a new
          one, so this screen arrives with the same small settle every
          other auth page does instead of popping in fully formed. */}
      <div data-fade-in className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <LogoMark size={44} />
          <p className="text-xs font-medium tracking-wide text-muted-foreground">MYONGJI L&amp;F</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground">👋 시작하기 전에 잠깐 확인해주세요</h1>
          <p className="text-sm text-muted-foreground">
            서비스를 이용하기 위해 필요한
            <br />
            정보를 간단히 안내해드릴게요.
          </p>
        </div>

        {/* Same base card language every other card in this app uses
            (PostCard.tsx: rounded-card border border-border bg-card, no
            shadow at rest) -- deliberately not the login card's own
            heavier glass/backdrop-blur treatment, so this reads as an
            ordinary in-app content card, not a special "legal document"
            surface. */}
        <div className="flex w-full flex-col gap-4 rounded-card border border-border bg-card p-5 text-sm text-foreground">
          <div className="flex items-center gap-1.5 font-semibold">
            <ShieldIcon className="size-4.5 text-primary" />
            필요한 정보
          </div>

          <div className="flex flex-col gap-2">
            <p>Google 계정 · 닉네임 · 게시글 · 이미지 · 댓글 · 채팅</p>
            <p className="text-muted-foreground">
              분실물을 등록하고 검색하고 연락하기 위해 사용됩니다.
            </p>
          </div>

          {/* Native <details>/<summary> -- no JS, no client component
              needed for this expand/collapse alone. This phase's own spec
              rules out "스크롤을 끝까지 내려야 동의 가능" -- this is the
              opposite of that: the full detail is one tap away, never
              gated behind a forced scroll, and the checkbox below is
              enabled the instant the user checks it regardless of
              whether this was ever opened. */}
          <details className="group flex flex-col gap-3 border-t border-border pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-primary">
              자세한 내용 보기
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            </summary>

            <div className="flex flex-col gap-3 text-muted-foreground">
              <section className="flex flex-col gap-1">
                <h3 className="font-medium text-foreground">수집 항목</h3>
                <ul className="flex flex-col gap-1">
                  {COLLECTED_ITEMS.map((item) => (
                    <li key={item.label}>
                      <span className="font-medium text-foreground">{item.label}</span> — {item.detail}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="flex flex-col gap-1">
                <h3 className="font-medium text-foreground">보유 및 이용 기간</h3>
                <p>
                  계정 정보는 회원 계정이 유지되는 동안(계정 비활성화 중에도) 보유합니다. 게시글,
                  댓글·답글, 채팅 메시지 및 첨부 정보는 이용자가 직접 삭제하거나 서비스 운영상 삭제 사유가
                  발생할 때까지 보유될 수 있습니다. 회원탈퇴 시 계정의 직접 식별정보는 즉시 삭제되며, 채팅
                  메시지 본문은 탈퇴 후 90일, 처리가 끝난 신고·제재·이의신청 기록과 관련 증거는 처리 완료 후
                  1년간 보관한 뒤 삭제합니다(처리 중인 신고의 대상 정보는 처리가 끝날 때까지 보관). 관계
                  법령에 따라 일정 기간 보존이 필요한 정보가 있는 경우에는 해당 법령에서 정한 기간 동안
                  보관합니다. 자세한 내용은{" "}
                  <Link href="/policy/privacy" target="_blank" className="font-medium text-primary hover:opacity-80">
                    개인정보처리방침
                  </Link>
                  을 확인해주세요.
                </p>
              </section>
            </div>
          </details>
        </div>

        {/* 이용약관 동의 Phase: same card language as the privacy card
            directly above -- this screen's own established "in-app
            content card, not a legal-document surface" rule. Deliberately
            no inline reproduction of either document's actual text (this
            phase's own instruction never to duplicate /policy/community's
            10-item 금지행위 list, or /policy/terms's own sections, here) --
            just enough context to know what's being agreed to, plus links
            to the real documents. */}
        <div className="flex w-full flex-col gap-3 rounded-card border border-border bg-card p-5 text-sm text-foreground">
          <div className="flex items-center gap-1.5 font-semibold">
            <BookIcon className="size-4.5 text-primary" />
            이용약관
          </div>
          <p className="text-muted-foreground">
            서비스 이용을 위한 기본 조건과 이용자의 의무, 계정 이용 제한 및 이의신청 절차 등을
            안내합니다. 구체적인 금지행위와 신고·조치 기준은 운영정책에서 확인할 수 있습니다.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-primary">
            <Link href="/policy/terms" target="_blank" className="font-medium hover:opacity-80">
              이용약관 보기
            </Link>
            <Link href="/policy/community" target="_blank" className="font-medium hover:opacity-80">
              운영정책 보기
            </Link>
          </div>
        </div>

        <PrivacyConsentButton callbackUrl={callbackUrl} needsPrivacy={needsPrivacy} needsTerms={needsTerms} />

        {/* Calm, single line -- states the fact (consent is required to
            continue) and the way out, without a separate warning block or
            pressuring language, per this phase's own "공포를 유발하는 표현
            금지" principle. <form> can't nest inside <p> (invalid HTML), so
            this is a flex row of two inline text pieces instead. */}
        <div className="flex flex-wrap items-center justify-center gap-x-1 text-center text-xs text-muted-foreground">
          <span>동의하지 않으시면 계속 진행할 수 없어요.</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit" className="underline hover:text-foreground">
              동의하지 않고 로그아웃
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
