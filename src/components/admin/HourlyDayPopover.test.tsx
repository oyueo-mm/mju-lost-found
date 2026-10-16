import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/stats",
  useSearchParams: () => new URLSearchParams("period=month"),
}));

import { HourlyDayPopover } from "./HourlyDayPopover";

describe("시간대 분석 날짜 선택 버튼", () => {
  const html = renderToStaticMarkup(<HourlyDayPopover selected={["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-16"]} today="2026-10-17" />);

  it("shows the count and the days while closed, and opens a dialog", () => {
    expect(html).toContain("날짜 선택 · 4일");
    expect(html).toContain("10/12~10/13, 10/15~10/16");
    expect(html).toMatch(/aria-haspopup="dialog" aria-expanded="false"/);
  });

  it("keeps the calendar mounted but hidden, with close and 완료 buttons", () => {
    expect(html).toMatch(/role="dialog" aria-label="날짜 선택" hidden=""/);
    expect(html).toContain('data-day="2026-10-12"');
    expect(html).toContain('aria-label="날짜 선택 닫기"');
    expect(html).toContain(">완료</button>");
  });
});
