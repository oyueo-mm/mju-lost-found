import { FREE_LIMITS_MB, type MetricKey, type VisitSeriesKey } from "./dashboard";
import {
  apiCoverage,
  formatSeconds,
  meanDuration,
  medianBucket,
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
import { NEW_MEMBER_DAYS, RETURN_WINDOW_DAYS, windowNote, type UserReport } from "./userReport";
import { DURATION_BUCKETS, DURATION_LABELS, PAGES_BUCKETS, PAGES_LABELS } from "./flow";
import { DEVICE_KINDS, DEVICE_LABELS, PAGE_KIND_LABELS, REF_SOURCE_LABELS, type PageKind, type RefSource } from "./visits";
import { buildCsv, buildXlsx, columnName, type Cell, type Sheet } from "./xlsx";

// 운영 통계 내보내기: the same Report the dashboard shows, laid out as the
// eight sheets of the Excel file or one of eight CSV files (the last one,
// 사용자 통계, from a UserReport of the same period). Aggregates only --
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

export const DEVICE_CAVEAT =
  "접속 기기는 User-Agent와 Client Hints로 서버에서 종류만 나누어 셉니다(원본 값·기기 식별자 저장 안 함). iPad는 터치 화면이 있는 Mac 환경으로 판별하며, Windows 터치 노트북·'데스크톱 사이트' 모드의 휴대폰은 PC와 구분할 수 없어 PC로 셉니다. 기기별 통계는 수집을 시작한 날부터 있으며 그 전은 미측정입니다.";

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

export function datasetsOf(report: Report, users?: UserReport): Dataset[] {
  return [...opsDatasets(report), ...(users ? [userDataset(users)] : [])];
}

function opsDatasets(report: Report): Dataset[] {
  const { totals, totalCoverage: cov, buckets } = report;
  const at = (key: MetricKey, i: number) => report.core[key][i];
  const vat = (key: VisitSeriesKey, i: number) => report.visit[key][i];
  const period = { label: report.range.unit === "day" ? "날짜" : report.range.unit === "week" ? "주(시작일)" : "월", kind: "period" as const };
  // A week cut by the range starts at the range start, not the Monday before.
  const startOf = (b: string) => bucketSpan(report.range, b).from;
  const refs = report.breakdown.refs;
  const sessions = sumOf(totals.sessionAnon, totals.sessionMember);
  const everytime = cov.sessionAnon === "none" ? null : (refs.find((r) => r.source === "everytime")?.sessions ?? 0);

  const deviceNote = report.device.since
    ? `기기별은 ${report.device.since}부터 집계${report.device.totalCoverage === "partial" ? "(이전은 미측정)" : ""}`
    : "미측정(기기별 수집 전)";
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
    ...DEVICE_KINDS.map((k, i): Value[] => [
      "방문",
      `방문 세션(${DEVICE_LABELS[k]})`,
      report.device.totals.session[k],
      i === 0 ? deviceNote : "",
    ]),
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
  const deviceRows = buckets.map((b, i) => [
    startOf(b),
    ...DEVICE_KINDS.map((k) => report.device.session[k][i]),
    ...DEVICE_KINDS.map((k) => report.device.pv[k][i]),
  ]);
  const deviceTotal: Value[] = ["합계", ...DEVICE_KINDS.map((k) => report.device.totals.session[k]), ...DEVICE_KINDS.map((k) => report.device.totals.pv[k])];
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
      widths: [14, 14, 14, 14, 15, 15, 14, 14, 14, 15],
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
          title: `${UNIT_LABEL[report.range.unit]} 접속 기기별 방문 세션·페이지뷰`,
          columns: [
            period,
            ...DEVICE_KINDS.map((k) => ({ label: `방문 세션(${DEVICE_LABELS[k]})`, kind: "int" as const })),
            ...DEVICE_KINDS.map((k) => ({ label: `페이지뷰(${DEVICE_LABELS[k]})`, kind: "int" as const })),
          ],
          rows: deviceRows,
          total: deviceTotal,
        },
        {
          title: "화면별 페이지뷰(기간 전체)",
          columns: [{ label: "화면", kind: "text" }, { label: "비로그인", kind: "int" }, { label: "로그인", kind: "int" }, { label: "합계", kind: "int" }],
          rows: pagesMeasured ? pageRows : [["미측정", null, null, null]],
        },
      ],
      notes: [
        CAVEATS[0],
        CAVEATS[1],
        DEVICE_CAVEAT,
        "활성 회원은 그 기간에 로그인해 이용한 서로 다른 회원 수이며, 합계 행은 기간 전체의 서로 다른 회원 수입니다(기간별 값의 합이 아님). 탈퇴한 회원의 활동 기록은 삭제되므로 지난 기간의 활성 회원 수도 줄어들 수 있습니다.", `방문 통계는 ${sinceLabel("visit")}부터 집계되며 그 전은 미측정입니다.`],
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
    flowDataset(report),
  ];
}

export const FLOW_CAVEATS = [
  "체류 시간·이탈은 추정치입니다. 방문의 첫 화면부터 마지막으로 확인된 활동(화면 조회, 또는 화면이 보이는 동안의 입력)까지이며, 탭이 백그라운드에 있거나 입력이 없으면 늘지 않습니다. 브라우저를 닫은 정확한 시각은 알 수 없습니다.",
  "방문 시작은 기존 방문 세션 기준(30분 넘게 조회가 없거나 날짜가 바뀌면 새 방문)이며 화면 이동·새로고침은 새 방문이 아닙니다.",
  "종료 확인: 같은 브라우저가 나중에 다시 방문해 앞의 방문이 끝난 것이 확인된 방문. 종료 미확인: 그 뒤 다시 오지 않아 끝난 시점을 확인할 수 없는 방문으로, 대부분은 이미 떠난 방문입니다('지금 이용 중'이라는 뜻이 아님). 오늘 수치에는 진행 중인 방문이 그 순간까지의 상태로 포함됩니다.",
  "마지막 이용 화면 비중 = 그 화면에서 끝난 방문 ÷ 체류·이탈 집계 방문. 한 화면만 보고 끝난 방문 비율 = 화면을 1개만 본 방문 ÷ 체류·이탈 집계 방문. '조회 수'는 같은 기간 그 화면이 열린 횟수(원시 집계)로, 방문 수와 단위가 달라 나누지 않았습니다. 보고가 늦거나 빠지면 수치가 조금 다를 수 있습니다(정확히 1회 처리를 보장하지 않음).",
  "평균 체류 시간에는 방문당 최대 60분만 넣으며, 중앙값은 정확한 값 대신 그 값이 속한 구간입니다. 세션은 날짜가 바뀌면 끝나므로 요일별 이탈은 시작한 날의 요일로 셉니다.",
  "개인별 이동 기록이나 정확한 접속·종료 시각은 저장하지 않고, 시간대·구간별 익명 합계만 저장합니다. 관리자 방문은 제외됩니다.",
];

export const USER_NOTES = [
  "가입 = 처음 Google 로그인으로 계정이 만들어진 시각(User.created_at, KST 변환). 동의·닉네임 완료 시각은 따로 기록되지 않아(재동의 때 덮어씀) 현재 완료 여부만 셉니다. 가입 수에는 관리자·탈퇴 회원도 포함됩니다.",
  "회원 수: 누적 가입 = 현재 가입 + 탈퇴, 현재 가입 = 이용 가능 + 비활성화(비활성화는 다시 로그인하면 복구되므로 탈퇴가 아님). 동의·닉네임 완료·관리자·정지·외부 계정은 이용 가능 회원 중의 수입니다.",
  "로그인 완료 = Google 로그인을 마친 횟수(시간대별, 관리자 제외). 로그인 상태가 유지되는 동안은 다시 세지 않으므로 이용량도 사람 수도 아닙니다.",
  "활동 = 그날 로그인한 상태로 사이트를 이용한 회원(하루 한 번, 방문 도중 로그인해도 포함, 관리자 제외). 기간·DAU·WAU·MAU는 서로 다른 회원 수(사람 수)입니다. 활동 기록은 400일 뒤 삭제되므로, 그보다 오래된 날짜는 0명이 아니라 미측정입니다. 회원이 탈퇴하면 그 회원의 활동 기록이 삭제되므로, 이미 지난 기간의 활성 회원 수·DAU·WAU·MAU·재방문 수도 그만큼 줄어들 수 있습니다(시간대별 로그인·페이지뷰 합계는 회원 정보가 없어 그대로 남음).",
  "시간대별 로그인 회원 이용량 = 로그인 상태에서 본 화면 수(각 화면을 볼 때의 로그인 여부 기준). 시간대별로 서로 다른 회원 수는 저장하지 않습니다. 페이지뷰에는 동의 미완료·이용 정지 회원이 본 동의·안내 화면도 들어가고, 활동(사람 수)은 동의·닉네임을 마친 회원만 셉니다.",
  `신규 회원 = 가입한 날부터 ${NEW_MEMBER_DAYS}일 이내. 기간별 활성 회원의 신규·기존은 한 회원을 한쪽에만 넣어(그 기간 활동일 중 하루라도 신규면 신규) 합이 활성 회원 수와 같습니다. 재방문 = 가입 다음 날부터 ${RETURN_WINDOW_DAYS}일 안에 다시 활동. 그 ${RETURN_WINDOW_DAYS}일이 다 지나고 활동 기록이 모두 있는 가입자만 산출하며, 아직 안 지난 가입자는 집계 대기, 활동 기록이 없는 날짜(기록 시작 전, 보관기한 경과)가 섞인 가입자는 미측정, 그 뒤 탈퇴한 가입자는 활동 기록이 삭제되어 탈퇴로 따로 셉니다(재방문하지 않은 것으로 세지 않음).`,
  "회원 단위 비율은 실제 기록을 회원별로 대조한 값이며, 합계로 추정한 전환율이 아닙니다. 회원별 검색 이용은 기록하지 않아 제공하지 않습니다.",
  "실명·이메일·학과·학번·회원 식별자·회원별 접속 기록은 포함하지 않습니다. 모든 날짜·시간은 한국 시간(KST)입니다.",
];

// 재방문: the returned count over the judged sign-ups, then every sign-up
// that could not be judged, by reason (집계 대기 vs 미측정 are different).
function retentionRows(u: UserReport): Value[][] {
  const r = u.activity.retention;
  const title = `가입 후 ${RETURN_WINDOW_DAYS}일 내 재방문`;
  if (!r) return [[title, 0, "이 기간 가입자 없음"]];
  const value: Value = r.eligible ? r.returned : r.pending ? "집계 대기" : null;
  return [
    [title, value, r.eligible ? `산출 가능 ${r.eligible}명 중 (${Math.round((r.returned / r.eligible) * 100)}%) · 기간 가입 ${r.cohort}명` : `산출 가능한 가입자 없음 · 기간 가입 ${r.cohort}명`],
    ["  재방문 산출 가능 가입자", r.eligible, `${RETURN_WINDOW_DAYS}일이 지났고 그 기간 활동 기록이 모두 있음`],
    ["  제외: 집계 대기", r.pending, r.nextReadyDay ? `${RETURN_WINDOW_DAYS}일이 아직 안 지남 · ${r.nextReadyDay}부터 산출` : `${RETURN_WINDOW_DAYS}일이 아직 안 지남`],
    ["  제외: 미측정(기록 시작 전)", r.beforeCollection, `재방문 기간에 활동 기록 시작(${u.activity.since}) 전 날짜 포함`],
    ["  제외: 미측정(보관기한 경과)", r.expired, "재방문 기간의 활동 기록이 400일 보관기한이 지나 삭제됨"],
    ["  제외: 탈퇴", r.withdrawn, "탈퇴로 그 회원의 활동 기록이 삭제됨"],
  ];
}

function userDataset(u: UserReport): Dataset {
  const a = u.activity;
  const startOf = (b: string) => bucketSpan(u.range, b).from;
  const period = { label: u.range.unit === "day" ? "날짜" : u.range.unit === "week" ? "주(시작일)" : "월", kind: "period" as const };
  const measured = (v: number | null): Value => v;
  const ratio = (part: number | null, whole: number | null): Value => (part === null || !whole ? null : part / whole);
  const dows = ["월", "화", "수", "목", "금", "토", "일"];
  return {
    key: "users",
    name: "사용자 통계",
    widths: [30, 16, 16, 12, 14, 16, 16],
    tables: [
      {
        title: "요약",
        columns: [{ label: "항목", kind: "text" }, { label: "값", kind: "int" }, { label: "기준", kind: "text" }],
        rows: [
          ["가입 회원 (현재, 탈퇴 제외)", u.accounts.current, `이용 가능 ${u.accounts.available} + 비활성화 ${u.accounts.deactivated} · 누적 ${u.accounts.total} = 현재 + 탈퇴 ${u.accounts.withdrawn}`],
          ["이용 가능 회원", u.accounts.available, "현재 가입 중 비활성화 제외"],
          ["비활성화 회원", u.accounts.deactivated, "로그인 불가, 다시 로그인하면 복구(탈퇴 아님)"],
          ["동의·닉네임 완료 회원", u.accounts.onboarded, "이용 가능 회원 중, 현재 기준"],
          ["동의 미완료·재동의 필요 회원", u.accounts.notOnboarded, "이용 가능 회원 중, 현재 기준"],
          ["기간 신규 가입", u.signups.inRange, "계정 생성 시각 기준"],
          ["기간 탈퇴", u.withdrawals.inRange, "탈퇴 처리 시각 기준"],
          [
            "기간 활성 회원 (서로 다른 회원)",
            measured(a.unique),
            a.coverage === "partial" ? `부분 측정(${a.expiredInRange ? `${a.retainedFrom} 이전은 보관기한이 지나 삭제` : `${a.since}부터 기록`})` : "",
          ],
          ["DAU", measured(a.dau), windowNote(a.windows.dau, 1, a)],
          ["WAU", measured(a.wau), windowNote(a.windows.wau, 7, a)],
          ["MAU", measured(a.mau), windowNote(a.windows.mau, 30, a)],
          ["로그인 완료 (횟수)", u.hourly.loginTotal, u.hourly.loginSince ? `이 환경 수집 시작 ${u.hourly.loginSince}` : "이 환경에서 수집 전"],
          ["로그인 회원 페이지뷰 (화면 수)", u.hourly.memberPvTotal, u.hourly.memberPvSince ? `이 환경 수집 시작 ${u.hourly.memberPvSince}` : "이 환경에서 수집 전"],
          ["2일 이상 활동한 회원", a.repeat ? a.repeat.multiDay : null, a.repeat ? `기간 활성 ${a.repeat.active}명 중` : ""],
          ...retentionRows(u),
          ["가장 많이 가입한 날", u.signups.peakDay ? u.signups.peakDay.n : null, u.signups.peakDay?.day ?? "-"],
          ["가장 많이 가입한 요일", u.signups.peakDow ? u.signups.peakDow.n : null, u.signups.peakDow ? dows[u.signups.peakDow.dow] : "-"],
          ["가장 많이 가입한 시간대", u.signups.peakHour ? u.signups.peakHour.n : null, u.signups.peakHour ? `${u.signups.peakHour.hour}시` : "-"],
        ],
      },
      {
        title: "기간별 가입·탈퇴·활성 회원",
        columns: [
          period,
          { label: "신규 가입", kind: "int" },
          { label: "누적 가입(탈퇴 포함)", kind: "int" },
          { label: "탈퇴", kind: "int" },
          { label: "활성 회원", kind: "int" },
          { label: `활성: 신규(${NEW_MEMBER_DAYS}일 이내)`, kind: "int" },
          { label: "활성: 기존 회원", kind: "int" },
        ],
        rows: u.buckets.map((b, i) => [startOf(b), u.signups.perBucket[i], u.signups.cumulative[i], u.withdrawals.perBucket[i], a.perBucket[i], a.newPerBucket[i], a.existingPerBucket[i]]),
        total: ["합계", u.signups.inRange, null, u.withdrawals.inRange, a.unique, null, null],
      },
      {
        title: "시간대별 (KST)",
        columns: [{ label: "시간대", kind: "text" }, { label: "가입", kind: "int" }, { label: "로그인 회원 페이지뷰", kind: "int" }, { label: "로그인 완료", kind: "int" }],
        rows: u.signups.byHour.map((n, h) => [`${String(h).padStart(2, "0")}시`, n, u.hourly.memberPv ? u.hourly.memberPv[h] : null, u.hourly.logins ? u.hourly.logins[h] : null]),
      },
      {
        title: "요일별",
        columns: [{ label: "요일", kind: "text" }, { label: "가입", kind: "int" }, { label: "활성 회원-일 합계", kind: "int" }, { label: "측정 일수", kind: "int" }, { label: "하루 평균 활성 회원", kind: "text" }],
        rows: dows.map((d, i) => [d, u.signups.byDow[i], a.coverage === "none" ? null : a.memberDaysByDow[i], a.daysByDow[i], a.daysByDow[i] ? (a.memberDaysByDow[i] / a.daysByDow[i]).toFixed(1) : "-"]),
      },
      {
        title: "회원 참여 (관리자 제외)",
        columns: [{ label: "항목", kind: "text" }, { label: "회원 수", kind: "int" }, { label: "분모", kind: "int" }, { label: "비율", kind: "pct" }],
        rows: [
          ["기간에 게시글을 등록한 회원", u.participation.posters, null, null],
          ["기간에 채팅 메시지를 보낸 회원", u.participation.chatters, null, null],
          ["활성 회원 중 게시글 등록", u.participation.activeWithPost, a.unique, ratio(u.participation.activeWithPost, a.unique)],
          ["활성 회원 중 채팅 참여", u.participation.activeWithChat, a.unique, ratio(u.participation.activeWithChat, a.unique)],
          ["기간 신규 가입 회원 중 활동(로그인 상태 이용)", u.participation.newActive, u.participation.newSignups, ratio(u.participation.newActive, u.participation.newSignups)],
          ["기간 신규 가입 회원 중 게시글 등록(조회 시점까지)", u.participation.newPosted, u.participation.newSignups, ratio(u.participation.newPosted, u.participation.newSignups)],
          ["기간 신규 가입 회원 중 채팅(조회 시점까지)", u.participation.newChatted, u.participation.newSignups, ratio(u.participation.newChatted, u.participation.newSignups)],
        ],
      },
    ],
    notes: [
      ...USER_NOTES,
      `활성 회원은 ${a.since}부터, 시간대별 로그인 회원 페이지뷰는 ${u.hourly.memberPvSince ?? "수집 전"}부터, 로그인 완료는 ${u.hourly.loginSince ?? "수집 전"}부터 이 환경에서 집계되며 그 전은 미측정, 그 뒤 기록이 없으면 0건입니다.`,
    ],
  };
}

function flowDataset(report: Report): Dataset {
  const flow = report.flow;
  const flowOn = flow.coverage !== "none";
  const startOn = flow.startCoverage !== "none";
  const flowSessions = Object.values(flow.flowSessions).reduce((a, n) => a + n, 0);
  const starts = report.totals.sessionAnon === null ? null : (report.totals.sessionAnon ?? 0) + (report.totals.sessionMember ?? 0);
  const pv = report.totals.pvAnon === null ? null : (report.totals.pvAnon ?? 0) + (report.totals.pvMember ?? 0);
  const median = medianBucket(flow.duration);
  const v = (on: boolean, value: Value) => (on ? value : null);
  const pageRows: Value[][] = [...new Set([...Object.keys(flow.firstPage), ...Object.keys(flow.exitPage)])]
    .map((kind) => {
      const k = kind as PageKind;
      const pageViews = flow.pageViewsSinceFlow[k] ?? 0;
      const exits = flow.exitPage[k] ?? 0;
      return [
        PAGE_KIND_LABELS[k] ?? kind,
        v(startOn, flow.firstPage[k] ?? 0),
        v(flowOn, exits),
        flowOn && flowSessions ? exits / flowSessions : null,
        v(flowOn, pageViews),
        ...DEVICE_KINDS.map((d) => v(flowOn, flow.exitByDevice[d][k] ?? 0)),
      ];
    })
    .sort((a, b) => Number(b[1] ?? 0) - Number(a[1] ?? 0));
  return {
    key: "flow",
    name: "방문 시간·이탈",
    widths: [26, 14, 14, 12, 14, 13, 13, 13, 13],
    tables: [
      {
        title: "요약 (체류·이탈은 추정치)",
        columns: [{ label: "항목", kind: "text" }, { label: "값", kind: "text" }],
        rows: [
          ["방문 시작 (방문 세션)", starts],
          ["체류·이탈 집계 방문", v(flowOn, flowSessions)],
          ["평균 체류 시간 (추정)", v(flowOn, formatSeconds(meanDuration(flow)))],
          ["평균 체류 시간 (초)", v(flowOn, meanDuration(flow))],
          ["체류 시간 중앙값 (구간)", v(flowOn, median ? DURATION_LABELS[median] : "-")],
          ["한 화면만 보고 끝난 방문", v(flowOn, flow.pages["1"])],
          ["한 화면만 보고 끝난 방문 비율 (÷ 체류·이탈 집계 방문)", v(flowOn, flowSessions ? `${((flow.pages["1"] / flowSessions) * 100).toFixed(1)}%` : "-")],
          ["방문당 평균 페이지뷰", starts && pv !== null ? (pv / starts).toFixed(2) : null],
          ["종료 확인 방문", v(flowOn, flow.closed)],
          ["종료 미확인 방문 (다시 오지 않아 끝을 확인 못 함, 대부분 이미 떠남)", v(flowOn, flow.open)],
          ["데이터 점검", v(flowOn, flow.issues.length ? `불일치 ${flow.issues.length}건 (주의사항 참고)` : "이상 없음")],
        ],
      },
      {
        title: "시간대별 방문 시작·추정 종료 (KST)",
        columns: [{ label: "시간대", kind: "text" }, { label: "방문 시작", kind: "int" }, { label: "추정 종료(마지막 활동)", kind: "int" }],
        rows: flow.startHour.map((n, h) => [`${String(h).padStart(2, "0")}시`, v(startOn, n), v(flowOn, flow.endHour[h])]),
      },
      {
        title: "요일별 방문 시작·추정 종료",
        columns: [{ label: "요일", kind: "text" }, { label: "방문 시작", kind: "int" }, { label: "추정 종료", kind: "int" }],
        rows: ["월", "화", "수", "목", "금", "토", "일"].map((d, i) => [d, flow.startDow[i], v(flowOn, flow.endDow[i])]),
      },
      {
        title: "체류 시간 구간별 방문 (추정)",
        columns: [{ label: "체류 시간", kind: "text" }, { label: "전체", kind: "int" }, ...DEVICE_KINDS.map((d) => ({ label: DEVICE_LABELS[d], kind: "int" as const }))],
        rows: DURATION_BUCKETS.map((b) => [DURATION_LABELS[b], v(flowOn, flow.duration[b]), ...DEVICE_KINDS.map((d) => v(flowOn, flow.durationByDevice[d][b]))]),
        total: ["평균 체류(초)", v(flowOn, meanDuration(flow)), ...DEVICE_KINDS.map((d) => v(flowOn, meanDuration(flow, d)))],
      },
      {
        title: "방문당 본 화면 수",
        columns: [{ label: "화면 수", kind: "text" }, { label: "방문", kind: "int" }],
        rows: PAGES_BUCKETS.map((b) => [PAGES_LABELS[b], v(flowOn, flow.pages[b])]),
      },
      {
        title: "화면별 첫 화면·마지막 이용 화면(추정)",
        columns: [
          { label: "화면", kind: "text" },
          { label: "첫 화면(방문 시작)", kind: "int" },
          { label: "마지막 이용 화면(방문)", kind: "int" },
          { label: "마지막 이용 화면 비중(÷ 집계 방문)", kind: "pct" },
          { label: "조회 수(같은 기간, 원시)", kind: "int" },
          ...DEVICE_KINDS.map((d) => ({ label: `이탈(${DEVICE_LABELS[d]})`, kind: "int" as const })),
        ],
        rows: pageRows,
      },
      {
        title: "첫 화면 → 마지막 화면 (상위 30개)",
        columns: [{ label: "첫 화면", kind: "text" }, { label: "마지막 화면", kind: "text" }, { label: "방문", kind: "int" }],
        rows: flowOn ? flow.paths.slice(0, 30).map((p) => [PAGE_KIND_LABELS[p.first], PAGE_KIND_LABELS[p.last], p.sessions]) : [["미측정", "", null]],
      },
    ],
    notes: [
      ...flow.issues.map((issue) => `데이터 불일치: ${issue}`),
      ...FLOW_CAVEATS,
      `방문 시작(시간대·첫 화면)은 ${flow.startSince ?? "수집 전"}부터, 체류·이탈은 ${flow.since ?? "수집 전"}부터 집계되며 그 전은 미측정입니다.`,
    ],
  };
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

export function toSheets(report: Report, label?: string, datasets = datasetsOf(report), notice?: string | null): Sheet[] {
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
    if (notice) wide(`주의: ${notice}`, "meta");
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

export function toXlsx(report: Report, label?: string, users?: UserReport, notice?: string | null): Buffer {
  return buildXlsx(toSheets(report, label, datasetsOf(report, users), notice), { title: "MJU Find 운영 통계", createdAt: new Date() });
}

// One CSV per data kind: "#" lines (service, period, time, caveats) on top
// -- skipped by most tools with a comment option -- then plain tables.
export function toCsv(report: Report, key: DatasetKey, label?: string, users?: UserReport, notice?: string | null): string {
  const ds = datasetsOf(report, users).find((d) => d.key === key);
  if (!ds) throw new Error(`no data for ${key}`);
  // "#" lines are written as they are (never quoted), so a reader's comment
  // option skips each one whole even when it holds a comma.
  const meta = [
    `# MJU Find 운영 통계 - ${ds.name}`,
    `# 통계 기간: ${periodLabel(report, label)}`,
    `# 생성 일시: ${report.generatedAt} (KST)`,
    ...(notice ? [`# 주의: ${notice}`] : []),
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

