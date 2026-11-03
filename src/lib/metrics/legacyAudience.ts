import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { activityActor } from "./record";

// Event-time audience of a row: the stored snapshot, or -- for rows written
// before snapshots were stored (activity_audience IS NULL) -- the one shown by
// the recorded admin history (DB functions in migration
// 20261111000000_legacy_audience_evidence). What cannot be shown is
// 'unclassified': never counted as a member, never as management activity.

type Ident = string;
const col = (alias: string | undefined, name: string) => (alias ? `${alias}."${name}"` : `"${name}"`);

// Audience of an event row whose actor is `actorColumn` at `atColumn`.
export function audienceSql(actorColumn: Ident, alias?: string, atColumn: Ident = "created_at"): Prisma.Sql {
  return Prisma.raw(`COALESCE(${col(alias, "activity_audience")}, mju_legacy_audience(${col(alias, actorColumn)}, ${col(alias, atColumn)}))`);
}
// Role ('service' | 'officer' | 'member' | 'unclassified') of a management event row.
export function roleSql(actorColumn: Ident, alias?: string, atColumn: Ident = "created_at"): Prisma.Sql {
  return Prisma.raw(`COALESCE(${col(alias, "activity_role")}, mju_legacy_role(${col(alias, actorColumn)}, ${col(alias, atColumn)}))`);
}
// Audience of a sign-up (a "User" row).
export function signupAudienceSql(alias?: string): Prisma.Sql {
  return Prisma.raw(`COALESCE(${col(alias, "activity_audience")}, mju_legacy_signup_audience(${col(alias, "id")}))`);
}
// Event-row actor column per table (sign-ups handled by signupAudienceSql).
export const ACTOR_COLUMN: Record<string, Ident> = {
  LostPost: "user_id",
  FoundPost: "user_id",
  ChatRoom: "initiator_user_id",
  Message: "sender_user_id",
  PostStatusChange: "changed_by_user_id",
};
// Role of an event row of `table` (a sign-up is never management activity: accounts are created as members).
export function tableRoleSql(table: string, alias?: string): Prisma.Sql {
  if (table === "User") return Prisma.raw(`COALESCE(${col(alias, "activity_role")}, CASE mju_legacy_signup_audience(${col(alias, "id")}) WHEN 'member' THEN 'member' ELSE 'unclassified' END)`);
  return roleSql(ACTOR_COLUMN[table], alias);
}
export function tableAudienceSql(table: string, alias?: string): Prisma.Sql {
  return table === "User" ? signupAudienceSql(alias) : audienceSql(ACTOR_COLUMN[table], alias);
}

export type Mark = { day: string; actor: string };
export type MarkAudience = "member" | "internal" | "unclassified";
const asDay = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

// ActivityDay marks with their event-time audience. A mark written before the
// snapshot holds only an HMAC of the account id, so it is linked back to an
// account in memory (as the statistics always did) and classified for that
// KST day; a mark that matches no account is 'unclassified'.
export async function loadClassifiedMarks(where: { from: string; until: string } | { days: string[] }): Promise<(Mark & { audience: MarkAudience; role: string | null; organizationId: number | null })[]> {
  const cond = "days" in where
    ? Prisma.sql`"day" = ANY(${where.days}::date[])`
    : Prisma.sql`"day" >= ${where.from}::date AND "day" < ${where.until}::date`;
  const rows = await prisma.$queryRaw<{ day: Date | string; actor: string; audience: string | null; role: string | null; org: number | null }[]>`
    SELECT "day", "actor", "activity_audience" AS audience, "activity_role" AS role, "activity_organization_id" AS org FROM "ActivityDay" WHERE ${cond}`;
  const legacy = rows.filter((r) => r.audience === null);
  const resolved = new Map<string, MarkAudience>();
  if (legacy.length) {
    const users = await prisma.user.findMany({ select: { id: true } });
    const byActor = new Map(users.map((u) => [activityActor(u.id), u.id]));
    const pairs = legacy.map((r) => ({ key: `${r.actor}|${asDay(r.day)}`, id: byActor.get(r.actor), day: asDay(r.day) })).filter((p) => p.id !== undefined);
    if (pairs.length) {
      const out = await prisma.$queryRaw<{ i: number; a: string }[]>`
        SELECT x.i::int AS i, mju_legacy_day_audience(x.uid, x.d) AS a
        FROM unnest(${pairs.map((p) => p.id!)}::int[], ${pairs.map((p) => p.day)}::date[]) WITH ORDINALITY AS x(uid, d, i)`;
      for (const r of out) resolved.set(pairs[Number(r.i) - 1].key, (r.a as MarkAudience) ?? "unclassified");
    }
  }
  return rows.map((r) => {
    const day = asDay(r.day);
    const audience = (r.audience ?? resolved.get(`${r.actor}|${day}`) ?? "unclassified") as MarkAudience;
    const legacyRole = audience === "internal" ? "service" : audience === "member" ? "member" : null;
    return { day, actor: r.actor, audience, role: r.audience === null ? legacyRole : r.role, organizationId: r.org };
  });
}
