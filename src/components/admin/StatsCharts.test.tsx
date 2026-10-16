import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GroupedBarChart, LineChart, StackedBarChart } from "./StatsCharts";

const count = (markup: string, needle: string) => markup.split(needle).length - 1;
// visible y-axis tick labels (the gutter's absolutely placed spans)
const ticks = (markup: string) => [...markup.matchAll(/translate-y-1\/2 text-\[10px\][^>]*>([^<]+)</g)].map((m) => m[1]);

describe("StatsCharts", () => {
  it("labels every integer on the y-axis when values are small", () => {
    const markup = renderToStaticMarkup(
      <StackedBarChart title="신규 가입" unit="명" labels={["10/1", "10/2", "10/3"]} series={[{ label: "신규 가입", values: [1, 2, 0], tone: 1 }]} />,
    );
    expect(ticks(markup)).toEqual(["0", "1", "2"]);
    expect(markup).toContain("(단위: 명)");
    // the measured 0 is explained in the legend
    expect(markup).toContain(">0명</span>");
  });

  it("keeps 미측정, 부분 측정 and a measured 0 apart", () => {
    const markup = renderToStaticMarkup(
      <StackedBarChart
        title="활성 회원"
        labels={["10/1", "10/2", "10/3", "10/4"]}
        coverage={["none", "partial", "full", "full"]}
        series={[{ label: "활성", values: [null, 2, 0, 3], tone: 1 }]}
      />,
    );
    // one hatched band for the unmeasured period, labelled in the legend
    expect(count(markup, "chart-hatch absolute")).toBe(1);
    expect(markup).toContain("미측정(수집 전)");
    // the partial bar is hatched and faded, and the legend says so
    expect(markup).toContain("chart-hatch-on absolute inset-0");
    expect(markup).toContain("부분 측정");
    // the measured 0 is a baseline tick, not a bar
    expect(count(markup, "h-[3px] shrink-0 rounded-full")).toBe(1);
    // screen-reader table keeps all three readable
    expect(markup).toContain("<td>미측정</td>");
    expect(markup).toContain("10/2 (부분 측정)");
  });

  it("shows a legend only for two or more series", () => {
    const one = renderToStaticMarkup(<GroupedBarChart title="요일별 가입" labels={["월", "화"]} series={[{ label: "가입", values: [1, 0], tone: 1 }]} />);
    const two = renderToStaticMarkup(
      <GroupedBarChart
        title="방문"
        labels={["월", "화"]}
        series={[
          { label: "방문 시작", values: [3, 1], tone: 1 },
          { label: "추정 종료", values: [2, 1], tone: 2 },
        ]}
      />,
    );
    expect(count(one, "size-2.5 shrink-0 rounded-[3px] bg-chart-1")).toBe(0);
    expect(two).toContain("방문 시작");
    expect(count(two, "size-2.5 shrink-0 rounded-[3px] bg-chart-2")).toBeGreaterThan(0);
  });

  it("marks the period still running in its hover card", () => {
    const markup = renderToStaticMarkup(
      <LineChart title="누적 가입" labels={["10/1", "10/2"]} inProgress series={[{ label: "누적 가입", values: [4, 5], tone: 1 }]} />,
    );
    expect(count(markup, "진행 중")).toBe(1);
    expect(markup).toContain("<polyline");
  });
});
