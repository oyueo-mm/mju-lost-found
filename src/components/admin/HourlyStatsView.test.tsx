import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { buildCells } = await import("@/lib/metrics/hourly");
const { HourlyStatsView } = await import("./HourlyStatsView");
const { HourHeatmap } = await import("./StatsCharts");
const { hourlyDataset } = await import("@/lib/metrics/export");

// 2026-10-17 14:30 KST; anonymous hourly views began 10/17 09:05
const NOW = new Date("2026-10-17T05:30:00Z");
const starts = {
  pvMember: { day: "2026-10-16", minute: 17 * 60 + 27 },
  pvAnon: { day: "2026-10-17", minute: 9 * 60 + 5 },
  session: { day: "2026-10-16", minute: null },
  active: { day: "2026-10-17", minute: 9 * 60 + 5 },
  login: { day: "2026-10-16", minute: 17 * 60 + 27 },
};
const rows = [
  { day: "2026-10-16", metric: "visit.member.hour.20", n: 4 },
  { day: "2026-10-17", metric: "visit.member.hour.10", n: 3 },
  { day: "2026-10-17", metric: "visit.anon.hour.10", n: 12 },
  { day: "2026-10-17", metric: "visit.start.hour.10", n: 5 },
  { day: "2026-10-17", metric: "active.member.hour.10", n: 2 },
];
const cells = buildCells(["2026-10-16", "2026-10-17"], rows, starts, NOW);

const dayCells = (days: string[]) => buildCells(days, rows, starts, NOW);
function render(metric: "pv" | "active" = "pv", c = cells) {
  return renderToStaticMarkup(
    <HourlyStatsView
      cells={c}
      metric={metric}
      hrefWith={(m) => `/admin/stats?period=week&d=x&m=${m}`}
      today="2026-10-17"
      picker={<div data-testid="picker" />}
      actions={<div data-testid="actions" />}
    />,
  );
}
const lines = (markup: string) => (markup.match(/<polyline/g) ?? []).length;

describe("HourHeatmap", () => {
  it("draws 미측정, 부분 측정, a measured 0 and hours still to come differently, as a readable table", () => {
    const markup = renderToStaticMarkup(
      <HourHeatmap
        title="페이지뷰"
        unit="회"
        rows={[
          {
            label: "10/17(토)",
            values: [null, 0, 3, 12, ...Array(20).fill(null)],
            status: ["none", "full", "partial", "full", ...Array(20).fill("future")],
            extras: ["15", "-", "15"],
          },
        ]}
        extraLabels={["오전", "오후", "합계"]}
      />,
    );
    expect(markup).toContain("<table");
    expect(markup).toContain('scope="row"');
    expect(markup).toContain('title="10/17(토) 0시: 미측정"');
    expect(markup).toContain('title="10/17(토) 1시: 0회"');
    expect(markup).toContain('title="10/17(토) 2시: 3회 (부분 측정)"');
    expect(markup).toContain('title="10/17(토) 23시: 아직 지나지 않음"');
    // legend: every state that appears, and the scale's top
    for (const label of ["미측정(수집 전)", "부분 측정", "아직 지나지 않음", "0회", "최대 12회"]) expect(markup).toContain(label);
    // the largest cell gets the darkest shade
    expect(markup).toContain("var(--chart-1) 55%");
  });
});

describe("시간대 분석 view: drawn by how many days are chosen", () => {
  it("shows totals by login state, the busiest hour, the metric switch, the calendar and the downloads", () => {
    const markup = render();
    expect(markup).toContain("시간대 분석");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("/admin/stats?period=week&amp;d=x&amp;m=active");
    expect(markup).toContain('data-testid="picker"');
    expect(markup).toContain('data-testid="actions"');
    expect(markup).toContain("(부분)"); // the unmeasured part stays visible
  });

  it("asks for days when none is chosen", () => {
    expect(render("pv", dayCells([]))).toContain("달력에서 날짜를 골라 주세요.");
  });

  it("one day: its own hours as bars, up to the current hour when it is today, with 오전/오후", () => {
    const markup = render("pv", dayCells(["2026-10-17"]));
    expect(markup).toContain("10/17(토) 페이지뷰(전체) · 시간대별");
    expect(markup).toContain("오늘(10/17)은 14시까지의 값입니다.");
    expect(markup).toContain("오전 (0~11시)");
    expect(markup).not.toContain("15시</span>"); // hours to come are left off the axis
    expect(lines(markup)).toBe(0);
    expect(markup).not.toContain("<table class=\"w-full min-w-[46rem]"); // no heatmap
  });

  it("2-4 days: one line per day and the 오전/오후 table", () => {
    const markup = render("pv", dayCells(["2026-10-13", "2026-10-16", "2026-10-17"]));
    expect(markup).toContain("페이지뷰(전체) · 날짜별 비교");
    expect(markup).toContain("10/13(화)");
    expect(markup).toContain("오후 (12~23시)");
    expect(markup).not.toContain("min-w-[46rem]");
  });

  it("5+ days, not in a row: every chosen day in the heatmap (none dropped, none added) plus the hours added up", () => {
    const days = ["2026-10-01", "2026-10-03", "2026-10-09", "2026-10-12", "2026-10-16", "2026-10-17"];
    const markup = render("active", dayCells(days));
    expect(markup).toContain("min-w-[46rem]");
    for (const label of ["10/1(목)", "10/3(토)", "10/9(금)", "10/12(월)", "10/16(금)", "10/17(토)"]) expect(markup).toContain(`>${label}</th>`);
    expect(markup).not.toContain(">10/2(금)</th>");
    expect(markup).toContain("10/1, 10/3, 10/9, 10/12, 10/16~10/17");
    expect(markup).toContain("고른 6일의 시간대별 합계");
    expect(markup).toContain("회원·시간");
    expect(lines(markup)).toBe(0); // no tangle of six lines
  });
});

describe("one basis for the compare chart, the heatmap and the export", () => {
  it("gives a day the same cells whether it is chosen with others or alone, and the export the same numbers", async () => {
    const { halves, HOURLY_METRICS } = await import("@/lib/metrics/hourly");
    const alone = buildCells(["2026-10-17"], rows, starts, NOW);
    const rowsOut = hourlyDataset(cells).tables[0].rows.filter((r) => r[0] === "2026-10-17");
    HOURLY_METRICS.forEach((m, k) => {
      expect(alone.metrics[m.key].values[0]).toEqual(cells.metrics[m.key].values[1]);
      expect(alone.metrics[m.key].status[0]).toEqual(cells.metrics[m.key].status[1]);
      // export columns follow HOURLY_METRICS after 날짜·시간; hours to come are left out
      expect(rowsOut.map((r) => r[2 + k])).toEqual(cells.metrics[m.key].values[1].slice(0, 15));
      // the heatmap's / compare table's 합계 = the export's hours added up
      const day = halves(cells.metrics[m.key], 1).day.value;
      const sum = rowsOut.reduce<number | null>((a, r) => (r[2 + k] === null ? a : (a ?? 0) + (r[2 + k] as number)), null);
      expect(day).toBe(sum);
    });
  });
});

describe("내보내기: 날짜·시간대별", () => {
  it("writes one row per past hour, 미측정 as blank (never 0), and the totals by hour", () => {
    const ds = hourlyDataset(cells);
    expect(ds.name).toBe("날짜·시간대별");
    const [byDayHour, byHourTotal] = ds.tables;
    // 10/16: 24 hours; 10/17: 0~14시 (15시부터는 아직)
    expect(byDayHour.rows).toHaveLength(24 + 15);
    const row = (day: string, hour: number) => byDayHour.rows.find((r) => r[0] === day && r[1] === `${hour}시`)!;
    // columns: 날짜, 시간, 페이지뷰(전체), 회원, 비로그인, 방문 세션, 활성 회원, 로그인 완료, 측정 상태
    expect(row("2026-10-17", 10)).toEqual(["2026-10-17", "10시", 15, 3, 12, 5, 2, 0, ""]);
    expect(row("2026-10-16", 20)).toEqual(["2026-10-16", "20시", 4, 4, null, 0, null, 0, "부분 측정 포함"]);
    expect(row("2026-10-16", 3)[3]).toBeNull(); // member views before their start: 미측정
    expect(byHourTotal.rows[10].slice(0, 3)).toEqual(["10시", 15, 3]);
    expect(ds.notes.join(" ")).toContain("회원·시간");
  });
});
