import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/stats",
  useSearchParams: () => new URLSearchParams("period=month"),
}));

import { HourlyDayPicker } from "./HourlyDayPicker";

describe("시간대 분석 달력", () => {
  const html = renderToStaticMarkup(<HourlyDayPicker selected={["2026-10-12", "2026-10-13", "2026-10-15"]} today="2026-10-17" />);

  it("marks chosen days as pressed buttons and can't choose a day after today", () => {
    expect(html).toMatch(/data-day="2026-10-12"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-day="2026-10-14"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/disabled=""[^>]*data-day="2026-10-18"|data-day="2026-10-18"[^>]*disabled/);
    expect(html).toContain('aria-label="10월 17일 오늘"');
  });

  it("shows the month of the latest chosen day, one tab stop, the limit and the quick picks", () => {
    expect(html).toContain("2026년 10월");
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain("선택 3일 / 최대 31일");
    expect(html).toContain("10/12~10/13, 10/15");
    for (const label of ["최근 7일", "최근 14일", "최근 30일", "전체 선택 해제"]) expect(html).toContain(label);
    expect(html).toContain('aria-label="다음 달" disabled=""');
  });
});
