import { FREE_LIMITS_MB, type MetricKey, type VisitSeriesKey } from "./dashboard";
import {
  apiCoverage,
  bucketSpan,
  KEYWORD_BASIS_CHANGED_AT,
  isInternalRoute,
  SOURCE_OF,
  sinceLabel,
  summarizeTimings,
  unsplitSearches,
  type Coverage,
  type Report,
} from "./report";
import { describeRoute } from "./apiRoutes";
import { PAGE_KIND_LABELS, REF_SOURCE_LABELS, type PageKind, type RefSource } from "./visits";
import { buildCsv, buildXlsx, columnName, type Cell, type Sheet } from "./xlsx";

// 운영 통계 내보내기: the same Report the dashboard shows, laid out as the
// six sheets of the Excel file or one of six CSV files. Aggregates only --
// no names, e-mails, member ids, IPs, search text or audit logs exist in a
// Report to begin with.

import { DATASETS, type DatasetKey } from "./exportOptions";

export { DATASETS, type DatasetKey };

type Kind = "text" | "int" | "pct" | "period" | "ms";
// A value: a number, text, or null = 미측정 (not recorded then -- never 0).
type Value = number | string | null;
type Table = { title?: string; columns: { label: string; kind: Kind }[]; rows: Value[][]; total?: Value[] };
type Dataset = { key: DatasetKey; name: string; tables: Table[]; notes: string[]; widths: number[] };

const UNIT_LABEL = { day: "일별", week: "주별(월요일 시작)", month: "월별" } as const;

export const CAVEATS = [
  "방문 세션은 고유 방문자 수가 아닙니다. 같은 브라우저에서 30분 넘게 조회가 없거나 날짜가 바뀌면 새 방문으로 세며, 한 사람이 기기 두 대로 들어오면 두 번 셉니다.",
  "방문 세션은 첫 화면을 볼 때의 로그인 여부로 나눕니다. 방문 도중 로그인하면 '비로그인으로 시작'한 방문으로 세고, 로그인한 뒤 본 화면은 '로그인' 페이지뷰로 셉니다.",
  "완료 처리는 작성자가 게시글을 '찾음/완료'로 바꾸고 되돌리지 않은 건수(작성자 표시)이며, 실제 물품 반환을 확인한 수치가 아닙니다.",
  `통계 수집 시작 이전 기간은 미측정입니다(0건이 아님). 검색·AI 추천·활성 회원·서버 응답 시간: ${sinceLabel("ops")}부터, 방문 통계와 검색의 로그인·비로그인 구분: ${sinceLabel("visit")}부터, 완료 처리: ${sinceLabel("completed")}부터. 가입·게시글·채팅은 서비스 시작부터 집계됩니다.`,
  `키워드 검색 집계 기준이 ${KEYWORD_BASIS_CHANGED_AT.replace("T", " ")}에 바뀌었습니다(이전: API 검색만, 이후: 게시판·검색 화면의 검색 포함). 이 시점 전후의 수치를 직접 비교하지 마세요.`,
  "관리자 계정의 방문과 검색은 일반 통계에서 제외해 따로 셉니다. 검색어 원문, 실명, 이메일, 회원 식별자, IP 주소는 수집하거나 내보내지 않습니다.",
  "모든 날짜와 시각은 한국 시간(KST) 기준입니다.",
];

const sumOf = (...values: (number | null)[]): number | null => (values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0));
const ratio = (part: number | null, whole: number | null): number | null => (part === null || !whole ? null : part / whole);

function coverageNote(coverage: Coverage, key: MetricKey | VisitSeriesKey): string {
  const source = SOURCE_OF[key];
  if (!source || coverage === "full") return "";
  return coverage === "none" ? `미측정(${sinceLabel(source)}부터 집계)` : `${sinceLabel(source)} 이후만 집계(이전은 미측정)`;
}

export function datasetsOf(report: Report): Dataset[] {
  const { totals, totalCoverage: cov, buckets } = report;
  const at = (key: MetricKey, i: number) => report.core[key][i];
  const vat = (key: VisitSeriesKey, i: number) => report.visit[key][i];
  const period = { label: report.range.unit === "day" ? "날짜" : report.range.unit === "week" ? "주(시작일)" : "월", kind: "period" as const };
  // A week cut by the range starts at the range start, not the Monday before.
  const startOf = (b: string) => bucketSpan(report.range, b).from;
  const refs = report.breakdown.refs;
  const sessions = sumOf(totals.sessionAnon, totals.sessionMember);
  const everytime = cov.sessionAnon === "none" ? null : (refs.find((r) => r.source === "everytime")?.sessions ?? 0);

  const summaryRows: Value[][] = [
    ["회원", "신규 가입", totals.signups, ""],
    ["회원", "활성 회원(기간 내 서로 다른 로그인 회원)", totals.active, coverageNote(cov.active, "active")],
    ["방문", "페이지뷰 합계", sumOf(totals.pvAnon, totals.pvMember), coverageNote(cov.pvAnon, "pvAnon")],
    ["방문", "페이지뷰(비로그인)", totals.pvAnon, ""],
    ["방문", "페이지뷰(로그인)", totals.pvMember, ""],
    ["방문", "방문 세션 합계", sessions, ["고유 방문자 수 아님", coverageNote(cov.sessionAnon, "sessionAnon")].filter(Boolean).join(" · ")],
    ["방문", "방문 세션(비로그인으로 시작)", totals.sessionAnon, ""],
    ["방문", "방문 세션(로그인 상태로 시작)", totals.sessionMember, "방문 도중 로그인한 경우는 비로그인으로 시작한 방문에 포함"],
    ["방문", "에브리타임 유입 방문 세션", everytime, ""],
    ["검색", "검색 합계", sumOf(totals.searchKeyword, totals.searchSemantic, totals.searchImage), coverageNote(cov.searchKeyword, "searchKeyword")],
    ["검색", "키워드 검색", totals.searchKeyword, `${KEYWORD_BASIS_CHANGED_AT.replace("T", " ")} 집계 기준 변경`],
    ["검색", "자연어(AI) 검색", totals.searchSemantic, ""],
    ["검색", "이미지 검색", totals.searchImage, ""],
    ["검색", "검색(비로그인)", totals.searchAnon, coverageNote(cov.searchAnon, "searchAnon")],
    ["검색", "검색(로그인)", totals.searchMember, ""],
    ["검색", "로그인 구분 집계 전 검색", unsplitSearches(report), `${sinceLabel("visit")} 이전 검색은 합계에만 포함`],
    ["게시글", "분실물 등록", totals.lost, ""],
    ["게시글", "습득물 등록", totals.found, ""],
    ["AI 추천", "AI 추천 노출", totals.recommend, coverageNote(cov.recommend, "recommend")],
    ["채팅", "신규 채팅방", totals.chatRooms, ""],
    ["채팅", "채팅 메시지", totals.messages, ""],
    ["완료 처리", "완료 처리(작성자 표시)", totals.completed, ["실제 물품 반환 확인 아님", coverageNote(cov.completed, "completed")].filter(Boolean).join(" · ")],
  ];

  const visitRows = buckets.map((b, i) => {
    const start = startOf(b);
    const anon = vat("pvAnon", i);
    const all = sumOf(anon, vat("pvMember", i));
    return [start, anon, vat("pvMember", i), all, vat("sessionAnon", i), vat("sessionMember", i), sumOf(vat("sessionAnon", i), vat("sessionMember", i)), ratio(anon, all), at("active", i), vat("internalPv", i)];
  });
  const visitTotal = [
    "합계",
    totals.pvAnon,
    totals.pvMember,
    sumOf(totals.pvAnon, totals.pvMember),
    totals.sessionAnon,
    totals.sessionMember,
    sessions,
    ratio(totals.pvAnon, sumOf(totals.pvAnon, totals.pvMember)),
    totals.active,
    totals.internalPv,
  ];
  const pagesMeasured = cov.pvAnon !== "none";
  const pageRows: Value[][] = report.breakdown.pages.map((p) => [PAGE_KIND_LABELS[p.kind as PageKind] ?? p.kind, p.anon, p.member, p.anon + p.member]);

  const refRows: Value[][] = refs.map((r) => [REF_SOURCE_LABELS[r.source as RefSource] ?? r.source, r.sessions, ratio(r.sessions, sessions)]);
  const utmRows = (list: { value: string; sessions: number }[]): Value[][] => list.map((r) => [r.value, r.sessions]);

  const usageRows = buckets.map((b, i) => [
    startOf(b),
    at("lost", i),
    at("found", i),
    at("searchKeyword", i),
    at("searchSemantic", i),
    at("searchImage", i),
    sumOf(at("searchKeyword", i), at("searchSemantic", i), at("searchImage", i)),
    vat("searchAnon", i),
    vat("searchMember", i),
    at("recommend", i),
    at("chatRooms", i),
    at("messages", i),
  ]);
  const usageTotal: Value[] = [
    "합계",
    totals.lost,
    totals.found,
    totals.searchKeyword,
    totals.searchSemantic,
    totals.searchImage,
    sumOf(totals.searchKeyword, totals.searchSemantic, totals.searchImage),
    totals.searchAnon,
    totals.searchMember,
    totals.recommend,
    totals.chatRooms,
    totals.messages,
  ];

  const completedRows = buckets.map((b, i) => [startOf(b), report.completedByType.lost[i], report.completedByType.found[i], at("completed", i)]);
  const completedTotal = (list: (number | null)[]) => (cov.completed === "none" ? null : list.reduce<number>((a, v) => a + (v ?? 0), 0));

  const api = report.timings.filter((r) => !isInternalRoute(r.route));
  const internal = report.timings.filter((r) => isInternalRoute(r.route));
  const apiSummary = summarizeTimings(api);
  const apiCov = apiCoverage(report.range, report.today);
  const serverMeasured = apiCov.coverage !== "none";
  const routeRow = (r: Report["timings"][number]): Value[] => [r.route, describeRoute(r.route), r.count, r.errors, r.count ? r.errors / r.count : null, r.avgMs, r.p50, r.p95];
  const capacity = report.capacity;

  return [
    {
      key: "summary",
      name: "운영 요약",
      widths: [12, 40, 14, 52],
      tables: [{ columns: [{ label: "구분", kind: "text" }, { label: "지표", kind: "text" }, { label: "기간 합계", kind: "int" }, { label: "집계 기준·비고", kind: "text" }], rows: summaryRows }],
      notes: CAVEATS,
    },
    {
      key: "visits",
      name: "방문 통계",
      widths: [14, 13, 13, 13, 15, 15, 13, 13, 13, 15],
      tables: [
        {
          title: `${UNIT_LABEL[report.range.unit]} 페이지뷰·방문 세션`,
          columns: [
            period,
            { label: "페이지뷰(비로그인)", kind: "int" },
            { label: "페이지뷰(로그인)", kind: "int" },
            { label: "페이지뷰 합계", kind: "int" },
            { label: "방문 세션(비로그인으로 시작)", kind: "int" },
            { label: "방문 세션(로그인 상태로 시작)", kind: "int" },
            { label: "방문 세션 합계", kind: "int" },
            { label: "비로그인 비율(PV)", kind: "pct" },
            { label: "활성 회원", kind: "int" },
            { label: "관리자 페이지뷰(제외분)", kind: "int" },
          ],
          rows: visitRows,
          total: visitTotal,
        },
        {
          title: "화면별 페이지뷰(기간 전체)",
          columns: [{ label: "화면", kind: "text" }, { label: "비로그인", kind: "int" }, { label: "로그인", kind: "int" }, { label: "합계", kind: "int" }],
          rows: pagesMeasured ? pageRows : [["미측정", null, null, null]],
        },
      ],
      notes: [CAVEATS[0], CAVEATS[1], "활성 회원은 그 기간에 로그인해 이용한 서로 다른 회원 수이며, 합계 행은 기간 전체의 서로 다른 회원 수입니다(기간별 값의 합이 아님).", `방문 통계는 ${sinceLabel("visit")}부터 집계되며 그 전은 미측정입니다.`],
    },
    {
      key: "referrals",
      name: "유입 분석",
      widths: [26, 14, 12],
      tables: [
        { title: "유입 경로(방문 세션)", columns: [{ label: "유입 경로", kind: "text" }, { label: "방문 세션", kind: "int" }, { label: "비율", kind: "pct" }], rows: pagesMeasured ? refRows : [["미측정", null, null]] },
        { title: "UTM 출처(utm_source)", columns: [{ label: "utm_source", kind: "text" }, { label: "방문 세션", kind: "int" }], rows: utmRows(report.breakdown.utmSources) },
        { title: "UTM 캠페인(utm_campaign)", columns: [{ label: "utm_campaign", kind: "text" }, { label: "방문 세션", kind: "int" }], rows: utmRows(report.breakdown.utmCampaigns) },
      ],
      notes: [
        "유입 경로는 방문 세션의 첫 화면을 연 직전 사이트를 정해진 분류로만 셉니다(전체 주소는 저장하지 않음).",
        "UTM은 영문 소문자·숫자·_·- 32자 이내 값만, 하루 30종까지 따로 세고 그 이후 새 값은 etc로 묶습니다.",
        `유입 분석은 ${sinceLabel("visit")}부터 집계되며 그 전은 미측정입니다.`,
      ],
    },
    {
      key: "usage",
      name: "서비스 이용",
      widths: [14, 12, 12, 12, 13, 12, 12, 13, 13, 13, 12, 12],
      tables: [
        {
          title: `${UNIT_LABEL[report.range.unit]} 서비스 이용`,
          columns: [
            period,
            { label: "분실물 등록", kind: "int" },
            { label: "습득물 등록", kind: "int" },
            { label: "키워드 검색", kind: "int" },
            { label: "자연어(AI) 검색", kind: "int" },
            { label: "이미지 검색", kind: "int" },
            { label: "검색 합계", kind: "int" },
            { label: "검색(비로그인)", kind: "int" },
            { label: "검색(로그인)", kind: "int" },
            { label: "AI 추천 노출", kind: "int" },
            { label: "신규 채팅방", kind: "int" },
            { label: "채팅 메시지", kind: "int" },
          ],
          rows: usageRows,
          total: usageTotal,
        },
      ],
      notes: [
        CAVEATS[4],
        `검색·AI 추천은 ${sinceLabel("ops")}부터, 검색의 로그인·비로그인 구분은 ${sinceLabel("visit")}부터 집계됩니다(그 전 검색은 합계에만 포함).`,
        "검색은 첫 페이지 결과를 볼 때 한 번 세며, 같은 서버에서 10초 안에 반복된 같은 검색은 한 번으로 셉니다. 관리자 검색은 비로그인·로그인 어느 쪽에도 넣지 않습니다.",
      ],
    },
    {
      key: "completed",
      name: "완료 처리",
      widths: [14, 18, 18, 14],
      tables: [
        {
          title: `${UNIT_LABEL[report.range.unit]} 완료 처리(작성자 표시)`,
          columns: [period, { label: "분실물 '찾음'", kind: "int" }, { label: "습득물 '완료'", kind: "int" }, { label: "합계", kind: "int" }],
          rows: completedRows,
          total: ["합계", completedTotal(report.completedByType.lost), completedTotal(report.completedByType.found), totals.completed],
        },
      ],
      notes: [
        CAVEATS[2],
        "게시글별 마지막 상태 변경이 '찾음/완료'인 경우만 그 변경 날짜에 셉니다(나중에 되돌린 게시글은 제외).",
        `상태 변경 이력은 ${sinceLabel("completed")}부터 있으며 그 전은 미측정입니다.`,
      ],
    },
    {
      key: "server",
      name: "서버 운영",
      widths: [36, 40, 10, 10, 10, 12, 12, 12],
      tables: [
        {
          title: "API 요약(기간 전체, AI·DB 내부 항목 제외)",
          columns: [
            { label: "요청 수", kind: "int" },
            { label: "오류(5xx)", kind: "int" },
            { label: "오류율", kind: "pct" },
            { label: "평균", kind: "ms" },
            { label: "p95", kind: "text" },
          ],
          rows: [serverMeasured ? [apiSummary.count, apiSummary.errors, apiSummary.errorRate, apiSummary.avgMs, apiSummary.p95] : [null, null, null, null, null]],
        },
        {
          title: "API 경로별 응답 시간·오류율",
          columns: [
            { label: "경로", kind: "text" },
            { label: "비고(기능)", kind: "text" },
            { label: "요청", kind: "int" },
            { label: "오류(5xx)", kind: "int" },
            { label: "오류율", kind: "pct" },
            { label: "평균", kind: "ms" },
            { label: "p50", kind: "text" },
            { label: "p95", kind: "text" },
          ],
          rows: api.map(routeRow),
        },
        {
          title: "AI 추론·DB 지연",
          columns: [
            { label: "항목", kind: "text" },
            { label: "비고(기능)", kind: "text" },
            { label: "횟수", kind: "int" },
            { label: "실패", kind: "int" },
            { label: "실패율", kind: "pct" },
            { label: "평균", kind: "ms" },
            { label: "p50", kind: "text" },
            { label: "p95", kind: "text" },
          ],
          rows: internal.map(routeRow),
        },
        {
          title: `저장 용량(Supabase Free 한도 대비${capacity ? `, ${capacity.day} 기준` : ""})`,
          columns: [{ label: "항목", kind: "text" }, { label: "사용량(MB)", kind: "int" }, { label: "무료 한도(MB)", kind: "int" }, { label: "사용률", kind: "pct" }],
          rows: capacity
            ? [
                ["데이터베이스", capacity.dbMb, FREE_LIMITS_MB.db, capacity.dbMb / FREE_LIMITS_MB.db],
                ["Storage(사진)", capacity.storageMb, FREE_LIMITS_MB.storage, capacity.storageMb / FREE_LIMITS_MB.storage],
              ]
            : [["기록 없음", null, null, null]],
        },
      ],
      notes: [
        ...(apiCov.note ? [apiCov.note] : []),
        `응답 시간은 ${sinceLabel("ops")}부터 집계되며 그 전은 미측정입니다. 시간 단위로 저장되고 최근 90일만 보관합니다. 서버 인스턴스마다 모아 기록하므로 인스턴스 종료 직전 값은 빠질 수 있습니다.`,
        "비고(기능)는 각 API 코드에서 확인한 역할입니다.",
        "p50/p95는 구간 상한값입니다(예: ≤ 400ms). 오류율은 5xx 응답 비율입니다.",
        "ai:*-load는 인스턴스당 한 번의 모델 로딩, ai:*-embed는 1건 추론, db:ping은 기록할 때마다 잰 DB 왕복 시간입니다.",
        "저장 용량은 가장 최근 기록(매일 새벽 정리 작업 때 기록)이며 선택한 기간과 관계없습니다.",
      ],
    },
  ];
}

const periodLabel = (report: Report, label?: string) => {
  const last = new Date(Date.parse(`${report.range.until}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `${label ?? `${report.range.from} ~ ${last}`} · 집계 단위 ${UNIT_LABEL[report.range.unit]}`;
};

function cellOf(value: Value, kind: Kind, unit: Report["range"]["unit"]): Cell {
  if (value === null) return { v: "미측정", s: "unmeasured" };
  if (kind === "period" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { v: value, s: unit === "month" ? "month" : "day", date: true };
  if (typeof value === "number") return { v: value, s: kind === "pct" ? "pct" : kind === "ms" ? "ms" : "int" };
  return { v: value, s: "text" };
}

export function toSheets(report: Report, label?: string, datasets = datasetsOf(report)): Sheet[] {
  return datasets.map((ds) => {
    const width = Math.max(4, ds.widths.length);
    const rows: Cell[][] = [];
    const merges: string[] = [];
    const wide = (text: string, s: "title" | "meta" | "note" | "section") => {
      rows.push([{ v: text, s }]);
      merges.push(`A${rows.length}:${columnName(width - 1)}${rows.length}`);
    };
    wide(`MJU Find 운영 통계 — ${ds.name}`, "title");
    wide(`통계 기간: ${periodLabel(report, label)}`, "meta");
    wide(`생성 일시: ${report.generatedAt} (KST) · 출처: MJU Find 관리자 운영 통계`, "meta");
    rows.push([]);
    let freezeRows: number | undefined;
    ds.tables.forEach((table, t) => {
      if (table.title) wide(table.title, "section");
      rows.push(table.columns.map((c) => ({ v: c.label, s: "header" })));
      if (t === 0 && ds.tables.length === 1) freezeRows = rows.length;
      for (const row of table.rows) {
        rows.push(row.map((v, i) => (i === 0 && table.columns[0].kind === "text" ? { v: v ?? "", s: "text" } : cellOf(v, table.columns[i].kind, report.range.unit))));
      }
      if (table.rows.length === 0) rows.push([{ v: "기록 없음", s: "text" }]);
      if (table.total) {
        rows.push(
          table.total.map((v, i) =>
            i === 0 ? { v: v ?? "", s: "totalText" } : v === null ? { v: "미측정", s: "unmeasured" } : table.columns[i].kind === "pct" && typeof v === "number" ? { v, s: "pct" } : { v, s: typeof v === "number" ? "totalInt" : "totalText" },
          ),
        );
      }
      rows.push([]);
    });
    wide("집계 기준과 주의사항", "section");
    for (const note of ds.notes) wide(`· ${note}`, "note");
    return { name: ds.name, rows, widths: ds.widths, merges, freezeRows };
  });
}

export function toXlsx(report: Report, label?: string): Buffer {
  return buildXlsx(toSheets(report, label), { title: "MJU Find 운영 통계", createdAt: new Date() });
}

// One CSV per data kind: "#" lines (service, period, time, caveats) on top
// -- skipped by most tools with a comment option -- then plain tables.
export function toCsv(report: Report, key: DatasetKey, label?: string): string {
  const ds = datasetsOf(report).find((d) => d.key === key)!;
  // "#" lines are written as they are (never quoted), so a reader's comment
  // option skips each one whole even when it holds a comma.
  const meta = [
    `# MJU Find 운영 통계 - ${ds.name}`,
    `# 통계 기간: ${periodLabel(report, label)}`,
    `# 생성 일시: ${report.generatedAt} (KST)`,
    ...ds.notes.map((n) => `# 주의: ${n}`),
    "# 빈 칸은 미측정(통계 수집 시작 이전)이며 0과 다릅니다.",
  ].map((line) => line.replace(/[\r\n]+/g, " "));
  const rows: (string | number | null)[][] = [];
  for (const table of ds.tables) {
    rows.push([]);
    if (table.title) rows.push([`[${table.title}]`]);
    rows.push(table.columns.map((c) => (c.kind === "pct" ? `${c.label}(%)` : c.kind === "ms" ? `${c.label}(ms)` : c.label)));
    const out = (v: Value, kind: Kind) => (v === null ? null : kind === "pct" && typeof v === "number" ? Math.round(v * 1000) / 10 : v);
    for (const row of table.rows) rows.push(row.map((v, i) => out(v, table.columns[i].kind)));
    if (table.total) rows.push(table.total.map((v, i) => out(v, table.columns[i].kind)));
  }
  return `\ufeff${meta.join("\r\n")}\r\n${buildCsv(rows).slice(1)}`;
}

export const exportFileName = (report: Report, ext: "xlsx" | "csv", key?: DatasetKey) => {
  const last = new Date(Date.parse(`${report.range.until}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return `mju-find-stats${key ? `-${key}` : ""}_${report.range.from.replaceAll("-", "")}-${last.replaceAll("-", "")}.${ext}`;
};

