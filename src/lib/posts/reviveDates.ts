import type { PostDTO } from "./service";

// Phase 32: split out of searchApiClient.ts (which imports next/headers,
// a server-only module) so a Client Component can import this one pure
// function without pulling that server-only import into the client
// bundle. Behavior is unchanged from before the split -- raw JSON has no
// Date type, so createdAt/updatedAt/lostAt/foundAt come back as ISO
// strings and must be revived into real Date objects (PostCard's
// formatDate() requires an actual Date, not a string).
export function reviveDates(raw: Record<string, unknown>): PostDTO {
  const revived: Record<string, unknown> = {
    ...raw,
    createdAt: new Date(raw.createdAt as string),
    updatedAt: new Date(raw.updatedAt as string),
  };
  if (raw.type === "lost") revived.lostAt = new Date(raw.lostAt as string);
  else revived.foundAt = new Date(raw.foundAt as string);
  return revived as unknown as PostDTO;
}
