import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/stats",
  useSearchParams: () => new URLSearchParams("period=week"),
}));

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
function render(metric: "pv" | "active" | "login" | "session" | "all" = "pv", c = cells) {
  return renderToStaticMarkup(
    <HourlyStatsView
      cells={c}
      metric={metric}
      today="2026-10-17"
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

const at = (markup: string, needle: string) => {
  const i = markup.indexOf(needle);
  if (i < 0) throw new Error(`missing: ${needle}`);
  return i;
};
const nDays = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(17 - n + 1 + i).padStart(2, "0")}`);

describe("시간대 분석 layout: filters, then charts, summary, 오전·오후, downloads", () => {
  it("puts the metric dropdown and the date button right above the charts, the summary and downloads after them", () => {
    const markup = render("pv", dayCells(["2026-10-16", "2026-10-17"]));
    const filters = at(markup, "<select");
    const button = at(markup, "날짜 선택 · 2일");
    const chart = at(markup, "<figure");
    const summary = at(markup, "페이지뷰(전체) 요약");
    const halfDay = at(markup, "날짜별 오전·오후");
    const downloads = at(markup, 'data-testid="actions"');
    expect(filters < button && button < chart && chart < summary && summary < halfDay && halfDay < downloads).toBe(true);
    // the calendar is a closed popover: no grid between the filters and the chart
    expect(markup).toMatch(/role="dialog" aria-label="날짜 선택" hidden=""/);
    expect(markup).toContain("10/16~10/17");
  });

  it("one dropdown: six metrics and 전체 지표 보기, the current one selected", () => {
    const markup = render("session");
    const options = [...markup.matchAll(/<option value="([a-zA-Z]+)"( selected="")?>([^<]+)<\/option>/g)];
    expect(options.map((o) => o[3])).toEqual(["페이지뷰(전체)", "로그인 회원 페이지뷰", "비로그인 페이지뷰", "방문 세션(시작)", "시간대별 활성 회원", "로그인 완료", "전체 지표 보기"]);
    expect(options.find((o) => o[2])?.[1]).toBe("session");
  });

  it("asks for days when none is chosen", () => {
    expect(render("pv", dayCells([]))).toContain("날짜 선택에서 날짜를 골라 주세요.");
  });

  it("1 day: its hours as bars (to the current hour when it is today), then 오전/오후", () => {
    const markup = render("pv", dayCells(["2026-10-17"]));
    expect(markup).toContain("페이지뷰(전체) · 10/17(토)");
    expect(markup).toContain("오늘(10/17)은 14시까지의 값입니다.");
    expect(markup).toContain("오전 (0~11시)");
    expect(lines(markup)).toBe(0);
    expect(markup).not.toContain("min-w-[46rem]"); // no heatmap
  });

  it("2-7 days: one line per day, each in its own colour, the dates in the title and legend", () => {
    const markup = render("pv", dayCells(nDays(7)));
    expect(markup).toContain("페이지뷰(전체) · 10/11~10/17");
    // seven days, seven legend colours (unmeasured days keep theirs, with no line drawn)
    for (const tone of [1, 2, 3, 5, 6, 7, 8]) expect(markup).toContain(`bg-chart-${tone}`);
    expect(markup).not.toContain("chart-4"); // the neutral grey never stands for a day
    expect(markup).toContain("stroke-chart-7"); // 10/16, measured
    expect(markup).toContain("stroke-chart-8"); // 10/17
    expect(markup).toContain(">10/11(일)<");
    expect(markup).not.toContain("min-w-[46rem]");
  });

  it("8+ days, not in a row: every chosen day in the heatmap (none dropped, none added) plus the hours added up", () => {
    const days = ["2026-10-01", "2026-10-03", "2026-10-09", "2026-10-11", "2026-10-12", "2026-10-14", "2026-10-16", "2026-10-17"];
    const markup = render("active", dayCells(days));
    expect(markup).toContain("min-w-[46rem]");
    for (const d of days) expect(markup).toContain(`>${Number(d.slice(5, 7))}/${Number(d.slice(8))}(`);
    expect(markup).not.toContain(">10/2(금)</th>");
    expect(markup).toContain("10/1, 10/3, 10/9, 10/11~10/12, 10/14, 10/16~10/17");
    expect(markup).toContain("8일의 시간대별 합계");
    expect(markup).toContain("날짜별 오전·오후 표 (8일)"); // folded away under the charts
    expect(lines(markup)).toBe(0);
  });
});

describe("시간대 분석 summary: about the chosen metric and days only", () => {
  const tiles = (markup: string) => [...markup.matchAll(/<span class="text-xs font-medium text-muted-foreground">([^<]+)<\/span>/g)].map((m) => m[1]);

  it("three cards that all follow the metric: total, busiest hour of day, measured range", () => {
    const pv = render("pv");
    expect(tiles(pv)).toEqual(["페이지뷰 합계", "최다 이용 시간대", "측정 범위"]);
    expect(pv).toContain("2/2일"); // both days have measured hours
    const session = render("session");
    expect(tiles(session)).toEqual(["방문 세션 합계", "최다 이용 시간대", "측정 범위"]);
    expect(session).toContain("5회");
    // 활성 회원: the most in one hour, never a sum of people
    const active = render("active");
    expect(tiles(active)[0]).toBe("한 시간 최다 활성 회원");
    expect(active).toContain("2명");
    expect(active).toContain("회원·시간, 사람 수 아님");
  });

  it("nothing measured: one line instead of a row of 미측정 cards", () => {
    const login = render("login", dayCells(["2026-10-14", "2026-10-15"]));
    expect(tiles(login)).toEqual([]);
    expect(login).toContain("고른 2일은 <b class=\"font-semibold text-foreground\">로그인 완료</b> 수집 전이라 모두");
  });

  it("전체 지표 보기: one summary row per metric, unmeasured ones as one short cell", () => {
    const all = render("all", dayCells(["2026-10-15", "2026-10-16", "2026-10-17"]));
    expect(all).toContain('<option value="all" selected="">전체 지표 보기</option>');
    expect(all).toContain("고른 날짜의 지표별 요약");
    expect(all).toMatch(/비로그인 페이지뷰<\/th><td colSpan="3"|비로그인 페이지뷰<\/th><td[^>]*>[0-9]/);
  });
});

describe("시간대 분석 charts", () => {
  it("a line per day keeps its colour and its 부분 측정 / to-come points per point", () => {
    const markup = render("pv", dayCells(["2026-10-16", "2026-10-17"]));
    expect(markup).toContain("10/16(금)");
    expect(markup).toContain("10/17(토)");
    expect(markup).toContain("stroke-chart-1");
    expect(markup).toContain("stroke-chart-2");
    expect(markup).toContain("아직 지나지 않음"); // 10/17 after 14시, in the hover card
    expect(markup).toContain("border-chart-1"); // hollow dot: 10/16 member views counted in part
    expect(markup).toContain("속이 빈 점은 부분 측정");
  });

  it("전체 지표 보기, up to 7 days: one small chart per metric, each with its own unit, the same colour per day", () => {
    const markup = render("all", dayCells(["2026-10-16", "2026-10-17"]));
    for (const t of ["페이지뷰(전체)", "방문 세션(시작)", "시간대별 활성 회원", "로그인 완료"]) expect(markup).toContain(`>${t} · 10/16~10/17<span class="ml-1 font-normal text-muted-foreground">(단위: `);
    expect(markup).toContain("(단위: 명)");
    expect(lines(markup)).toBeGreaterThanOrEqual(4);
    // 10/16 is chart-1, 10/17 chart-2 in every chart; 활성 회원 has no 10/16
    // line (not measured yet), never a line at 0
    expect(markup.match(/stroke-chart-1/g)).toHaveLength(3);
    expect(markup.match(/stroke-chart-2/g)).toHaveLength(4);
    expect(markup).toContain("md:grid-cols-2"); // stacked on a phone
  });

  it("전체 지표 보기, 8+ days: the hours added up per metric instead of tangled lines", () => {
    const markup = render("all", dayCells(nDays(8)));
    expect(lines(markup)).toBe(0);
    expect(markup).toContain("방문 세션(시작) · 8일 합계");
    expect(markup).toContain("지표 하나를 고르세요");
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
