import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isAllowedEmail } from "@/lib/auth/domain";
import { resolveOrCreateUser } from "@/lib/auth/user";
import { isGoogleTestModeEnabled } from "@/lib/settings/service";

// No next-auth Adapter/database session store here -- see the User.googleId
// comment in schema.prisma. Sessions are JWT-based (a signed cookie), and
// the only DB write in this whole flow is the upsert in the jwt callback
// below.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Phase 8: narrower than next-auth's own default ("openid email
      // profile") -- this app never reads a Google profile picture, and
      // the *only* thing "profile" scope actually earns this app is
      // User.name (see resolveOrCreateUser below), which is itself only
      // ever shown once, on the onboarding welcome line, and to admins in
      // the user list -- everywhere else in this app (author bylines,
      // chat, comments, ...) displays the user's own chosen `nickname`,
      // never `name`. That one cosmetic use isn't worth the OAuth consent
      // screen also asking for gender/locale/"other public profile info"
      // (all bundled under Google's single indivisible "profile" scope,
      // regardless of whether an app's code ever reads them). Dropping it
      // costs nothing structurally: resolveOrCreateUser already falls
      // back to the email's local part when Google reports no name (see
      // its own comment), and its `update` branch only *writes* name when
      // one is actually provided (`?? undefined`), so an existing user's
      // already-stored real name is never overwritten with the fallback
      // on a later login. email/email_verified (the signIn callback's own
      // @mju.ac.kr gate) and `sub` (googleId) both come from `openid
      // email` alone -- neither needs `profile`.
      authorization: { params: { scope: "openid email" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // Authorization gate: runs before any User row is touched. Returning
    // false here rejects the sign-in outright (next-auth redirects back to
    // `pages.error` with ?error=AccessDenied) -- this is the server-side
    // enforcement of the @mju.ac.kr restriction; the /login page's copy
    // ("학교 계정만 이용 가능") is UX only and isn't what actually blocks
    // anyone.
    //
    // Phase H-3: a non-@mju.ac.kr account is no longer an automatic
    // rejection -- it now falls through to the admin-toggleable
    // "일반 Google 계정 테스트 허용" gate (AppSettings.googleTestModeEnabled,
    // see src/lib/settings/service.ts) before being rejected. The DB read
    // is wrapped in try/catch and fails *closed*: any error here (DB down,
    // etc.) is treated as test mode being off, so a settings-lookup
    // failure can never accidentally widen who's allowed in -- it can only
    // ever narrow back to the original @mju.ac.kr-only behavior. This
    // never bypasses the domain check itself, only what happens when that
    // check fails; every other rule below (email_verified) still applies
    // to a test-mode account exactly as it does to a normal one.
    async signIn({ user, profile }) {
      if (!isAllowedEmail(user.email)) {
        let testModeEnabled = false;
        try {
          testModeEnabled = await isGoogleTestModeEnabled();
        } catch (error) {
          console.error("Failed to read googleTestModeEnabled -- failing closed (mju.ac.kr only):", error);
        }
        if (!testModeEnabled) return false;
      }
      // Google always verifies email for its own accounts, but check the
      // claim explicitly rather than assume it.
      if (profile && profile.email_verified === false) return false;
      return true;
    },

    // Runs on every request, but the DB upsert only happens on the initial
    // sign-in exchange (`account` is only present then). get-or-create by
    // email (already @unique on User) is what actually prevents duplicate
    // Users for the same Google account; googleId is recorded alongside it
    // as the more stable identifier for future lookups.
    async jwt({ token, account, user }) {
      if (account && user?.email) {
        const dbUser = await resolveOrCreateUser({
          email: user.email,
          name: user.name ?? null,
          googleId: account.providerAccountId,
        });
        token.userId = dbUser.id;
        token.nickname = dbUser.nickname;
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = String(token.userId);
        session.user.nickname = token.nickname ?? null;
      }
      return session;
    },
  },
});
