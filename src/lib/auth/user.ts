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

// Phase 8: the only place privacyConsentAt is ever written -- called
// solely from POST /api/me/privacy-consent, i.e. only when the user
// themselves clicked the consent button (never from the OAuth/login flow
// above, see that column's own schema.prisma comment). `new Date()` is
// this server's own clock, never a client-supplied value, matching this
// phase's own "클라이언트가 전달한 timestamp를 신뢰하지 않는다" requirement.
//
// The `privacyConsentAt: null` guard in the where-clause makes this
// idempotent without clobbering an already-recorded consent instant: a
// second call (double-submit, or hitting the API directly after already
// consenting) matches zero rows and changes nothing, so the *original*
// consent timestamp is what's preserved -- mirrors
// onboarding/actions.ts's identical "only if still unset" pattern for
// nickname.
export async function recordPrivacyConsent(userId: number) {
  await prisma.user.updateMany({
    where: { id: userId, privacyConsentAt: null },
    data: { privacyConsentAt: new Date() },
  });
  return prisma.user.findUniqueOrThrow({ where: { id: userId } });
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
