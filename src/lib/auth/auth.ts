import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { decideSignIn } from "@/lib/auth/access";
import { resolveSignIn } from "@/lib/auth/user";
import { fetchDepartmentHint, googleScopes, hintsFromProfile, isOrgScopeEnabled, isSchoolWorkspaceAccount } from "@/lib/identity/googleHints";
import { syncIdentityFromHints } from "@/lib/identity/service";

// No next-auth Adapter/database session store here -- see the User.googleId
// comment in schema.prisma. Sessions are JWT-based (a signed cookie), and
// the only DB write in this whole flow is the upsert in the jwt callback
// below.
export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // 실명·학과 자동 입력: "profile" is requested again (Phase 8 had
      // dropped it) so the 실명·학과 form can be pre-filled with the Google
      // account name -- a suggestion only (see identity/googleHints.ts):
      // it is kept in the encrypted session cookie, never written to the
      // DB until the member saves the form with its consent, and never
      // treated as a school-verified name. User.name is no longer filled
      // from Google at all (see the jwt callback). The department scope
      // (People API organizations) is added only when
      // GOOGLE_ORG_SCOPE_ENABLED=true. email/email_verified (the signIn
      // callback's @mju.ac.kr gate) and `sub` (googleId) come from
      // "openid email" as before.
      //
      // Login UX: prompt=select_account makes Google show its account
      // chooser every time. Without it, a browser with one signed-in Google
      // account (or one that already consented) is sent straight back as
      // that same account -- so after a non-allowed account is rejected
      // (signIn callback -> /login?error=AccessDenied), pressing the button
      // again silently picks it again and the user can never switch to
      // their @mju.ac.kr account. This only affects the chooser; who may
      // sign in is still decided solely by the signIn callback below.
      authorization: { params: { scope: googleScopes(), prompt: "select_account" } },
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
    // External access Phase: the whole accept/reject rule lives in
    // auth/access.ts::decideSignIn -- @mju.ac.kr, an admin-approved
    // external email, or (only while the admin test-mode setting is on)
    // any other Google account; a revoked approval is always refused.
    // Google always verifies email for its own accounts, but the claim is
    // still checked explicitly rather than assumed.
    async signIn({ user, profile }) {
      const emailVerified = profile ? profile.email_verified !== false : undefined;
      const decision = await decideSignIn(user.email, emailVerified);
      return decision.allowed;
    },

    // Runs on every request, but the DB upsert only happens on the initial
    // sign-in exchange (`account` is only present then). get-or-create by
    // email (already @unique on User) is what actually prevents duplicate
    // Users for the same Google account; googleId is recorded alongside it
    // as the more stable identifier for future lookups.
    async jwt({ token, account, user, profile, trigger, session }) {
      // 실명·학과 자동 입력: Auth.js copies the Google name and picture into
      // the token (and from there into /api/auth/session) by default --
      // neither is kept. The name survives only as a form hint, below.
      delete token.name;
      delete token.picture;
      // Once the member has saved the form, the hints are no longer needed.
      if (trigger === "update" && (session as { clearIdentityHints?: boolean } | undefined)?.clearIdentityHints) {
        delete token.identityHints;
      }
      if (account && user?.email) {
        const resolved = await resolveSignIn({
          email: user.email,
          // Never the Google name: User.name stays the e-mail local part
          // (see auth/user.ts), so nothing from "profile" reaches the DB
          // without the 실명·학과 consent.
          name: null,
          googleId: account.providerAccountId,
        });
        // 회원탈퇴: a held withdrawn identity gets no User -- only a marker
        // that sends them to /rejoin (see auth/user.ts::resolveSignIn).
        if (resolved.kind === "held") {
          delete token.userId;
          token.nickname = null;
          token.rejoinIdentityId = resolved.identityId;
        } else {
          delete token.rejoinIdentityId;
          token.userId = resolved.user.id;
          token.nickname = resolved.user.nickname;
        }
        if (resolved.kind === "held") {
          delete token.identityHints;
        } else {
          // The Google name (split when it is "이름/신분/소속"); a People API
          // department, when that scope is on, takes precedence over the
          // display-name affiliation.
          // "이름/신분/소속" is read only from a school Workspace account (hd).
          const fromName = hintsFromProfile(profile, { allowStructured: isSchoolWorkspaceAccount(profile, user.email) });
          const peopleDepartment =
            isOrgScopeEnabled() && account.access_token ? await fetchDepartmentHint(account.access_token) : null;
          token.identityHints = peopleDepartment
            ? { ...fromName, department: peopleDepartment, departmentSource: "google_people" }
            : fromName;
          // 실명·소속 자동 수집: with the member's consent on file, store or
          // refresh the values from this sign-in's Google name. A failure
          // never blocks sign-in, and logs no values.
          // Once stored, the hints leave the session (as the 개인정보처리방침
          // says); they stay only while nothing could be stored.
          try {
            if ((await syncIdentityFromHints(resolved.user, token.identityHints)) !== "skipped") delete token.identityHints;
          } catch (error) {
            console.error("Identity sync at sign-in failed:", error instanceof Error ? error.name : "unknown");
          }
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = String(token.userId);
        session.user.nickname = token.nickname ?? null;
        // The member's own 실명·학과 suggestions, read by /me/identity.
        if (token.identityHints) session.identityHints = token.identityHints;
      }
      session.user.name = null;
      session.user.image = null;
      if (token.rejoinIdentityId) session.rejoinIdentityId = token.rejoinIdentityId;
      return session;
    },
  },
});
