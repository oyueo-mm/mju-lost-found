import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import { PostForm } from "./PostForm";

// 분실/습득 날짜/시각: place and date default to 모름; the date is a
// year-month-day input and the exact time is a separate opt-in.

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

const toggle = (markup: string, label: string) =>
  markup.match(new RegExp(`<div role="group" aria-label="${label}"[^>]*>.*?</div>`))?.[0] ?? "";
const checkbox = (markup: string) => markup.match(/<input type="checkbox"[^>]*>/)?.[0] ?? "";

describe("PostForm 분실 일시", () => {
  it("create: place and date start as 모름; the exact time is a separate opt-in", () => {
    const markup = render();
    expect(toggle(markup, "잃어버린 장소")).toMatch(/aria-pressed="true"[^>]*>모름</);
    expect(toggle(markup, "잃어버린 날짜")).toMatch(/aria-pressed="true"[^>]*>모름</);
    expect(input(markup, "location")).not.toContain('required=""');
    expect(input(markup, "date")).toContain('type="date"');
    expect(input(markup, "date")).toContain('disabled=""');
    expect(input(markup, "time")).toContain('type="time"');
    expect(input(markup, "time")).toContain('disabled=""');
    expect(checkbox(markup)).not.toContain('checked=""');
    expect(markup).toContain("정확한 시간도 입력할게요");
  });

  it("labels the place by board, with help text that it isn't the storage place", () => {
    expect(render()).toContain("잃어버린 장소");
    const found = renderToStaticMarkup(
      <I18nProvider locale="ko" messages={ko}>
        <PostForm type="found" />
      </I18nProvider>,
    );
    expect(found).toContain("발견한 장소");
    expect(found).toContain(ko["form.foundLocationHelp"].replace(/'/g, "&#x27;"));
  });

  it("edit, date + time: both prefilled, the exact-time box checked", () => {
    const markup = render(editValues("2026-10-06", "14:30"));
    expect(input(markup, "date")).toContain('value="2026-10-06"');
    expect(input(markup, "date")).toContain('required=""');
    expect(input(markup, "time")).toContain('value="14:30"');
    expect(input(markup, "time")).not.toContain('disabled=""');
    expect(input(markup, "time")).toContain('required=""');
    expect(checkbox(markup)).toContain('checked=""');
  });

  it("edit, date only: the date stays, the time stays off", () => {
    const markup = render(editValues("2026-10-06", null));
    expect(input(markup, "date")).toContain('value="2026-10-06"');
    expect(input(markup, "date")).not.toContain('disabled=""');
    expect(input(markup, "time")).toContain('disabled=""');
    expect(checkbox(markup)).not.toContain('checked=""');
    expect(toggle(markup, "잃어버린 날짜")).toMatch(/aria-pressed="true"[^>]*>알고 있어요</);
  });

  it("edit, date unknown: 모름 selected, both inputs disabled", () => {
    const markup = render(editValues(null, null));
    expect(input(markup, "date")).toContain('disabled=""');
    expect(input(markup, "time")).toContain('disabled=""');
    expect(toggle(markup, "잃어버린 날짜")).toMatch(/aria-pressed="true"[^>]*>모름</);
    // a stored location stays known
    expect(toggle(markup, "잃어버린 장소")).toMatch(/aria-pressed="true"[^>]*>알고 있어요</);
    expect(input(markup, "location")).toContain('value="학생회관"');
  });
});

// 유실물법 안내: text-only notices -- posting is not the official hand-in,
// a voluntary reward is not the legal reward, and personal details on ID
// cards must be covered before uploading.
function renderNew(type: "lost" | "found") {
  return renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <PostForm type={type} />
    </I18nProvider>,
  );
}

describe("PostForm 유실물법 안내", () => {
  it("found: says posting is not a police hand-in and names the official routes and the 7-day limit", () => {
    const markup = renderNew("found");
    expect(markup).toContain("경찰 신고나 습득물 제출이 아니에요");
    expect(markup).toContain("경찰서·지구대·파출소에 제출");
    expect(markup).toContain("건물 관리자에게 인계");
    expect(markup).toContain("7일 안에");
    // 제9조's 7-day rule is stated as the law words it, separately from the
    // 제10조 manager handover, with no exception asserted either way and the
    // rights after a handover left to the manager or police.
    expect(markup).toContain("건물 관리자에게 인계해야 해요(제10조)");
    expect(markup).toContain("7일 안에 소유자 반환이나 경찰 제출 절차를 밟지 않은 습득자는");
    expect(markup).toContain("제10조가 따로 정하고 있으니");
    expect(markup).not.toContain("경우가 아니라면");
    expect(markup).not.toContain(ko["form.lostRewardNotice"]);
  });

  it("lost: separates a voluntary reward from the legal 5~20% reward", () => {
    const markup = renderNew("lost");
    expect(markup).toContain("자율적으로 정하는 선택사항");
    expect(markup).toContain("5~20%");
    expect(markup).not.toContain(ko["form.foundLegalNotice"]);
  });

  it("both: warns to cover personal details on ID cards before uploading photos", () => {
    for (const type of ["lost", "found"] as const) {
      expect(renderNew(type)).toContain("신분증·학생증·카드");
    }
  });
});

describe("분실물 상세 안내 문구", () => {
  it("says hand in (제출) to the police or hand over to the building manager, not just report", () => {
    const notice = ko["post.lostPropertyNotice"];
    expect(notice).toContain("경찰서·지구대·파출소");
    expect(notice).toContain("에 제출해주세요");
    expect(notice).toContain("건물 관리자에게 인계");
    expect(notice).not.toContain("신고해주세요");
  });
});

// 연속 등록 ("다음 습득물 등록"): only the campus and 게시 주체 come over.
describe("PostForm 연속 등록", () => {
  const renderFound = (props: Partial<Parameters<typeof PostForm>[0]> = {}) =>
    renderToStaticMarkup(
      <I18nProvider locale="ko" messages={ko}>
        <PostForm type="found" {...props} />
      </I18nProvider>,
    );
  const campusButton = (markup: string, campus: string) =>
    markup.match(new RegExp(`<button[^>]*aria-pressed="(true|false)"[^>]*>${campus}</button>`))?.[1];

  it("starts on the previous post's campus, says what carried over, and leaves the item itself empty", () => {
    const markup = renderFound({ defaults: { campus: "자연캠퍼스", organizationId: null } });
    expect(campusButton(markup, "자연캠퍼스")).toBe("true");
    expect(campusButton(markup, "인문캠퍼스")).toBe("false");
    expect(markup).toContain(ko["form.nextPostNotice"]);
    expect(input(markup, "title")).not.toContain("value=");
    expect(toggle(markup, "발견한 장소")).toMatch(/aria-pressed="true"[^>]*>모름</);
    expect(toggle(markup, "발견한 날짜")).toMatch(/aria-pressed="true"[^>]*>모름</);
  });

  it("a plain new form has no notice and the default campus", () => {
    const markup = renderFound();
    expect(markup).not.toContain(ko["form.nextPostNotice"]);
    expect(campusButton(markup, "인문캠퍼스")).toBe("true");
  });

  it("edit mode ignores defaults", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="ko" messages={ko}>
        <PostForm
          type="lost"
          postId={1}
          initialValues={editValues(null, null)}
          defaults={{ campus: "자연캠퍼스", organizationId: null }}
        />
      </I18nProvider>,
    );
    expect(markup).not.toContain(ko["form.nextPostNotice"]);
    expect(campusButton(markup, "인문캠퍼스")).toBe("true");
  });
});
