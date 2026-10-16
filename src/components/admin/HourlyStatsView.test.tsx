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

function render(metric: "pv" | "active" = "pv", compare = cells) {
  return renderToStaticMarkup(
    <HourlyStatsView
      range={cells}
      compare={compare}
      metric={metric}
      compareDays={[]}
      hrefWith={({ m, d }) => `/admin/stats?tab=hourly&m=${m ?? metric}${(d ?? []).map((x) => `&d=${x}`).join("")}`}
      hiddenFields={[{ name: "tab", value: "hourly" }, { name: "period", value: "week" }]}
      today="2026-10-17"
    />,
  );
}

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

describe("시간대 분석 view", () => {
  it("shows totals by login state, the busiest hour, and the metric switch", () => {
    const markup = render();
    expect(markup).toContain("시간대 분석");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("/admin/stats?tab=hourly&amp;m=active");
    expect(markup).toContain("10시"); // the busiest hour
    // the period total keeps the unmeasured part visible
    expect(markup).toContain("(부분)");
    // compare form keeps the period and tab
    expect(markup).toContain('name="period" value="week"');
    expect(markup.split('name="d"').length - 1).toBe(4);
  });

  it("explains that hourly active members added up are member-hours, not people", () => {
    const markup = render("active");
    expect(markup).toContain("회원·시간");
    expect(markup).toContain("시간대별 활성 회원");
  });

  it("compares chosen days with 오전/오후 totals and says when today is still running", () => {
    const markup = render("pv");
    expect(markup).toContain("오전 (0~11시)");
    expect(markup).toContain("오후 (12~23시)");
    expect(markup).toContain("오늘(10/17)은 14시까지의 값입니다.");
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
