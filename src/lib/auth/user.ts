import { prisma } from "@/lib/db/prisma";

// Get-or-create by email (already @unique on User), matching the legacy
// ui/auth.py::resolve_user_id() pattern -- this, not googleId, is what
// actually prevents a duplicate User for the same Google account. googleId
// is recorded/refreshed alongside it as the more stable identifier (see
// the User.googleId comment in schema.prisma).
//
// Phase 비활성화: this upsert only ever runs from the jwt callback's
// `account`-present branch -- i.e. a real Google sign-in exchange, never
// a plain JWT-cookie refresh on a later request -- so `now()` here is a
// true "last login" timestamp, not merely "session still valid" (see
// User.lastLoginAt's own schema comment).
//
// A plain prisma.user.upsert() can't express "and also clear deletedAt,
// but only if it was set" in one call -- upsert's `update` data is static,
// not conditional on the row it matched. So this reads the row first: if
// it already exists (matched by email, which deactivateUser() below never
// changes) and is currently deactivated, this is exactly the "same Google
// account signs in again" reactivation this phase's own spec asks for --
// deletedAt is cleared, and nothing else about the row (nickname,
// privacyConsentAt, posts/comments/chat history) is touched, so a
// reactivated user keeps everything and is never re-prompted for
// onboarding/consent. A never-deactivated existing row just refreshes
// googleId/name/lastLoginAt exactly as before. No row is ever created for
// an email that already exists -- only a genuinely new email creates a
// new User.
export async function resolveOrCreateUser(params: {
  email: string;
  name: string | null;
  googleId: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        googleId: params.googleId,
        name: params.name ?? undefined,
        lastLoginAt: new Date(),
        ...(existing.deletedAt !== null ? { deletedAt: null } : {}),
      },
    });
  }
  return prisma.user.create({
    data: {
      email: params.email,
      name: params.name ?? params.email.split("@")[0],
      googleId: params.googleId,
      lastLoginAt: new Date(),
    },
  });
}

// 이용약관 동의 Phase: replaces the old standalone recordPrivacyConsent()
// -- the two consents are legally/logically separate (see schema.prisma's
// own comments on privacyConsentAt/termsAcceptedAt), but the UI now asks
// for both from *one* screen with *one* "동의하고 계속하기" button (see
// (auth)/privacy-consent), and that button must never leave the account
// in a state where one consent recorded and the other didn't because two
// separate requests raced or the second one failed after the first
// succeeded. Both writes happen inside a single $transaction: if anything
// after the first updateMany throws, Postgres rolls the whole thing back,
// so a caller only ever gets a row committed with both writes applied, or
// neither. Called solely from POST /api/me/consent, i.e. only when the
// user themselves clicked the button -- never from the OAuth/login flow
// (resolveOrCreateUser above never touches either column). `new Date()`
// is this server's own clock, never a client-supplied value, matching
// this phase's own "클라이언트가 전달한 timestamp를 신뢰하지 않는다"
// requirement (same rule the original recordPrivacyConsent already
// followed).
//
// Each write keeps recordPrivacyConsent's own idempotent "only if not
// already satisfied" guard:
// - privacyConsentAt: only set while still NULL -- a user who already
//   consented never has this instant overwritten, matching this phase's
//   own "이미 privacyConsentAt이 존재하면 그것을 덮어쓰지 말 것"
//   requirement.
// - termsAcceptedAt/termsVersion: only set while termsAcceptedAt is NULL
//   *or* the stored termsVersion differs from the version being agreed to
//   now -- a user who already agreed to the exact current version has
//   this left completely untouched (no wasted write, no timestamp churn),
//   while a user on an older version (or never-agreed) gets both fields
//   stamped together.
export type RequiredConsentUser = Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>;

export async function recordRequiredConsents(userId: number, termsVersion: string): Promise<RequiredConsentUser> {
  return prisma.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { id: userId, privacyConsentAt: null },
      data: { privacyConsentAt: new Date() },
    });
    await tx.user.updateMany({
      where: { id: userId, OR: [{ termsAcceptedAt: null }, { termsVersion: { not: termsVersion } }] },
      data: { termsAcceptedAt: new Date(), termsVersion },
    });
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });
}

// Phase 비활성화: "회원 탈퇴" -> "회원 비활성화" -- deliberately NOT
// prisma.user.delete(), and (as of this phase) no longer anonymizes the
// row either. Almost every FK from another table to User is onDelete:
// Restrict (see schema.prisma: LostPost/FoundPost.user, Comment.author,
// Message.sender, Report.reporter/processedBy, ModerationAction.adminUser,
// SuspensionAppeal.user/reviewedBy, ...) specifically so a real User row
// can never be hard-deleted out from under content other people still
// see (another user's chat thread, a report history, a moderation
// record) -- a hard delete would either throw on the very first FK it
// hits, or (if those constraints were loosened) silently cascade real
// data away from other users.
//
// Only `deletedAt` is set. email/googleId/name/nickname are left exactly
// as they were: session.ts's getCurrentUser() still treats any user with
// deletedAt set as logged-out (so ordinary browsing/login with a still-
// valid session cookie is blocked while deactivated), but the row itself,
// and everything it owns (posts/comments/messages/nickname), stays fully
// intact -- this phase's own spec explicitly requires the account to be
// reversible, not anonymized. Reactivation is resolveOrCreateUser()'s own
// job (see that function's comment): the same Google account signing in
// again matches this same row by its still-real email and clears
// deletedAt, with no new row and no data copy.
//
// Idempotent via the same "only if still unset" updateMany guard
// recordPrivacyConsent() above uses -- a second call (double-submit, or
// hitting the API directly again) matches zero rows and leaves the
// already-deactivated row untouched.
//
// Phase 12-2: also blocks deactivation outright if this user is the sole
// LEADER of any still-ACTIVE Organization -- deactivating would otherwise
// leave the only person who can manage that organization (appoint another
// ADMIN, transfer leadership, deactivate it) unable to log in, leaving it
// permanently unmanageable. This mirrors organization/service.ts's own
// leaveOrganization() last-leader protection exactly, including the same
// `SELECT ... FOR UPDATE` row lock on this user's own LEADER rows first,
// so a concurrent leaveOrganization()/transferLeadership() call for the
// same organization can't race past this check (see leaveOrganization's
// own comment for why a plain count-then-act isn't race-safe under
// PostgreSQL's default READ COMMITTED).
export type WithdrawUserResult =
  | { kind: "ok"; data: Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>> }
  | { kind: "sole_leader_block"; organizationNames: string[] };

export async function withdrawUser(userId: number): Promise<WithdrawUserResult> {
  return prisma.$transaction(async (tx) => {
    const leaderMemberships = await tx.$queryRaw<{ organizationId: number }[]>`
      SELECT organization_id AS "organizationId"
      FROM "OrganizationMember"
      WHERE user_id = ${userId} AND role = 'leader'
      FOR UPDATE
    `;

    if (leaderMemberships.length > 0) {
      const soleLeaderOrgNames: string[] = [];
      for (const { organizationId } of leaderMemberships) {
        const organization = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, status: true },
        });
        if (!organization || organization.status !== "ACTIVE") continue; // 이미 비활성화된 단체는 계정 비활성화를 막지 않는다
        const leaderCount = await tx.organizationMember.count({
          where: { organizationId, role: "LEADER" },
        });
        if (leaderCount <= 1) soleLeaderOrgNames.push(organization.name);
      }
      if (soleLeaderOrgNames.length > 0) {
        return { kind: "sole_leader_block", organizationNames: soleLeaderOrgNames };
      }
    }

    const { count } = await tx.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        // Phase 12-2's existing rule -- a Platform Admin must be reinstated
        // by another admin after reactivating, never silently regained.
        isAdmin: false,
      },
    });
    if (count > 0) {
      // Notifications are private to this user alone -- nobody else's
      // data references them, unlike everything else this function
      // deliberately leaves in place (posts/comments/chat/nickname
      // untouched).
      await tx.notification.deleteMany({ where: { userId } });
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    return { kind: "ok", data: user };
  });
}
