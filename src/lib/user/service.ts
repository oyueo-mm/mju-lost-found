import { prisma } from "@/lib/db/prisma";

// Phase H-7: same 36-char canonical form (8-4-4-4-12 hex, dashes included)
// `crypto.randomUUID()`/`gen_random_uuid()` always produce -- used to
// reject an obviously-invalid /profile/[publicId] URL param before it ever
// reaches Postgres. Necessary because publicId is stored as a native
// `uuid` column (see schema.prisma): passing a non-UUID string straight
// into a Prisma `where: { publicId }` on that column raises a raw
// "invalid input syntax for type uuid" DB error instead of a clean
// not-found, so this is a pure input-shape guard, not a business rule.
// Exported (Phase L) so admin/users.ts can apply the exact same guard
// before searching User.publicId -- that column is the same native `uuid`
// type, so it needs the same "reject before it ever reaches Postgres"
// treatment, not a second copy of this pattern.
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicProfileDTO = {
  publicId: string;
  nickname: string | null;
  createdAt: Date;
  // Phase H-7: LostPost + FoundPost authored by this user, combined --
  // posts are hard-deleted in this app (no soft-delete/hidden flag on
  // either model, see schema.prisma), so a plain count of existing rows
  // *is* "공개 게시글 수" with no extra filtering needed.
  postCount: number;
  // Phase H-8: the internal numeric id -- deliberately NOT rendered
  // anywhere (the profile page/UI still only ever shows `publicId`, same
  // as H-7); included purely so the profile page's Server Component can
  // pass it straight into listPostsByUser() (which, like every other
  // posts/service.ts function, is keyed on the internal userId, per this
  // phase's own "기존 사용자 식별은 계속 내부 userId를 사용" instruction)
  // without a second publicId->id lookup. Never sent to a Client
  // Component or serialized into a client-visible response.
  userId: number;
};

// Public by design (see this phase's own spec: "다른 사용자의 프로필을 볼 수
// 있도록 한다") -- no auth/ownership check here, unlike almost every other
// service function in this app. Only ever returns the fields already
// treated as public elsewhere (nickname, publicId, createdAt) plus a
// derived count; never email/googleId/isAdmin/isSuspended/suspendedUntil.
export async function getPublicProfile(publicId: string): Promise<PublicProfileDTO | null> {
  if (!UUID_PATTERN.test(publicId)) return null;

  const user = await prisma.user.findUnique({
    where: { publicId },
    select: { id: true, publicId: true, nickname: true, createdAt: true },
  });
  if (!user) return null;

  const [lostCount, foundCount] = await Promise.all([
    prisma.lostPost.count({ where: { userId: user.id } }),
    prisma.foundPost.count({ where: { userId: user.id } }),
  ]);

  return {
    publicId: user.publicId,
    nickname: user.nickname,
    createdAt: user.createdAt,
    postCount: lostCount + foundCount,
    userId: user.id,
  };
}
