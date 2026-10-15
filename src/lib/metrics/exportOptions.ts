// The kinds of data in the 운영 통계 export: the Excel file's six sheets, or
// one CSV file each. Kept apart from export.ts so the export panel (a client
// component) can list them without pulling in the file builders.
export const DATASETS = [
  { key: "summary", name: "운영 요약" },
  { key: "visits", name: "방문 통계" },
  { key: "referrals", name: "유입 분석" },
  { key: "usage", name: "서비스 이용" },
  { key: "completed", name: "완료 처리" },
  { key: "server", name: "서버 운영" },
] as const;
export type DatasetKey = (typeof DATASETS)[number]["key"];
