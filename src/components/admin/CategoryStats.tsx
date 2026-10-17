import type { CategoryRow } from "@/lib/metrics/categories";
import { More, Section } from "@/components/admin/StatsBlocks";

// 운영 통계 > 카테고리별 현황: the period's lost / found registrations by
// main category -- paired horizontal bars to compare the two types, then the
// table with each type's share and rank (lib/metrics/categories.ts).
// Server-rendered; the bars share one scale so lengths compare across rows.

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

export function CategoryStats({ rows, periodLabel }: { rows: CategoryRow[]; periodLabel: string }) {
  const lostTotal = rows.reduce((a, r) => a + r.lost, 0);
  const foundTotal = rows.reduce((a, r) => a + r.found, 0);
  const shown = rows.filter((r) => r.total > 0);
  const max = Math.max(1, ...rows.flatMap((r) => [r.lost, r.found]));

  return (
    <Section
      title="카테고리별 현황"
      description={`${periodLabel}에 등록된 분실물 ${fmt(lostTotal)}건·습득물 ${fmt(foundTotal)}건을 대분류별로 나눴습니다. 서비스 이용의 게시글 등록과 같은 기준입니다.`}
    >
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">이 기간에 등록된 게시글이 없습니다.</p>
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
          <li>기간 중 등록된 게시글을 대분류로 셉니다. 관리자가 임시 숨김한 글은 포함하고, 삭제된 글은 남은 기록이 없어 빠집니다(운영 요약과 같음).</li>
          <li>미분류: 아직 대분류가 정해지지 않은 글(카테고리 체계 이전에 등록된 글 등). 현재 체계에 없는 분류는 따로 표시합니다.</li>
          <li>비율은 같은 유형 안에서의 비율, 순위는 유형별 건수 순위입니다(같은 건수는 같은 순위, 0건은 –).</li>
        </ul>
      </More>
    </Section>
  );
}
