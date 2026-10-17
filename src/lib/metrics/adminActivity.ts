import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  ADMIN_ACTIVITY_ACTIONS,
  ADMIN_ACTIVITY_FAILED_METRIC,
  ADMIN_SIGN_IN_ACTION,
  ADMIN_TASK_CATEGORIES,
  ADMIN_VISIT_FAILED_METRIC,
  type AdminTaskCategory,
} from "@/lib/admin/activityLog";
import { recordingSince } from "./activityTime";
import { addPeriods } from "./dashboard";
import { activityActor, kstDay, TRAFFIC_HOURLY_SINCE_METRIC } from "./record";
import { activityRetainedFrom, COLLECTION_SINCE, type Coverage } from "./report";

// 관리자 활동 tab of /admin/stats. Read-only, except the one marker row
// below. Everything comes from records the app already keeps:
// - 최근 로그인 / 최근 활동 감지: User.lastLoginAt / User.lastActiveAt.
// - 활동일: ActivityDay (the admin's HMAC mark per KST day of signed-in use;
//   the same mark 활성 회원 counts). Days before its collection began, or
//   past its retention, are 미측정.
// - 관리 작업: every table that already stores an admin and a time (below),
//   plus AdminActivityLog for the tasks that stored neither. Tasks of
//   those kinds before the log began were never recorded: the categories
//   they belong to are marked 일부 미측정 for any span before that.
// - 방문 / 로그인: AdminVisit (a visit = signed-in use without a 30-minute
//   gap, admin/activityLog.ts recordAdminVisit) and the admin's sign-ins in
//   AdminActivityLog (never counted as tasks). Days before they began to be
//   recorded are 미측정.

export const ADMIN_ACTIVITY_SINCE_METRIC = "meta.since.admin_activity";
// when visits and sign-ins began to be recorded here (same marker scheme)
export const ADMIN_PRESENCE_SINCE_METRIC = "meta.since.admin_presence";
export const STRIP_DAYS = 30;
export const TIMELINE_LIMIT = 200;
// tasks read for one timeline (a safety cap; the page says when it is hit)
const TIMELINE_TASK_CAP = 2000;

// One row per completed task: admin, UTC wall time, kind, target. `kind`
// is mapped to a category and label by describeKind() below.
const EVENTS = Prisma.sql`
  SELECT "processed_by_user_id" AS admin_id, "processed_at" AS at, 'report.' || "status"::text AS kind, 'report' AS target_type, "id" AS target_id
    FROM "Report" WHERE "processed_by_user_id" IS NOT NULL AND "processed_at" IS NOT NULL AND "status"::text <> 'pending'
  UNION ALL
  SELECT "admin_user_id", "created_at", 'moderation.' || "action_type"::text, "target_type"::text, "target_id" FROM "ModerationAction"
  UNION ALL
  SELECT l."actor_user_id", l."created_at", 'proposal.' || l."event"::text || '.' || p."action_type"::text, 'user', p."target_user_id"
    FROM "AdminActionAuditLog" l JOIN "AdminActionProposal" p ON p."id" = l."proposal_id"
    WHERE l."actor_user_id" IS NOT NULL AND l."event"::text IN ('created', 'approved', 'cancelled')
  UNION ALL
  SELECT "reviewed_by_user_id", "reviewed_at", 'appeal.reviewed', 'appeal', "id"
    FROM "SuspensionAppeal" WHERE "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
  UNION ALL
  SELECT "reviewed_by_user_id", "reviewed_at", 'rejoin.' || "status"::text, 'rejoin_request', "id"
    FROM "RejoinRequest" WHERE "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
  UNION ALL
  SELECT "reviewed_by_user_id", "reviewed_at", 'org_request.' || "status"::text, 'organization_request', "id"
    FROM "OrganizationCreationRequest" WHERE "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
  UNION ALL
  SELECT "created_by_user_id", "created_at", 'external.created', 'external_access', "id" FROM "ExternalAccessGrant"
  UNION ALL
  SELECT "revoked_by_user_id", "revoked_at", 'external.revoked', 'external_access', "id"
    FROM "ExternalAccessGrant" WHERE "revoked_by_user_id" IS NOT NULL AND "revoked_at" IS NOT NULL
  UNION ALL
  SELECT "created_by_user_id", "created_at", 'announcement.created', 'announcement', "id" FROM "Announcement" WHERE "created_by_user_id" IS NOT NULL
  UNION ALL
  SELECT "admin_user_id", "accessed_at", 'access.chat', 'report', "report_id" FROM "AdminAccessLog"
  UNION ALL
  SELECT "admin_user_id", "accessed_at", 'access.identity', 'report', "report_id" FROM "IdentityAccessLog"
  UNION ALL
  SELECT "admin_user_id", "created_at", 'log.' || "action", "target_type", "target_id" FROM "AdminActivityLog" WHERE "action" <> ${ADMIN_SIGN_IN_ACTION}`;

const MODERATION_LABELS: Record<string, string> = {
  delete_post: "게시글 삭제",
  delete_comment: "댓글 삭제",
  hide_message: "메시지 숨김",
  temp_hide_post: "게시글 임시 숨김",
  temp_hide_comment: "댓글 임시 숨김",
  restore_post: "게시글 임시 숨김 해제",
  restore_comment: "댓글 임시 숨김 해제",
  suspend_user: "이용 제한",
};
const PROPOSAL_TYPES: Record<string, { label: string; category: AdminTaskCategory }> = {
  grant_admin: { label: "관리자 지정", category: "role" },
  revoke_admin: { label: "관리자 해제", category: "role" },
  suspend_user: { label: "관리자 계정 이용 제한", category: "sanction" },
  unsuspend_user: { label: "관리자 계정 이용 제한 해제", category: "sanction" },
};
const PROPOSAL_EVENTS: Record<string, string> = { created: "요청", approved: "승인", cancelled: "요청 취소" };
const FIXED_KINDS: Record<string, { label: string; category: AdminTaskCategory }> = {
  "report.actioned": { label: "신고 처리 (조치)", category: "report" },
  "report.dismissed": { label: "신고 처리 (기각)", category: "report" },
  "appeal.reviewed": { label: "이의신청 확인", category: "sanction" },
  "rejoin.approved": { label: "재가입 요청 승인", category: "review" },
  "rejoin.rejected": { label: "재가입 요청 거절", category: "review" },
  "org_request.approved": { label: "단체 개설 승인", category: "review" },
  "org_request.rejected": { label: "단체 개설 거절", category: "review" },
  "external.created": { label: "외부 이용 승인", category: "operations" },
  "external.revoked": { label: "외부 이용 승인 취소", category: "operations" },
  "announcement.created": { label: "공지 등록", category: "operations" },
  "access.chat": { label: "신고 대화 열람", category: "access" },
  "access.identity": { label: "실명·소속 열람", category: "access" },
};

export function describeKind(kind: string): { label: string; category: AdminTaskCategory } | null {
  if (Object.hasOwn(FIXED_KINDS, kind)) return FIXED_KINDS[kind];
  const [source, a, b] = kind.split(".");
  if (source === "moderation" && Object.hasOwn(MODERATION_LABELS, a)) {
    return { label: MODERATION_LABELS[a], category: a === "suspend_user" ? "sanction" : "content" };
  }
  if (source === "proposal" && Object.hasOwn(PROPOSAL_EVENTS, a) && Object.hasOwn(PROPOSAL_TYPES, b)) {
    return { label: `${PROPOSAL_TYPES[b].label} ${PROPOSAL_EVENTS[a]}`, category: PROPOSAL_TYPES[b].category };
  }
  const action = kind.slice(4);
  if (source === "log" && Object.hasOwn(ADMIN_ACTIVITY_ACTIONS, action)) {
    const { label, category } = ADMIN_ACTIVITY_ACTIONS[action as keyof typeof ADMIN_ACTIVITY_ACTIONS];
    return { label, category };
  }
  return null;
}

// What the task was done to, by id only (no titles, names or content).
export function describeTarget(type: string | null, id: number | null): string | null {
  if (type === null || id === null) return null;
  switch (type) {
    case "post":
      return id > 0 ? `분실물 게시글 #${id}` : `습득물 게시글 #${-id}`;
    case "lost_post":
      return `분실물 게시글 #${id}`;
    case "found_post":
      return `습득물 게시글 #${id}`;
    case "comment":
      return `댓글 #${id}`;
    case "message":
      return `메시지 #${id}`;
    case "user":
      return `회원 #${id}`;
    case "report":
      return `신고 #${id}`;
    case "appeal":
      return `이의신청 #${id}`;
    case "rejoin_request":
      return `재가입 요청 #${id}`;
    case "organization_request":
      return `단체 개설 요청 #${id}`;
    case "organization":
      return `단체 #${id}`;
    case "external_access":
      return `외부 이용 승인 #${id}`;
    case "announcement":
      return `공지 #${id}`;
    case "feedback":
      return `문의 #${id}`;
    default:
      return null;
  }
}

const utcParam = (at: Date) => Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
// UTC wall time out as ISO text, so the driver's local-time handling never applies
const isoText = (column: Prisma.Sql) => Prisma.sql`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

type Scope = { adminId: number | null };
const scopeFilter = ({ adminId }: Scope) => (adminId === null ? Prisma.empty : Prisma.sql`AND e.admin_id = ${adminId}`);

export type CategoryCounts = Record<AdminTaskCategory, number>;
const zeroCounts = (): CategoryCounts => ({ report: 0, content: 0, sanction: 0, role: 0, review: 0, operations: 0, access: 0 });

export type AdminActivityRow = {
  id: number;
  nickname: string;
  isAdmin: boolean;
  lastLoginAt: Date | null;
  lastActiveAt: Date | null;
  lastTaskAt: Date | null;
  // 활동일 among the measured days of the last 7 / 30 (null: none measured)
  activeDays7: number | null;
  activeDays30: number | null;
  // one entry per day of `days`: active, or not, or 미측정
  strip: ("active" | "inactive" | "none")[];
  tasks30: CategoryCounts;
  tasksAll: CategoryCounts;
  // 관리 작업 per day of `days`, all categories (see taskCoverage)
  tasksByDay: number[];
  // 방문 / 로그인 per day of `days` (null: not recorded yet that day)
  visits: (number | null)[];
  signIns: (number | null)[];
  // totals over the measured days of the last 7 / 30 (null: none measured)
  visits7: number | null;
  visits30: number | null;
  signIns7: number | null;
  signIns30: number | null;
  // the latest recorded visit: when it began, its last recorded activity
  lastVisit: { start: Date; last: Date } | null;
};

export type TimelineKind = "login" | "visit" | AdminTaskCategory;
export const TIMELINE_KINDS: { key: TimelineKind; label: string }[] = [
  { key: "login", label: "로그인" },
  { key: "visit", label: "방문" },
  ...ADMIN_TASK_CATEGORIES,
];
export const isTimelineKind = (v: unknown): v is TimelineKind => TIMELINE_KINDS.some((k) => k.key === v);

export type TimelineItem = {
  at: Date;
  adminId: number;
  nickname: string;
  kind: TimelineKind;
  label: string;
  target: string | null;
  // a visit's last recorded activity
  until?: Date;
};

// period: the last 7 or 30 KST days (the timeline's span when no day is chosen)
export type ActivityPeriod = 7 | 30;
export type TimelineFilter = { admin: number | null; day: string | null; kind: TimelineKind | null; period?: ActivityPeriod };

export type AdminActivityReport = {
  today: string;
  days: string[];
  // per day of `days`: whether 활동일 was recorded that day
  dayStatus: Coverage[];
  measuredDays7: number;
  measuredDays30: number;
  // per day of `days`: tasks by category, and whether every kind was recorded
  dailyTasks: CategoryCounts[];
  taskCoverage: Coverage[];
  // current admins with an 활동일 mark that day (null: 미측정)
  dailyActiveAdmins: (number | null)[];
  // per day of `days`: visits / sign-ins (null: 미측정), and their coverage
  dailyVisits: (number | null)[];
  dailySignIns: (number | null)[];
  presenceStatus: Coverage[];
  presenceDays7: number;
  presenceDays30: number;
  admins: AdminActivityRow[];
  // every recorded visit start / sign-in of the last 30 days in scope, for
  // the hour and weekday views (a visit counts once, at its start)
  visitEvents: { adminId: number; at: Date }[];
  signInEvents: { adminId: number; at: Date }[];
  timeline: TimelineItem[];
  // items matching the filter before TIMELINE_LIMIT; tasks hit their cap
  timelineMatched: number;
  timelineCapped: boolean;
  filter: TimelineFilter;
  // KST "YYYY-MM-DD HH:mm" the AdminActivityLog / visits / lastActiveAt began here
  logSince: string | null;
  presenceSince: string | null;
  // completed tasks / visits or sign-ins whose write failed (all admins), per day
  recordFailures: number[];
  visitFailures: number[];
  lastActiveSince: string | null;
};

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
const kstMidnight = (day: string) => new Date(dayDate(day).getTime() - 9 * 3_600_000);

// KST minute this environment first served the 관리자 활동 tab, which runs
// only where the record is written: the record's start if nothing was
// recorded before it. Written once (best-effort; a lost write only means a
// later start).
async function startMarker(metric: string, now: Date): Promise<{ day: Date; value: number } | null> {
  try {
    const found = await prisma.metricDaily.findFirst({ where: { metric }, orderBy: { day: "asc" }, select: { day: true, value: true } });
    if (found) return found;
    const kst = new Date(now.getTime() + 9 * 3_600_000);
    const row = { day: dayDate(kstDay(now)), metric, value: kst.getUTCHours() * 60 + kst.getUTCMinutes() };
    await prisma.metricDaily.createMany({ data: [row], skipDuplicates: true });
    return row;
  } catch {
    return null;
  }
}

const perDay = (days: string[], rows: { day: Date; value: number }[]) =>
  days.map((d) => rows.filter((f) => f.day.toISOString().slice(0, 10) === d).reduce((a, f) => a + f.value, 0));

const VISITS = Prisma.sql`SELECT "admin_user_id" AS admin_id, "started_at" AS at, "last_active_at" AS last FROM "AdminVisit"`;
const SIGN_INS = Prisma.sql`SELECT "admin_user_id" AS admin_id, "created_at" AS at FROM "AdminActivityLog" WHERE "action" = ${ADMIN_SIGN_IN_ACTION}`;

// `all`: every admin's records (the viewer may see them); otherwise only
// the viewer's own. `filter` narrows the timeline (its admin only when `all`).
export async function loadAdminActivity({
  viewer,
  all,
  filter = { admin: null, day: null, kind: null, period: STRIP_DAYS },
  now = new Date(),
}: {
  viewer: number;
  all: boolean;
  filter?: TimelineFilter;
  now?: Date;
}): Promise<AdminActivityReport> {
  const today = kstDay(now);
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => addPeriods(today, "day", i - STRIP_DAYS + 1));
  const fromAt = kstMidnight(days[0]);
  const scope: Scope = { adminId: all ? null : viewer };
  const f: TimelineFilter = {
    admin: all ? filter.admin : null,
    day: filter.day && days.includes(filter.day) ? filter.day : null,
    kind: filter.kind,
    period: filter.period === 7 ? 7 : STRIP_DAYS,
  };
  const timelineScope: Scope = { adminId: all ? f.admin : viewer };
  const dayFrom = f.day ? kstMidnight(f.day) : kstMidnight(days[days.length - (f.period ?? STRIP_DAYS)]);
  const dayUntil = f.day ? kstMidnight(addPeriods(f.day, "day", 1)) : null;
  const untilFilter = dayUntil ? Prisma.sql`AND e.at < ${utcParam(dayUntil)}` : Prisma.empty;
  const wantTasks = f.kind === null || (f.kind !== "login" && f.kind !== "visit");

  const [daily, totals, recent, visitRows, signInRows, marker, presenceMarker, earliest, activeMarker, earliestActive, failures] = await Promise.all([
    prisma.$queryRaw<{ admin_id: number; kind: string; day: string; n: number }[]>`
      SELECT e.admin_id, e.kind, to_char(e.at + interval '9 hours', 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM (${EVENTS}) e WHERE e.at >= ${utcParam(fromAt)} ${scopeFilter(scope)} GROUP BY 1, 2, 3`,
    prisma.$queryRaw<{ admin_id: number; kind: string; n: number; last: string }[]>`
      SELECT e.admin_id, e.kind, count(*)::int AS n, ${isoText(Prisma.sql`max(e.at)`)} AS last
      FROM (${EVENTS}) e WHERE TRUE ${scopeFilter(scope)} GROUP BY 1, 2`,
    wantTasks
      ? prisma.$queryRaw<{ admin_id: number; at: string; kind: string; target_type: string | null; target_id: number | null }[]>`
          SELECT e.admin_id, ${isoText(Prisma.sql`e.at`)} AS at, e.kind, e.target_type, e.target_id
          FROM (${EVENTS}) e WHERE e.at >= ${utcParam(dayFrom)} ${untilFilter} ${scopeFilter(timelineScope)}
          ORDER BY e.at DESC LIMIT ${TIMELINE_TASK_CAP}`
      : Promise.resolve([]),
    prisma.$queryRaw<{ admin_id: number; at: string; last: string }[]>`
      SELECT e.admin_id, ${isoText(Prisma.sql`e.at`)} AS at, ${isoText(Prisma.sql`e.last`)} AS last
      FROM (${VISITS}) e WHERE e.at >= ${utcParam(fromAt)} ${scopeFilter(scope)}`,
    prisma.$queryRaw<{ admin_id: number; at: string }[]>`
      SELECT e.admin_id, ${isoText(Prisma.sql`e.at`)} AS at FROM (${SIGN_INS}) e WHERE e.at >= ${utcParam(fromAt)} ${scopeFilter(scope)}`,
    startMarker(ADMIN_ACTIVITY_SINCE_METRIC, now),
    startMarker(ADMIN_PRESENCE_SINCE_METRIC, now),
    prisma.$queryRaw<{ log: string | null; presence: string | null }[]>`
      SELECT ${isoText(Prisma.sql`(SELECT min("created_at") FROM "AdminActivityLog" WHERE "action" <> ${ADMIN_SIGN_IN_ACTION})`)} AS log,
             ${isoText(Prisma.sql`LEAST((SELECT min("started_at") FROM "AdminVisit"), (SELECT min("created_at") FROM "AdminActivityLog" WHERE "action" = ${ADMIN_SIGN_IN_ACTION}))`)} AS presence`,
    prisma.metricDaily
      .findFirst({ where: { metric: TRAFFIC_HOURLY_SINCE_METRIC }, orderBy: { day: "asc" }, select: { day: true, value: true } })
      .catch(() => null),
    prisma.user.aggregate({ _min: { lastActiveAt: true } }).catch(() => null),
    prisma.metricDaily
      .findMany({
        where: { metric: { in: [ADMIN_ACTIVITY_FAILED_METRIC, ADMIN_VISIT_FAILED_METRIC] }, day: { gte: dayDate(days[0]) } },
        select: { metric: true, day: true, value: true },
      })
      .catch(() => []),
  ]);

  // the admins shown: every current admin (or just the viewer), plus anyone
  // with an admin task on record who is no longer an admin
  const actorIds = [...new Set(totals.map((t) => t.admin_id))];
  const users = await prisma.user.findMany({
    where: all ? { OR: [{ isAdmin: true }, { id: { in: actorIds } }] } : { id: viewer },
    select: { id: true, nickname: true, isAdmin: true, lastLoginAt: true, lastActiveAt: true, withdrawnAt: true },
    orderBy: { id: "asc" },
  });

  // 활동일: which days were recorded at all (the first day only from the
  // minute collection began)
  const collectionDay = COLLECTION_SINCE.ops.slice(0, 10);
  const firstMeasured = [activityRetainedFrom(today), collectionDay].sort().at(-1)!;
  const dayStatus: Coverage[] = days.map((d) =>
    d < firstMeasured ? "none" : d === collectionDay && !COLLECTION_SINCE.ops.endsWith("T00:00") ? "partial" : "full",
  );
  // a withdrawn account's marks are never read
  const actors = new Map(users.filter((u) => !u.withdrawnAt).map((u) => [activityActor(u.id), u.id]));
  const marks = await prisma.activityDay.findMany({
    where: { actor: { in: [...actors.keys()] }, day: { gte: dayDate(days[0]), lte: dayDate(today) } },
    select: { day: true, actor: true },
  });
  const activeOn = new Map<number, Set<string>>();
  for (const m of marks) {
    const id = actors.get(m.actor)!;
    activeOn.set(id, (activeOn.get(id) ?? new Set<string>()).add(m.day.toISOString().slice(0, 10)));
  }

  const first = earliest[0];
  const logSince = recordingSince(marker, first?.log ? new Date(first.log) : null);
  const presenceSince = recordingSince(presenceMarker, first?.presence ? new Date(first.presence) : null);
  const recordFailures = perDay(days, failures.filter((x) => x.metric === ADMIN_ACTIVITY_FAILED_METRIC));
  const visitFailures = perDay(days, failures.filter((x) => x.metric === ADMIN_VISIT_FAILED_METRIC));
  // a day is fully covered only once the log had begun before it, and had
  // no failed write that day
  const taskCoverage: Coverage[] = days.map((d, i) => (logSince !== null && d > logSince.slice(0, 10) && recordFailures[i] === 0 ? "full" : "partial"));
  // 방문·로그인: nothing before the day recording began; that day partial
  const presenceStatus: Coverage[] = days.map((d, i) =>
    presenceSince === null || d < presenceSince.slice(0, 10) ? "none" : d === presenceSince.slice(0, 10) || visitFailures[i] > 0 ? "partial" : "full",
  );

  const dailyTasks = days.map(() => zeroCounts());
  const tasks30 = new Map<number, CategoryCounts>();
  const tasksPerDay = new Map<number, number[]>();
  for (const r of daily) {
    const kind = describeKind(r.kind);
    const i = days.indexOf(r.day);
    if (!kind || i < 0) continue;
    dailyTasks[i][kind.category] += r.n;
    const perDayOf = tasksPerDay.get(r.admin_id) ?? days.map(() => 0);
    perDayOf[i] += r.n;
    tasksPerDay.set(r.admin_id, perDayOf);
    const c = tasks30.get(r.admin_id) ?? zeroCounts();
    c[kind.category] += r.n;
    tasks30.set(r.admin_id, c);
  }
  const tasksAll = new Map<number, CategoryCounts>();
  const lastTask = new Map<number, Date>();
  for (const r of totals) {
    const kind = describeKind(r.kind);
    if (!kind) continue;
    const c = tasksAll.get(r.admin_id) ?? zeroCounts();
    c[kind.category] += r.n;
    tasksAll.set(r.admin_id, c);
    const at = new Date(r.last);
    const prev = lastTask.get(r.admin_id);
    if (!prev || at > prev) lastTask.set(r.admin_id, at);
  }

  // 방문 / 로그인 per admin and KST day (a visit counts on the day it began)
  const countPerDay = (rows: { admin_id: number; at: string }[], id: number | null) =>
    days.map((d, i) => (presenceStatus[i] === "none" ? null : rows.filter((r) => (id === null || r.admin_id === id) && kstDay(new Date(r.at)) === d).length));
  const sumLast = (values: (number | null)[], span: number) =>
    values.slice(-span).every((v) => v === null) ? null : values.slice(-span).reduce<number>((a, v) => a + (v ?? 0), 0);
  const lastVisitOf = new Map<number, { start: Date; last: Date }>();
  for (const v of visitRows) {
    const start = new Date(v.at);
    const prev = lastVisitOf.get(v.admin_id);
    if (!prev || start > prev.start) lastVisitOf.set(v.admin_id, { start, last: new Date(v.last) });
  }

  const measured = (statuses: Coverage[], span: number) => statuses.slice(-span).filter((s) => s !== "none").length;
  const measuredDays7 = measured(dayStatus, 7);
  const measuredDays30 = measured(dayStatus, STRIP_DAYS);
  const admins: AdminActivityRow[] = users.map((u) => {
    const active = (!u.withdrawnAt && activeOn.get(u.id)) || new Set<string>();
    const strip = days.map((d, i): AdminActivityRow["strip"][number] => (dayStatus[i] === "none" ? "none" : active.has(d) ? "active" : "inactive"));
    const count = (span: number, m: number) => (m === 0 ? null : strip.slice(-span).filter((s) => s === "active").length);
    const visits = countPerDay(visitRows, u.id);
    const signIns = countPerDay(signInRows, u.id);
    return {
      id: u.id,
      nickname: u.nickname ?? `회원 #${u.id}`,
      isAdmin: u.isAdmin,
      lastLoginAt: u.lastLoginAt,
      lastActiveAt: u.withdrawnAt ? null : u.lastActiveAt,
      lastTaskAt: lastTask.get(u.id) ?? null,
      activeDays7: count(7, measuredDays7),
      activeDays30: count(STRIP_DAYS, measuredDays30),
      strip,
      tasks30: tasks30.get(u.id) ?? zeroCounts(),
      tasksAll: tasksAll.get(u.id) ?? zeroCounts(),
      tasksByDay: tasksPerDay.get(u.id) ?? days.map(() => 0),
      visits,
      signIns,
      visits7: sumLast(visits, 7),
      visits30: sumLast(visits, STRIP_DAYS),
      signIns7: sumLast(signIns, 7),
      signIns30: sumLast(signIns, STRIP_DAYS),
      lastVisit: lastVisitOf.get(u.id) ?? null,
    };
  });
  // current admins first, then by most recent task
  admins.sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || (b.lastTaskAt?.getTime() ?? 0) - (a.lastTaskAt?.getTime() ?? 0) || a.id - b.id);

  // timeline: tasks, sign-ins and visits, newest first, narrowed by `f`
  const names = new Map(admins.map((a) => [a.id, a.nickname]));
  const nameOf = (id: number) => names.get(id) ?? `회원 #${id}`;
  const inFilter = (adminId: number, at: Date) =>
    (timelineScope.adminId === null || adminId === timelineScope.adminId) && at >= dayFrom && (dayUntil === null || at < dayUntil);
  const items: TimelineItem[] = [];
  for (const r of recent) {
    const kind = describeKind(r.kind);
    if (!kind || !inFilter(r.admin_id, new Date(r.at))) continue;
    items.push({ at: new Date(r.at), adminId: r.admin_id, nickname: nameOf(r.admin_id), kind: kind.category, label: kind.label, target: describeTarget(r.target_type, r.target_id) });
  }
  for (const r of signInRows) {
    const at = new Date(r.at);
    if (inFilter(r.admin_id, at)) items.push({ at, adminId: r.admin_id, nickname: nameOf(r.admin_id), kind: "login", label: "로그인", target: null });
  }
  for (const r of visitRows) {
    const at = new Date(r.at);
    if (inFilter(r.admin_id, at)) items.push({ at, adminId: r.admin_id, nickname: nameOf(r.admin_id), kind: "visit", label: "방문", target: null, until: new Date(r.last) });
  }
  const matched = items.filter((x) => f.kind === null || x.kind === f.kind).sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    today,
    days,
    dayStatus,
    measuredDays7,
    measuredDays30,
    dailyTasks,
    taskCoverage,
    dailyActiveAdmins: days.map((_, i) => (dayStatus[i] === "none" ? null : admins.filter((a) => a.isAdmin && a.strip[i] === "active").length)),
    dailyVisits: countPerDay(visitRows, null),
    dailySignIns: countPerDay(signInRows, null),
    presenceStatus,
    presenceDays7: measured(presenceStatus, 7),
    presenceDays30: measured(presenceStatus, STRIP_DAYS),
    admins,
    visitEvents: visitRows.map((v) => ({ adminId: v.admin_id, at: new Date(v.at) })),
    signInEvents: signInRows.map((v) => ({ adminId: v.admin_id, at: new Date(v.at) })),
    timeline: matched.slice(0, TIMELINE_LIMIT),
    timelineMatched: matched.length,
    timelineCapped: recent.length === TIMELINE_TASK_CAP,
    filter: f,
    logSince,
    presenceSince,
    recordFailures,
    visitFailures,
    lastActiveSince: recordingSince(activeMarker, earliestActive?._min.lastActiveAt ?? null),
  };
}
