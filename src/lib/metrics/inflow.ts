import { prisma } from "@/lib/db/prisma";
import { addDays } from "./daySelection";
import { coverageOf, type Coverage } from "./report";
import { PAGE_KINDS, siteLabel, siteOf, type PageKind, type SiteKey } from "./visits";

// 유입 경로 (날짜별 방문 분석): how visit sessions reached MJU Find on the
// chosen days -- one count per session, from its first view (record:
// app/visitActions.ts). Read-only, MetricDaily counters only:
// - visit.src.<channel>.<aud>: source (utm.<v> when a valid utm_source,
//   else ref.<category>) by login state at the first view. These began
//   with their own release: the first day with any such row is partly
//   measured, days before it are 미측정 -- the older referrer-only counter
//   (visit.ref.*) is shown apart for them, never merged in.
// - visit.entry.<channel>.<kind>: the same sessions by first screen.
// - visit.utm_source / utm_medium / utm_campaign: sessions with each tag
//   (utm_medium began with visit.src).
// - visit.session.<aud>: every session; on a fully measured day the
//   sources add up to it exactly, which is checked and shown.
// Admins' and automated browsers' visits are never in any of these.

export type InflowDay = {
  day: string;
  coverage: Coverage; // of the source counters
  sessions: { anon: number; member: number } | null; // null: before visit counting
  bySource: { anon: number; member: number } | null; // the source counters' sum
  // a fully measured day whose sources do not add up to its sessions
  mismatch: boolean;
};

export type SiteRow = { site: SiteKey; label: string; anon: number; member: number; total: number; viaUtm: number; viaRef: number; byDay: number[] };
export type ChannelRow = { channel: string; site: SiteKey; label: string; anon: number; member: number; total: number };
export type EntryRow = { kind: PageKind; total: number; bySite: Partial<Record<SiteKey, number>> };
export type TagRow = { value: string; sessions: number };

export type InflowReport = {
  days: string[];
  since: string | null; // first day with source counters in this environment
  perDay: InflowDay[];
  measuredDays: number; // days with source counters (in full or part)
  total: { anon: number; member: number; all: number };
  sites: SiteRow[]; // biggest first
  channels: ChannelRow[];
  entries: EntryRow[];
  utm: { source: TagRow[]; medium: TagRow[]; campaign: TagRow[]; mediumSince: string | null };
  // the referrer-only counter of every chosen day with visit counting (also
  // before the source counters): sessions by referrer category
  legacyRefs: { label: string; sessions: number }[];
  legacyDays: number;
};

const asDay = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

// Pure: counter rows of the chosen days -> the report.
export function buildInflow(days: string[], rows: { day: string; metric: string; n: number }[], since: string | null): InflowReport {
  const sorted = [...new Set(days)].sort();
  const index = new Map(sorted.map((d, i) => [d, i]));
  const coverageOfDay = (d: string): Coverage => (!since || d < since ? "none" : d === since ? "partial" : "full");
  const perDay: InflowDay[] = sorted.map((day) => ({ day, coverage: coverageOfDay(day), sessions: null, bySource: null, mismatch: false }));
  const visitCovered = (d: string) => coverageOf("visit", d, addDays(d, 1)) !== "none";
  const channels = new Map<string, { anon: number; member: number }>();
  const sites = new Map<SiteKey, SiteRow>();
  const entries = new Map<PageKind, EntryRow>();
  const tags = { source: new Map<string, number>(), medium: new Map<string, number>(), campaign: new Map<string, number>() };
  const legacy = new Map<string, number>();

  for (const r of rows) {
    const i = index.get(r.day);
    if (i === undefined) continue;
    const d = perDay[i];
    let m: RegExpExecArray | null;
    if ((m = /^visit\.session\.(anon|member)$/.exec(r.metric))) {
      if (!visitCovered(r.day)) continue;
      d.sessions ??= { anon: 0, member: 0 };
      d.sessions[m[1] as "anon" | "member"] += r.n;
    } else if ((m = /^visit\.src\.((?:utm|ref)\.[a-z0-9_-]+)\.(anon|member)$/.exec(r.metric))) {
      if (d.coverage === "none") continue;
      const aud = m[2] as "anon" | "member";
      d.bySource ??= { anon: 0, member: 0 };
      d.bySource[aud] += r.n;
      const ch = channels.get(m[1]) ?? { anon: 0, member: 0 };
      ch[aud] += r.n;
      channels.set(m[1], ch);
      const site = siteOf(m[1]);
      const row = sites.get(site) ?? { site, label: siteLabel(site), anon: 0, member: 0, total: 0, viaUtm: 0, viaRef: 0, byDay: sorted.map(() => 0) };
      row[aud] += r.n;
      row.total += r.n;
      if (m[1].startsWith("utm.")) row.viaUtm += r.n;
      else row.viaRef += r.n;
      row.byDay[i] += r.n;
      sites.set(site, row);
    } else if ((m = /^visit\.entry\.((?:utm|ref)\.[a-z0-9_-]+)\.([a-z_]+)$/.exec(r.metric))) {
      if (d.coverage === "none" || !(PAGE_KINDS as readonly string[]).includes(m[2])) continue;
      const kind = m[2] as PageKind;
      const row = entries.get(kind) ?? { kind, total: 0, bySite: {} };
      const site = siteOf(m[1]);
      row.total += r.n;
      row.bySite[site] = (row.bySite[site] ?? 0) + r.n;
      entries.set(kind, row);
    } else if ((m = /^visit\.utm_(source|medium|campaign)\.([a-z0-9_-]+)$/.exec(r.metric))) {
      if (!visitCovered(r.day) || (m[1] === "medium" && d.coverage === "none")) continue;
      const map = tags[m[1] as "source" | "medium" | "campaign"];
      map.set(m[2], (map.get(m[2]) ?? 0) + r.n);
    } else if ((m = /^visit\.ref\.([a-z]+)$/.exec(r.metric))) {
      if (!visitCovered(r.day)) continue;
      const label = siteLabel(siteOf(`ref.${m[1]}`));
      legacy.set(label, (legacy.get(label) ?? 0) + r.n);
    }
  }
  for (const d of perDay) {
    if (d.coverage === "full" && d.sessions) {
      const b = d.bySource ?? { anon: 0, member: 0 };
      d.bySource = b;
      d.mismatch = b.anon !== d.sessions.anon || b.member !== d.sessions.member;
    }
  }
  const total = [...channels.values()].reduce<{ anon: number; member: number; all: number }>((a, c) => ({ anon: a.anon + c.anon, member: a.member + c.member, all: a.all + c.anon + c.member }), { anon: 0, member: 0, all: 0 });
  const tagRows = (m: Map<string, number>) => [...m].map(([value, sessions]) => ({ value, sessions })).sort((a, b) => b.sessions - a.sessions || a.value.localeCompare(b.value));
  return {
    days: sorted,
    since,
    perDay,
    measuredDays: perDay.filter((d) => d.coverage !== "none").length,
    total,
    sites: [...sites.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)),
    channels: [...channels]
      .map(([channel, v]) => ({ channel, site: siteOf(channel), label: channel.startsWith("utm.") ? `UTM ${channel.slice(4)}` : siteLabel(siteOf(channel)), ...v, total: v.anon + v.member }))
      .sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel)),
    entries: [...entries.values()].sort((a, b) => b.total - a.total),
    utm: { source: tagRows(tags.source), medium: tagRows(tags.medium), campaign: tagRows(tags.campaign), mediumSince: since },
    legacyRefs: [...legacy].map(([label, sessions]) => ({ label, sessions })).sort((a, b) => b.sessions - a.sessions),
    legacyDays: sorted.filter(visitCovered).length,
  };
}

export async function loadInflow(days: string[]): Promise<InflowReport> {
  const wanted = [...new Set(days)].sort();
  const [rows, first] = await Promise.all([
    wanted.length
      ? prisma.$queryRaw<{ day: Date | string; metric: string; n: bigint | number }[]>`
          SELECT "day", "metric", sum("value") AS n FROM "MetricDaily"
          WHERE "day" = ANY(${wanted}::date[])
            AND ("metric" LIKE 'visit.src.%' OR "metric" LIKE 'visit.entry.%' OR "metric" LIKE 'visit.utm\\_%'
              OR "metric" LIKE 'visit.ref.%' OR "metric" IN ('visit.session.anon', 'visit.session.member'))
          GROUP BY 1, 2`.catch(() => [])
      : Promise.resolve([]),
    prisma.$queryRaw<{ day: Date | string | null }[]>`SELECT min("day") AS day FROM "MetricDaily" WHERE "metric" LIKE 'visit.src.%'`.catch(() => []),
  ]);
  return buildInflow(
    wanted,
    rows.map((r) => ({ day: asDay(r.day), metric: r.metric, n: Number(r.n) })),
    first[0]?.day ? asDay(first[0].day) : null,
  );
}
