import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import { PostForm } from "./PostForm";

// 분실/습득 날짜/시각 분리: the date and time are separate inputs, and
// "시간을 잘 모르겠어요" only disables the time -- the date stays.

const editValues = (dateValue: string | null, timeValue: string | null) => ({
  title: "지갑",
  description: "검은색",
  category: "지갑",
  categoryCode: null,
  subcategory: null,
  location: "학생회관",
  campus: "인문캠퍼스",
  dateValue,
  timeValue,
  images: [],
  organizationId: null,
  organizationName: null,
});

function render(initialValues?: ReturnType<typeof editValues>) {
  return renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <PostForm type="lost" postId={initialValues ? 1 : undefined} initialValues={initialValues} />
    </I18nProvider>,
  );
}

const input = (markup: string, name: string) => markup.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";

describe("PostForm 분실 일시", () => {
  it("create: separate required date and time inputs, plus the 시간 모름 checkbox", () => {
    const markup = render();
    expect(input(markup, "date")).toContain('type="date"');
    expect(input(markup, "date")).toContain('required=""');
    expect(input(markup, "time")).toContain('type="time"');
    expect(input(markup, "time")).toContain('required=""');
    expect(markup).toContain("시간을 잘 모르겠어요");
  });

  it("edit, date + time: both prefilled", () => {
    const markup = render(editValues("2026-10-06", "14:30"));
    expect(input(markup, "date")).toContain('value="2026-10-06"');
    expect(input(markup, "time")).toContain('value="14:30"');
    expect(input(markup, "time")).not.toContain('disabled=""');
  });

  it("edit, date only: the date stays, only the time is disabled", () => {
    const markup = render(editValues("2026-10-06", null));
    expect(input(markup, "date")).toContain('value="2026-10-06"');
    expect(input(markup, "date")).not.toContain('disabled=""');
    expect(input(markup, "time")).toContain('disabled=""');
    expect(markup).toMatch(/<input type="checkbox" checked=""/);
  });

  it("edit, date unknown: both inputs disabled, no time checkbox", () => {
    const markup = render(editValues(null, null));
    expect(input(markup, "date")).toContain('disabled=""');
    expect(input(markup, "time")).toContain('disabled=""');
    expect(markup).not.toContain("시간을 잘 모르겠어요");
    expect(markup).toContain("날짜를 알고 있어요");
  });
});
