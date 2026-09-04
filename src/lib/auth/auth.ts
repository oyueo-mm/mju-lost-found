import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isAllowedEmail } from "@/lib/auth/domain";
import { resolveOrCreateUser } from "@/lib/auth/user";

// No next-auth Adapter/database session store here -- see the User.googleId
// comment in schema.prisma. Sessions are JWT-based (a signed cookie), and
// the only DB write in this whole flow is the upsert in the jwt callback
// below.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
    async signIn({ user, profile }) {
      if (!isAllowedEmail(user.email)) return false;
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
