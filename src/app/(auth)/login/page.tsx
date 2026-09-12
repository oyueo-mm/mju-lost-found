import Link from "next/link";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth/auth";
import { getCurrentUser, sanitizeCallbackUrl, type LoginReason } from "@/lib/auth/session";
import { isGoogleTestModeEnabled } from "@/lib/settings/service";
import { LogoMark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/translate";

// 다국어(i18n) Phase: 문구 대신 번역 키를 담는다 -- 키/분기 구조는
// 그대로이고, 실제 문장만 현재 언어로 바뀐다.
const ERROR_MESSAGE_KEYS: Record<string, TranslationKey> = {
  AccessDenied: "auth.login.error.accessDenied",
  Default: "auth.login.error.default",
};

// Phase 14: the one-line explanation shown above the Google button when a
// protected page redirected here with a `reason` (see
// src/lib/auth/session.ts's requireReadyUser()). Purely informational --
// login itself doesn't change based on this.
const REASON_MESSAGE_KEYS: Record<LoginReason, TranslationKey> = {
  write: "auth.login.reason.write",
  chat: "auth.login.reason.chat",
  match: "auth.login.reason.match",
  mypost: "auth.login.reason.mypost",
  notification: "auth.login.reason.notification",
};

function isLoginReason(value: string): value is LoginReason {
  return value in REASON_MESSAGE_KEYS;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; callbackUrl?: string }>;
}) {
  const t = await getTranslator();
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
    // Phase 8: same three-way precedence as session.ts's requireReadyUser
    // (consent -> nickname -> ready) -- an already-signed-in visitor who
    // lands back on /login (e.g. clicking the Google button again) gets
    // routed exactly where a fresh sign-in would send them.
    if (user.privacyConsentAt === null) {
      const params = callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : "";
      redirect(`/privacy-consent${params}`);
    }
    redirect(user.nickname ? (callbackUrl ?? "/") : "/onboarding");
  }

  const errorMessage = error ? t(ERROR_MESSAGE_KEYS[error] ?? ERROR_MESSAGE_KEYS.Default) : null;
  const reasonMessage = reason && isLoginReason(reason) ? t(REASON_MESSAGE_KEYS[reason]) : null;

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
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("auth.login.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("auth.login.subtitle")}</p>
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
            {t("auth.login.google")}
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
            {t("auth.login.domainNotice")}
          </p>
        )}

        <div className="flex w-full flex-col items-center gap-1.5 border-t border-border/60 pt-6">
          <p className="text-sm text-muted-foreground">{t("auth.login.noAccount")}</p>
          <Link href="/account-guide" className="text-sm font-medium text-primary hover:opacity-80">
            {t("auth.login.accountGuide")}
          </Link>
        </div>
      </div>
    </div>
  );
}
