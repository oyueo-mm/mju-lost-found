import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import { EventPeriodFilter } from "./EventPeriodFilter";
import type { PeriodState } from "./periodParams";

function render(value: PeriodState, boardType: "lost" | "found" | "all" = "found") {
  return renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <EventPeriodFilter value={value} onChange={() => {}} boardType={boardType} />
    </I18nProvider>,
  );
}

const custom = (from: string, to: string): PeriodState => ({ period: "custom", from, to, includeUnknown: false });

describe("EventPeriodFilter", () => {
  it("labels the control with the board's own time field", () => {
    expect(render({ period: "", from: "", to: "", includeUnknown: false }, "lost")).toContain('aria-label="분실 시점"');
    expect(render({ period: "", from: "", to: "", includeUnknown: false }, "found")).toContain('aria-label="습득 시점"');
    expect(render({ period: "", from: "", to: "", includeUnknown: false }, "all")).toContain('aria-label="분실·습득 시점"');
  });

  it("renders the custom dates without min/max, so the browser adds no validation bubble of its own", () => {
    const markup = render(custom("2026-09-25", "2026-09-20"));
    const dateInputs = markup.match(/<input[^>]*type="date"[^>]*>/g) ?? [];
    expect(dateInputs).toHaveLength(2);
    for (const input of dateInputs) {
      expect(input).not.toMatch(/\smin=/);
      expect(input).not.toMatch(/\smax=/);
    }
  });

  it("still shows its own inline message for an inverted range", () => {
    expect(render(custom("2026-09-25", "2026-09-20"))).toContain("종료일은 시작일보다 빠를 수 없어요.");
    expect(render(custom("2026-09-20", "2026-09-25"))).not.toContain('role="alert"');
  });

  it("stacks the dates and hides the ~ below sm, keeping the desktop row", () => {
    const markup = render(custom("2026-09-20", "2026-09-25"));
    expect(markup).toContain("flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center");
    expect(markup).toMatch(/<span aria-hidden="true" class="hidden [^"]*sm:inline">~<\/span>/);
  });

  it("shows 시간 모름 포함 only while a period is selected", () => {
    expect(render({ period: "", from: "", to: "", includeUnknown: false })).not.toContain("시간 모름 포함");
    expect(render({ period: "1w", from: "", to: "", includeUnknown: false })).toContain("시간 모름 포함");
  });
});
