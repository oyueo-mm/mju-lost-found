import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(main)/admin/announcements/actions", () => ({
  createAnnouncementAction: vi.fn(),
  updateAnnouncementAction: vi.fn(),
  deleteAnnouncementAction: vi.fn(),
}));
// The edit textarea only exists after clicking 수정 -- with no DOM test
// environment, render the row with its boolean flags (editing, pending)
// starting true instead of false.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (init: unknown) => actual.useState(init === false ? true : init) };
});

const { CreateAnnouncementForm, ANNOUNCEMENT_CONTENT_CLASS } = await import("./CreateAnnouncementForm");
const { AnnouncementRow } = await import("./AnnouncementRow");

const textarea = (markup: string) => markup.match(/<textarea[^>]*>/)?.[0] ?? "";

// 공지 본문 입력창: ~280px on mobile, ~400px from md up, vertically resizable.
describe("announcement content textarea", () => {
  it("uses the taller, resizable size", () => {
    expect(ANNOUNCEMENT_CONTENT_CLASS.split(" ")).toEqual(expect.arrayContaining(["h-70", "md:h-100", "resize-y"]));
  });

  it("applies it in the create form", () => {
    const el = textarea(renderToStaticMarkup(<CreateAnnouncementForm />));
    expect(el).toContain(`class="${ANNOUNCEMENT_CONTENT_CLASS}"`);
    expect(el).not.toContain("rows=");
  });

  it("applies it in the edit form", () => {
    const markup = renderToStaticMarkup(
      <AnnouncementRow
        id={1}
        title="제목"
        content="본문"
        createdAtLabel="2026. 10. 8."
        updatedAtLabel="2026. 10. 8."
        wasEdited={false}
        authorNickname="관리자"
      />,
    );
    const el = textarea(markup);
    expect(el).toContain(`class="${ANNOUNCEMENT_CONTENT_CLASS}"`);
    expect(el).not.toContain("rows=");
  });
});
