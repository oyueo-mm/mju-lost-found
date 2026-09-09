import Link from "next/link";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth/auth";
import { getCurrentUser, sanitizeCallbackUrl, type LoginReason } from "@/lib/auth/session";
import { isGoogleTestModeEnabled } from "@/lib/settings/service";
import { LogoMark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "명지대학교 계정(@mju.ac.kr)만 이용할 수 있습니다.",
  Default: "로그인 중 문제가 발생했습니다. 다시 시도해주세요.",
};

// Phase 14: the one-line explanation shown above the Google button when a
// protected page redirected here with a `reason` (see
// src/lib/auth/session.ts's requireReadyUser()). Purely informational --
// login itself doesn't change based on this.
const REASON_MESSAGES: Record<LoginReason, string> = {
  write: "게시글을 작성하거나 수정하려면 로그인해주세요.",
  chat: "채팅을 이용하려면 로그인해주세요.",
  match: "매칭 정보를 보려면 로그인해주세요.",
  mypost: "내 게시글을 보려면 로그인해주세요.",
  notification: "알림을 확인하려면 로그인해주세요.",
};

function isLoginReason(value: string): value is LoginReason {
  return value in REASON_MESSAGES;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; callbackUrl?: string }>;
}) {
  const { error, reason, callbackUrl: rawCallbackUrl } = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(rawCallbackUrl);

  // Phase H-6 section 9: read-only, purely informational -- the real
  // OAuth gate (which accounts can actually sign in) is enforced server-
  // side by the NextAuth signIn callback via this same
  // isGoogleTestModeEnabled(), never by anything on this page. This call
  // only decides whether to *show* the test-mode banner below; it can't
  // loosen or tighten who's allowed to log in.
  const [user, googleTestModeEnabled] = await Promise.all([getCurrentUser(), isGoogleTestModeEnabled()]);
  if (user) {
    redirect(user.nickname ? (callbackUrl ?? "/") : "/onboarding");
  }

  const errorMessage = error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default : null;
  const reasonMessage = reason && isLoginReason(reason) ? REASON_MESSAGES[reason] : null;

  return (
    // Phase P-4: a very soft, low-opacity glow behind the card (same
    // decorative pattern Hero.tsx's landing page already uses) instead of
    // the previous bare-background layout -- gives the screen a designed,
    // considered feel without introducing a new visual language. The card
    // itself uses a low-contrast border (border-border/60) and a soft
    // shadow instead of a full-strength border, since in the default
    // light theme --card and --background are the same white (see
    // globals.css) and a full-opacity border was the only thing drawing a
    // hard edge around the content. The dedicated high-contrast
    // accessibility theme is untouched -- only this page's own classes
    // changed, not the shared color tokens.
    <div className="relative flex min-h-full flex-1 flex-col items-center justify-center overflow-hidden px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/4 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        data-fade-in
        className="flex w-full max-w-sm flex-col items-center gap-8 rounded-2xl border border-border/60 bg-card/80 px-8 py-10 text-center shadow-sm backdrop-blur-sm"
      >
        <div className="flex flex-col items-center gap-3.5">
          <LogoMark size={56} />
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">명지 스마트 분실물 센터</h1>
            <p className="text-sm text-muted-foreground">캠퍼스에서 잃어버린 물건을 빠르게 찾아드려요</p>
          </div>
        </div>

        {errorMessage && (
          <p className="w-full rounded-card border border-destructive/30 bg-destructive-muted px-4 py-2.5 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        {/* Phase 14: shown instead of the error box above when this page was
            reached by requireReadyUser()'s redirect (not by an actual OAuth
            error) -- a neutral explanation, not a red error message, since
            "please log in to do X" isn't a failure. */}
        {!errorMessage && reasonMessage && (
          <p className="w-full rounded-card border border-border bg-muted px-4 py-2.5 text-sm text-muted-foreground">
            {reasonMessage}
          </p>
        )}

        {/* Phase H-6 section 9: only visible while an admin has turned test
            mode on (see admin settings UI / isGoogleTestModeEnabled) -- when
            off, this page renders exactly as it did before this phase. Text
            is the exact wording requested: explains in one glance, without
            any jargon, that a non-@mju.ac.kr Google account will work for
            now. This is a UI notice only; the actual OAuth accept/reject
            decision is unchanged, made server-side by the signIn callback
            reading the same setting. */}
        {googleTestModeEnabled && (
          <p className="w-full whitespace-pre-line rounded-card border border-primary/30 bg-primary-muted px-4 py-2.5 text-sm text-primary">
            {"🧪 현재 테스트 기간입니다\n\n테스트를 위해 명지대학교 계정이 아닌 일반 Google 계정도\n로그인할 수 있습니다."}
          </p>
        )}

        <form
          className="w-full"
          action={async () => {
            "use server";
            // callbackUrl was already validated as same-origin-relative by
            // sanitizeCallbackUrl() above -- signIn's redirectTo accepts it
            // as-is, sending the user back to the page they came from
            // instead of always landing on "/".
            await signIn("google", callbackUrl ? { redirectTo: callbackUrl } : undefined);
          }}
        >
          <Button type="submit" variant="secondary" className="w-full">
            Google로 로그인
          </Button>
        </form>

        {/* Phase H-6 section 9: this line would directly contradict the test-
            mode banner above ("일반 Google 계정도 로그인할 수 있습니다" vs
            "로그인할 수 없습니다" back to back on the same screen), so it's
            suppressed only while test mode is on -- the underlying rule
            itself (and its server-side enforcement) is unchanged, this is
            purely about not showing two contradictory sentences at once. */}
        {!googleTestModeEnabled && (
          <p className="text-xs text-muted-foreground">
            학교 계정(@mju.ac.kr)이 아닌 계정은 로그인할 수 없습니다.
          </p>
        )}

        <div className="flex w-full flex-col items-center gap-1.5 border-t border-border/60 pt-6">
          <p className="text-sm text-muted-foreground">명지대 계정이 없으신가요?</p>
          <Link href="/account-guide" className="text-sm font-medium text-primary hover:opacity-80">
            명지대 계정 생성 방법 보기
          </Link>
        </div>
      </div>
    </div>
  );
}
