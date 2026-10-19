// The kinds of data in the 운영 통계 export: the Excel file's sheets, or
// one CSV file each. Kept apart from export.ts so the export panel (a client
// component) can list them without pulling in the file builders.
export const DATASETS = [
  { key: "summary", name: "운영 요약" },
  { key: "visits", name: "방문 통계" },
  { key: "referrals", name: "유입 분석" },
  { key: "usage", name: "서비스 이용" },
  { key: "categories", name: "카테고리별 현황" },
  { key: "completed", name: "완료 처리" },
  { key: "server", name: "서버 운영" },
  { key: "flow", name: "방문 시간·이탈" },
  { key: "users", name: "사용자 통계" },
  { key: "hourly", name: "날짜·시간대별" },
  { key: "dayVisits", name: "날짜별 방문 상세" },
  { key: "inflow", name: "유입 경로" },
] as const;
export type DatasetKey = (typeof DATASETS)[number]["key"];

// 조회 기간 presets (KST) -- shared by the page, the export panel and the
// export action; resolved by lib/metrics/report.ts resolvePeriod().
export const PERIOD_PRESETS = [
  { key: "today", label: "오늘" },
  { key: "week", label: "이번 주" },
  { key: "month", label: "이번 달" },
  { key: "year", label: "올해" },
  { key: "custom", label: "사용자 지정" },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["key"];
