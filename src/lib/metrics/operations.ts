import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ReportRange } from "./report";
import { roleSql, tableRoleSql } from "./legacyAudience";

export const AUDIENCE_NOTICE = "일반 통계는 활동 당시 일반 회원이던 기록을 집계합니다. 역할 기록 도입(2026-11-03) 전의 가입·게시글·완료·대화·활성 기록은 관리자 지정·해제 이력으로 당시 역할을 확인해 포함하고, 확인할 수 없는 기록만 분류 불명으로 제외합니다. 그 전의 방문·검색 집계는 수집 당시 회원·익명·관리자로 나뉘어 저장된 값을 그대로 씁니다. 익명 방문은 신원 미확인 트래픽으로 별도 표시하며, 나중의 역할 변경으로 과거 기록을 재분류하지 않습니다. 서버 요청량과 플랫폼 사용량은 전체 요청 기준입니다.";

export type AdminActorFilter = { role?: string; organizationId?: number; campus?: string; actor?: number };
export async function loadAdminOperations(range: ReportRange, viewer: number, all: boolean, filter: AdminActorFilter = {}) {
  const from = `${range.from}T00:00:00+09:00`, until = `${range.until}T00:00:00+09:00`;
  const at = (column: string) => Prisma.raw(`("${column}" AT TIME ZONE 'UTC')`);
  const [daily, legacyDaily, events, creation, since] = await Promise.all([
    // Traffic uses the actor's institution; item work uses the institution
    // handling the item, including work performed by a service administrator.
    prisma.$queryRaw<{ metric: string; n: bigint }[]>`SELECT metric, sum(value) AS n FROM "OperationalMetricDaily" WHERE day >= ${range.from}::date AND day < ${range.until}::date AND metric LIKE 'role.%' GROUP BY metric`,
    // Before audience_v3 the server kept full administrators' traffic apart as
    // *.internal counters (the only management role there was then).
    prisma.$queryRaw<{ metric: string; n: bigint }[]>`SELECT metric, sum(value) AS n FROM "MetricDaily"
      WHERE day >= ${range.from}::date AND day < ${range.until}::date
        AND day <= (SELECT min(m.day) FROM "MetricDaily" m WHERE m.metric = 'meta.since.audience_snapshot')
        AND (metric LIKE 'visit.internal.%' OR metric LIKE 'search.%.internal' OR metric LIKE 'recommend.%.internal')
      GROUP BY metric`,
    prisma.$queryRaw<{ actor: number; nickname: string | null; institution: string | null; action: string | null; n: bigint }[]>`
      SELECT h.changed_by_user_id AS actor, u.nickname, h.institution, h.action, count(*) AS n
      FROM "PostStatusChange" h LEFT JOIN "User" u ON u.id = h.changed_by_user_id
      WHERE (h.created_at AT TIME ZONE 'UTC') >= ${from}::timestamptz AND (h.created_at AT TIME ZONE 'UTC') < ${until}::timestamptz
        AND (${all} OR h.changed_by_user_id = ${viewer})
        AND ${roleSql("changed_by_user_id", "h")} IN ('service','officer')
        ${filter.role ? Prisma.sql`AND ${roleSql("changed_by_user_id", "h")} = ${filter.role}` : Prisma.empty}
        ${filter.organizationId ? Prisma.sql`AND COALESCE(h.organization_id, h.activity_organization_id) = ${filter.organizationId}` : Prisma.empty}
        ${filter.actor ? Prisma.sql`AND h.changed_by_user_id = ${filter.actor}` : Prisma.empty}
        ${filter.campus ? Prisma.sql`AND COALESCE(h.organization_id, h.activity_organization_id) IN (SELECT id FROM "Organization" WHERE management_campus = ${filter.campus})` : Prisma.empty}
      GROUP BY 1,2,3,4`,
    Promise.all([{ kind: "lost", table: "LostPost", actor: "user_id" }, { kind: "found", table: "FoundPost", actor: "user_id" }, { kind: "signups", table: "User", actor: "id" }, { kind: "messages", table: "Message", actor: "sender_user_id" }].map(async (s) => {
      const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM ${Prisma.raw(`"${s.table}"`)} WHERE ${tableRoleSql(s.table)} IN ('service','officer') AND ${at("created_at")} >= ${from}::timestamptz AND ${at("created_at")} < ${until}::timestamptz
        ${filter.role ? Prisma.sql`AND ${tableRoleSql(s.table)} = ${filter.role}` : Prisma.empty}
        ${filter.organizationId ? Prisma.sql`AND activity_organization_id = ${filter.organizationId}` : Prisma.empty}
        ${filter.actor ? Prisma.sql`AND ${Prisma.raw(`"${s.actor}"`)} = ${filter.actor}` : Prisma.empty}
        ${filter.campus ? Prisma.sql`AND activity_organization_id IN (SELECT id FROM "Organization" WHERE management_campus = ${filter.campus})` : Prisma.empty}`;
      return { kind: s.kind, n: Number(rows[0]?.n ?? 0) };
    })),
    prisma.$queryRaw<{ day: Date }[]>`SELECT min(day) AS day FROM "OperationalMetricDaily" WHERE metric = 'meta.since.institution_roles'`,
  ]);
  const orgs = filter.campus ? await prisma.organization.findMany({ where: { managementCampus: filter.campus }, select: { id: true } }) : null;
  const normalized = daily.flatMap((r) => {
    const m = /^role\.(service|officer)\.org\.(\d+)\.(.+)$/.exec(r.metric);
    if (!m || filter.role && filter.role !== m[1] || filter.organizationId && filter.organizationId !== Number(m[2]) || orgs && !orgs.some((o) => o.id === Number(m[2]))) return [];
    return [{ metric: m[3], n: Number(r.n) }];
  });
  if ((!filter.role || filter.role === "service") && !filter.organizationId && !orgs) normalized.push(...legacyDaily.map((r) => ({ metric: r.metric, n: Number(r.n) })));
  return { daily: filter.actor ? [] : normalized, individualTrafficUnavailable: Boolean(filter.actor), events: events.map((r) => ({ ...r, n: Number(r.n) })), creation, since: since[0]?.day?.toISOString().slice(0, 10) ?? null };
}
