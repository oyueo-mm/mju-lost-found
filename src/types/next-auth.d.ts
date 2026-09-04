import type { DefaultSession } from "next-auth";

// Kept intentionally small: only what's needed to route a request without
// hitting Prisma (id, for getCurrentUser() to look up; nickname, only to
// decide the /onboarding redirect without a DB round trip). Anything
// security-sensitive (isAdmin, isSuspended) is deliberately NOT stored
// here -- it's re-read from the DB wherever it matters, the same
// never-trust-the-cookie rule the legacy app follows for admin/suspension
// checks (db.is_admin / db.is_user_suspended).
//
// Augmenting "next-auth"/"next-auth/jwt" directly doesn't merge -- both
// re-export Session/JWT via `export type { ... } from "@auth/core/..."`,
// and TypeScript only merges declarations against the module that
// originally declares the interface.
// `id` stays `string` here (not the Prisma User.id `number`) because the
// session callback's `session.user` type is intersected with next-auth's
// own `AdapterUser` (id: string) regardless of whether an Adapter is
// actually configured -- typing it `number` collides into `never`. The
// numeric id lives in the JWT (see below); getCurrentUser() converts back
// to number at the Prisma query boundary.
declare module "@auth/core/types" {
  interface Session {
    user: {
      id: string;
      nickname: string | null;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId?: number;
    nickname?: string | null;
  }
}
