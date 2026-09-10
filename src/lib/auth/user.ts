import { prisma } from "@/lib/db/prisma";

// Get-or-create by email (already @unique on User), matching the legacy
// ui/auth.py::resolve_user_id() pattern -- this, not googleId, is what
// actually prevents a duplicate User for the same Google account. googleId
// is recorded/refreshed alongside it as the more stable identifier (see
// the User.googleId comment in schema.prisma).
export async function resolveOrCreateUser(params: {
  email: string;
  name: string | null;
  googleId: string;
}) {
  // Phase P-1: this upsert only ever runs from the jwt callback's
  // `account`-present branch -- i.e. a real Google sign-in exchange, never
  // a plain JWT-cookie refresh on a later request -- so `now()` here is a
  // true "last login" timestamp, not merely "session still valid" (see
  // User.lastLoginAt's own schema comment).
  return prisma.user.upsert({
    where: { email: params.email },
    update: {
      googleId: params.googleId,
      name: params.name ?? undefined,
      lastLoginAt: new Date(),
    },
    create: {
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

// Phase 10: account withdrawal -- deliberately NOT prisma.user.delete().
// Almost every FK from another table to User is onDelete: Restrict (see
// schema.prisma: LostPost/FoundPost.user, Comment.author, Message.sender,
// Report.reporter/processedBy, ModerationAction.adminUser,
// SuspensionAppeal.user/reviewedBy, ...) specifically so a real User row
// can never be hard-deleted out from under content other people still
// see (another user's chat thread, a report history, a moderation
// record) -- a hard delete would either throw on the very first FK it
// hits, or (if those constraints were loosened) silently cascade real
// data away from other users, which this phase's own spec explicitly
// forbids. Instead this anonymizes the row in place: the account becomes
// permanently unusable (see session.ts's getCurrentUser, which now treats
// any user with deletedAt set as logged-out) and personally-identifying
// fields are scrubbed, while every row that references this user's id
// (their own posts/comments/messages, and anyone else's reports/
// moderation actions naming them) keeps working exactly as before --
// those rows just render this user's new anonymized name/nickname, the
// same "author no longer available" treatment AuthorLink already gives a
// null nickname elsewhere, just spelled out explicitly here instead.
//
// email/googleId are freed (not merely blanked) so the same real person
// signing in again later with the same Google account is treated as a
// brand-new user by resolveOrCreateUser()'s own email-based upsert above
// -- a fresh row, fresh onboarding, fresh consent, no link back to the
// withdrawn account's history.
//
// Idempotent via the same "only if still unset" updateMany guard
// recordPrivacyConsent() above uses -- a second call (double-submit, or
// hitting the API directly again) matches zero rows and leaves the
// already-withdrawn row untouched.
//
// Phase 12-2: now also blocks withdrawal outright if this user is the
// sole LEADER of any still-ACTIVE Organization -- withdrawing would
// otherwise anonymize the only person who can manage that organization
// (appoint another ADMIN, transfer leadership, deactivate it), leaving it
// permanently unmanageable. This mirrors organization/service.ts's own
// leaveOrganization() last-leader protection exactly, including the same
// `SELECT ... FOR UPDATE` row lock on this user's own LEADER rows first,
// so a concurrent leaveOrganization()/transferLeadership() call for the
// same organization can't race past this check (see leaveOrganization's
// own comment for why a plain count-then-act isn't race-safe under
// PostgreSQL's default READ COMMITTED). The existing anonymization policy
// itself is unchanged -- this only adds an earlier, typed short-circuit
// before any of it runs.
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
        if (!organization || organization.status !== "ACTIVE") continue; // 이미 비활성화된 단체는 탈퇴를 막지 않는다
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
        email: `deleted-user-${userId}@withdrawn.invalid`,
        name: "탈퇴한 사용자",
        nickname: "탈퇴한 사용자",
        googleId: null,
        isAdmin: false,
      },
    });
    if (count > 0) {
      // Notifications are private to this user alone -- nobody else's
      // data references them, unlike everything else this function
      // deliberately leaves in place. No policy change to
      // posts/comments/chat: those are untouched.
      await tx.notification.deleteMany({ where: { userId } });
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    return { kind: "ok", data: user };
  });
}
