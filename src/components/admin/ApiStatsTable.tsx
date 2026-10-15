"use client";

import { useMemo, useState } from "react";

// API 응답 시간·오류율 (/admin/stats): the server hands over the period's
// rows; searching, the method filter, "errors only" and sorting happen
// here without another request. Wide screens get a table, phones a card
// per API.
export type ApiStatRow = {
  route: string;
  method: string;
  path: string;
  note: string;
  count: number;
  errors: number;
  avgMs: number;
  p50: string;
  p95: string;
  p95Ms: number | null;
};

const SORTS = [
  { key: "count", label: "요청 수" },
  { key: "avg", label: "평균 응답 시간" },
  { key: "p95", label: "p95" },
  { key: "errorRate", label: "오류율" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

const fmt = (n: number) => n.toLocaleString("ko-KR");
const rate = (r: ApiStatRow) => (r.count ? r.errors / r.count : 0);
const rateText = (r: ApiStatRow) => (r.count ? `${((r.errors / r.count) * 100).toFixed(1)}%` : "-");

export function ApiStatsTable({ rows, empty }: { rows: ApiStatRow[]; empty: string }) {
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("count");
  const methods = useMemo(() => [...new Set(rows.map((r) => r.method))].sort(), [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const value = (r: ApiStatRow) =>
      sort === "count" ? r.count : sort === "avg" ? r.avgMs : sort === "p95" ? (r.p95Ms ?? -1) : rate(r);
    return rows
      .filter((r) => method === "all" || r.method === method)
      .filter((r) => !errorsOnly || r.errors > 0)
      .filter((r) => !q || r.route.toLowerCase().includes(q) || r.note.toLowerCase().includes(q))
      .sort((a, b) => value(b) - value(a) || b.count - a.count);
  }, [rows, query, method, errorsOnly, sort]);

  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  const field = "rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
          경로·기능 검색
          <input type="search" className={field} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 채팅, /api/posts" />
        </label>
        <label className="flex flex-col gap-1">
          HTTP 메서드
          <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="all">전체</option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          정렬 (높은 순)
          <select className={field} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end py-2 text-foreground sm:col-span-2 lg:col-span-1">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          오류 발생 API만 보기
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground" role="status">
        {fmt(shown.length)}개 / 전체 {fmt(rows.length)}개
      </p>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">조건에 맞는 API가 없습니다.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {shown.map((r) => (
              <li key={r.route} className="rounded-card border border-border p-3 text-xs">
                <p className="font-medium text-foreground">{r.note}</p>
                <p className="mt-0.5 font-mono text-[11px] break-all text-muted-foreground">{r.route}</p>
                <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 tabular-nums">
                  <div>
                    <dt className="text-muted-foreground">요청</dt>
                    <dd className="text-foreground">{fmt(r.count)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">오류율</dt>
                    <dd className={r.errors > 0 ? "text-destructive" : "text-foreground"}>{rateText(r)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">평균</dt>
                    <dd className="text-foreground">{fmt(r.avgMs)}ms</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">p50</dt>
                    <dd className="text-foreground">{r.p50}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">p95</dt>
                    <dd className="text-foreground">{r.p95}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">경로</th>
                  <th className="py-1.5 pr-3 font-medium">비고</th>
                  <th className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">요청</th>
                  <th className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">오류율</th>
                  <th className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">평균</th>
                  <th className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">p50</th>
                  <th className="py-1.5 text-right font-medium whitespace-nowrap">p95</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.route} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3 font-mono text-[11px] break-all text-foreground">{r.route}</td>
                    <td className="py-1.5 pr-3 text-foreground">{r.note}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.count)}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums ${r.errors > 0 ? "text-destructive" : ""}`}>{rateText(r)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">{fmt(r.avgMs)}ms</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">{r.p50}</td>
                    <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{r.p95}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
