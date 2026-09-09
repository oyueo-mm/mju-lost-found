import type { PostDTO } from "./service";

// Phase 32: split out of searchApiClient.ts (which imports next/headers,
// a server-only module) so a Client Component can import this one pure
// function without pulling that server-only import into the client
// bundle. Behavior is unchanged from before the split -- raw JSON has no
// Date type, so createdAt/updatedAt/lostAt/foundAt come back as ISO
// strings and must be revived into real Date objects (PostCard's
// formatDate() requires an actual Date, not a string).
//
// Phase P-5: lostAt/foundAt can now be a genuine JSON `null` (시간 미상,
// see schema.prisma's own comment on LostPost.lostAt) -- `new Date(null)`
// would silently produce the Unix epoch (1970-01-01) instead, fabricating
// exactly the kind of fake timestamp this phase's spec explicitly
// forbids, so null is passed through unchanged rather than coerced.
function reviveDateOrNull(value: unknown): Date | null {
  return value === null ? null : new Date(value as string);
}

export function reviveDates(raw: Record<string, unknown>): PostDTO {
  const revived: Record<string, unknown> = {
    ...raw,
    createdAt: new Date(raw.createdAt as string),
    updatedAt: new Date(raw.updatedAt as string),
  };
  if (raw.type === "lost") revived.lostAt = reviveDateOrNull(raw.lostAt);
  else revived.foundAt = reviveDateOrNull(raw.foundAt);
  return revived as unknown as PostDTO;
}
