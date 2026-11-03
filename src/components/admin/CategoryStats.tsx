import Link from "next/link";

import {
  CATEGORY_BASES,
  CATEGORY_BASIS_LABELS,
  CATEGORY_SCOPES,
  CATEGORY_SCOPE_LABELS,
  type CategoryBasis,
  type CategoryReport,
  type CategoryScope,
} from "@/lib/metrics/categories";
import { More, Section } from "@/components/admin/StatsBlocks";

// 운영 통계 > 카테고리별 현황: lost / found posts by main category -- paired
// horizontal bars to compare the two types, then the table with each type's
// share and rank (lib/metrics/categories.ts). An item count: 전체 by default,
// narrowed to 일반 사용자 / 관리자 posts, over the period or everything (누적).
// Server-rendered; the switches are links (`cs`, `cb`), the bars share one
// scale so lengths compare across rows.

export const CATEGORY_ANCHOR = "category-stats";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(1)}%`);
const rank = (v: number | null) => (v === null ? "–" : `${v}위`);

function Bar({ value, max, tone, label }: { value: number; max: number; tone: "bg-chart-1" | "bg-chart-2"; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        {value > 0 && <div className={`h-full min-w-1 rounded-full ${tone}`} style={{ width: `${(value / max) * 100}%` }} />}
      </div>
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-foreground">
        <span className="sr-only">{label} </span>
        {fmt(value)}
      </span>
    </div>
  );
}

function Switch<T extends string>({ label, options, labels, active, href }: { label: string; options: readonly T[]; labels: Record<T, string>; active: T; href: (v: T) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div role="group" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5">
        {options.map((v) => (
          <Link
            key={v}
            href={href(v)}
            scroll={false}
            aria-current={v === active ? "true" : undefined}
            className={`inline-flex min-h-8 items-center rounded-md px-2.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              v === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {labels[v]}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function CategoryStats({
  report,
  scope,
  basis,
  periodLabel,
  query,
}: {
  report: CategoryReport;
  scope: CategoryScope;
  basis: CategoryBasis;
  periodLabel: string;
  // the page's other parameters, kept by the switches
  query: string;
}) {
  const rows = report.views[basis][scope];
  const lostTotal = rows.reduce((a, r) => a + r.lost, 0);
  const foundTotal = rows.reduce((a, r) => a + r.found, 0);
  const shown = rows.filter((r) => r.total > 0);
  const max = Math.max(1, ...rows.flatMap((r) => [r.lost, r.found]));
  const unknown = report.unclassifiedAudience[basis];
  const href = (cs: CategoryScope, cb: CategoryBasis) => `/admin/stats?${query ? `${query}&` : ""}cs=${cs}&cb=${cb}#${CATEGORY_ANCHOR}`;
  const whenText = basis === "period" ? `${periodLabel}에 등록된` : "지금까지 등록되어 남아 있는";
  const whoText = scope === "all" ? "관리자·일반 사용자" : CATEGORY_SCOPE_LABELS[scope];

  return (
    <div id={CATEGORY_ANCHOR} className="scroll-mt-20">
    <Section
      title="카테고리별 현황"
      description={
        <>
          <p>
            {whenText} {whoText} 게시글 — 분실물 {fmt(lostTotal)}건·습득물 {fmt(foundTotal)}건을 대분류별로 나눴습니다.
          </p>
          <p className="mt-1">물품 현황이라 기본으로 관리자 게시글도 셉니다. 위 서비스 이용의 게시글 등록은 일반 사용자 활동만 세므로 &lsquo;일반 사용자 · 조회 기간 등록&rsquo;과 같습니다.</p>
          {scope === "all" && unknown > 0 && <p className="mt-1">작성 당시 역할을 확인할 수 없는 게시글 {fmt(unknown)}건은 전체에만 포함됩니다.</p>}
        </>
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
        <Switch label="집계 범위" options={CATEGORY_SCOPES} labels={CATEGORY_SCOPE_LABELS} active={scope} href={(v) => href(v, basis)} />
        <Switch label="기준" options={CATEGORY_BASES} labels={CATEGORY_BASIS_LABELS} active={basis} href={(v) => href(scope, v)} />
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{basis === "period" ? "이 기간에 등록된 게시글이 없습니다." : "등록된 게시글이 없습니다."}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-hidden>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px] bg-chart-1" /> 분실물
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px] bg-chart-2" /> 습득물
            </span>
            <span>(건, 합계 많은 순)</span>
          </div>
          <ul className="flex flex-col gap-3" aria-label="카테고리별 분실물·습득물 등록 비교">
            {shown.map((r) => (
              <li key={r.code ?? "unclassified"} className="grid grid-cols-[minmax(4.5rem,7.5rem)_1fr] items-center gap-x-3 gap-y-1 text-xs">
                <span className="break-keep text-foreground [overflow-wrap:anywhere]">{r.label}</span>
                <div className="flex min-w-0 flex-col gap-1">
                  <Bar value={r.lost} max={max} tone="bg-chart-1" label="분실물" />
                  <Bar value={r.found} max={max} tone="bg-chart-2" label="습득물" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* relative: keeps the sr-only caption inside the scroll box */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] text-right text-xs tabular-nums">
          <caption className="sr-only">카테고리별 분실물·습득물 등록 건수, 비율, 순위</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" rowSpan={2} className="py-1.5 pr-2 text-left align-bottom font-medium">
                카테고리
              </th>
              <th scope="colgroup" colSpan={3} className="py-1 pr-2 text-center font-medium">
                분실물
              </th>
              <th scope="colgroup" colSpan={3} className="py-1 pr-2 text-center font-medium">
                습득물
              </th>
              <th scope="col" rowSpan={2} className="py-1.5 pr-2 align-bottom font-medium">
                합계
              </th>
            </tr>
            <tr>
              {["건수", "비율", "순위", "건수", "비율", "순위"].map((h, i) => (
                <th key={i} scope="col" className="py-1 pr-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code ?? "unclassified"} className="border-t border-border">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-foreground">
                  {r.label}
                </th>
                <td className="py-1.5 pr-2 text-foreground">{fmt(r.lost)}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{pct(r.lostShare)}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{rank(r.lostRank)}</td>
                <td className="py-1.5 pr-2 text-foreground">{fmt(r.found)}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{pct(r.foundShare)}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">{rank(r.foundRank)}</td>
                <td className="py-1.5 pr-2 font-medium text-foreground">{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-medium text-foreground">
              <th scope="row" className="py-1.5 pr-2 text-left">
                합계
              </th>
              <td className="py-1.5 pr-2">{fmt(lostTotal)}</td>
              <td className="py-1.5 pr-2">{lostTotal ? "100%" : "–"}</td>
              <td />
              <td className="py-1.5 pr-2">{fmt(foundTotal)}</td>
              <td className="py-1.5 pr-2">{foundTotal ? "100%" : "–"}</td>
              <td />
              <td className="py-1.5 pr-2">{fmt(lostTotal + foundTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <More label="집계 기준">
        <ul className="flex list-disc flex-col gap-1 pl-4">
          <li>전체 = 관리자와 일반 사용자가 등록한 모든 게시글. 일반 사용자·관리자는 작성 당시 역할 기준이며, 역할 기록 도입(2026-11-03) 전 글은 관리자 지정·해제 이력으로 당시 역할을 확인합니다. 확인할 수 없는 글은 어느 쪽으로도 추측하지 않고 전체에만 넣습니다.</li>
          <li>조회 기간 등록 = 기간 중 작성된 글, 전체 누적 = 지금 남아 있는 모든 글. 관리자가 임시 숨김한 글은 포함하고, 삭제된 글은 남은 기록이 없어 빠집니다.</li>
          <li>미분류: 아직 대분류가 정해지지 않은 글. 현재 체계에 없는 분류는 따로 표시합니다.</li>
          <li>이 순위는 통계일 뿐이며, 등록·검색 화면의 카테고리 순서는 고정되어 있어 통계에 따라 바뀌지 않습니다.</li>
          <li>비율은 같은 유형 안에서의 비율, 순위는 유형별 건수 순위입니다(같은 건수는 같은 순위, 0건은 –).</li>
        </ul>
      </More>
    </Section>
    </div>
  );
}
