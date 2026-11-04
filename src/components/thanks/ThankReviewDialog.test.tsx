import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(main)/me/thanks/actions", () => ({ sendThankNoteAction: vi.fn() }));
const { ThankReviewDialog } = await import("./ThankReviewDialog");

const html = renderToStaticMarkup(
  <I18nProvider locale="ko" messages={ko}>
    <ThankReviewDialog postType="lost" postId={5} receiverName="새벽세시" postTitle="검은 지갑" postImageUrl={null} triggerLabel={ko["thanks.review.open"]} />
  </I18nProvider>,
);

describe("감사 후기 남기기 (dialog)", () => {
  it("has the title, the item, the receiver, the question, the message field and 후기 보내기", () => {
    for (const s of [ko["thanks.review.title"], "검은 지갑", "받는 분: 새벽세시", ko["thanks.tags.question"], ko["thanks.review.messageLabel"], ko["thanks.review.send"]]) expect(html).toContain(s);
    expect(html).toContain(`placeholder="${ko["thanks.review.placeholder"]}"`);
  });

  it("offers exactly the five 칭찬 태그 as toggle buttons, none pressed -- and no 정말 감사해요", () => {
    const tags = [...html.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)];
    expect(tags.map((m) => m[2])).toEqual(["친절했어요", "연락이 빨랐어요", "물건을 잘 보관해 줬어요", "반환에 적극적으로 도와줬어요", "약속을 잘 지켜줬어요"]);
    expect(tags.every((m) => m[1] === "false")).toBe(true);
    expect(html).not.toContain("정말 감사해요");
  });

  it("starts with 후기 보내기 disabled (no tag, no text) and has no star rating or long notices", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).not.toMatch(/별점|★|rating/i);
    for (const s of ["개인정보 보호 절차", "운영정책에 따라", "후기를 작성하지 않아도", "별점은 없어요", "공개 가능성에 대한 안내"]) expect(html).not.toContain(s);
  });

  it("has no sender-side public / private choice", () => {
    expect(html).not.toContain(ko["thanks.review.publish"]);
    expect(html).not.toContain(ko["thanks.status.private"]);
  });
});
