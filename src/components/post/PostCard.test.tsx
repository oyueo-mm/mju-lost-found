import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import type { PostDTO } from "@/lib/posts/service";
import { PostCard } from "./PostCard";

const basePost: PostDTO = {
  id: 1,
  type: "found",
  title: "검은색 카드지갑",
  description: "학생회관 앞에서 발견했습니다.",
  category: "지갑",
  location: "학생회관",
  campus: "인문캠퍼스",
  status: "보관 중",
  imageUrl: null,
  foundAt: new Date("2026-09-01T00:00:00Z"),
  foundDate: "2026-09-01",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  author: { id: 1, nickname: "테스터", publicId: "tester", userType: "STUDENT" },
  organizationId: null,
  organizationName: null,
  viewCount: 3,
};

function renderCard(post: PostDTO, props: Omit<Parameters<typeof PostCard>[0], "post"> = {}): string {
  return renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <PostCard post={post} {...props} />
    </I18nProvider>,
  );
}

describe("PostCard score badge", () => {
  const scored = { ...basePost, score: 0.6234 };

  it("shows the detail-page AI 추천 score as 'AI 유사도 0.xx' (decimal, never a percentage)", () => {
    const markup = renderCard(scored, { scoreLabel: ko["post.score.ai"], scoreDisplay: "decimal" });

    expect(markup).toContain("AI 유사도 0.62");
    expect(markup).not.toContain("62%");
  });

  // AI 검색 점수 숨김 Phase: AISearchPanel renders every result this way.
  it("hides only the score badge when scoreDisplay is 'hidden', keeping the rest of the card", () => {
    const markup = renderCard(scored, { scoreLabel: ko["post.score.ai"], scoreDisplay: "hidden" });

    expect(markup).not.toContain("AI 유사도");
    expect(markup).not.toContain("0.62");
    expect(markup).toContain(basePost.title);
    expect(markup).toContain(basePost.description);
    expect(markup).toContain(basePost.location!);
  });
});

describe("PostCard layout (게시판 리디자인)", () => {
  it("gives a no-photo post a small category icon and its description -- no picture-sized placeholder or stand-in image", () => {
    const markup = renderCard(basePost);

    expect(markup).toContain("data-no-photo");
    expect(markup).toContain(basePost.description);
    expect(markup).not.toContain("aspect-4/3");
    expect(markup).not.toContain("<img");
  });

  it("keeps the no-photo tile to the icon when there is no description", () => {
    const markup = renderCard({ ...basePost, description: "" });

    expect(markup).toContain("data-no-photo");
    expect(markup).not.toContain("line-clamp-3");
  });

  it("shows the whole photo (contained, never cropped) over a blurred copy of itself", () => {
    const markup = renderCard({ ...basePost, imageUrl: "https://example.com/item.webp" });

    expect(markup).toContain("aspect-4/3");
    expect(markup).toContain("object-contain");
    // the backdrop copy is decorative
    expect(markup).toMatch(/<img[^>]*alt=""[^>]*aria-hidden="true"[^>]*blur-xl/);
    expect(markup).toContain(`alt="${basePost.title}"`);
    expect(markup).not.toContain("data-no-photo");
  });

  it("uses only the primary photo for a post with several photos", () => {
    const images = [1, 2, 3].map((n) => ({ id: n, imageUrl: `https://example.com/${n}.webp`, displayOrder: n, isPrimary: n === 1 }));
    const markup = renderCard({ ...basePost, imageUrl: "https://example.com/1.webp", images });

    expect(markup).toContain("1.webp");
    expect(markup).not.toContain("2.webp");
    expect(markup).not.toContain("3.webp");
  });

  it("on the board, crops a square row thumbnail below lg and contains the photo in a 3:2 area from lg", () => {
    const markup = renderCard({ ...basePost, imageUrl: "https://example.com/item.webp" }, { variant: "board" });

    expect(markup).toContain("object-cover lg:object-contain");
    expect(markup).toContain("lg:aspect-3/2");
  });

  it("wraps unbroken title and description tokens inside their clamps", () => {
    const longToken = "1234567890".repeat(40);
    const markup = renderCard({ ...basePost, title: longToken, description: longToken });

    expect(markup).toContain("line-clamp-2 text-[15px] leading-snug font-semibold text-foreground [overflow-wrap:anywhere]");
    expect(markup).toContain("[overflow-wrap:anywhere]");
    expect(markup).toContain(longToken);
  });

  it("shows category, location and date, but not the author or view count", () => {
    const markup = renderCard(basePost);

    expect(markup).toContain("data-post-category");
    expect(markup).toContain(basePost.location!);
    expect(markup).toContain("<time");
    expect(markup).not.toContain(basePost.author.nickname!);
    expect(markup).not.toContain(">3<");
  });
});

describe("PostCard board variant", () => {
  it("drops the 분실물/습득물 label and the in-progress status the board already implies", () => {
    const markup = renderCard(basePost, { variant: "board" });

    expect(markup).not.toContain(ko["search.type.found"]);
    expect(markup).not.toContain("보관 중");
  });

  it("still shows a resolved status, with and without a photo", () => {
    expect(renderCard({ ...basePost, status: "완료" }, { variant: "board" })).toContain(">완료<");
    expect(renderCard({ ...basePost, status: "완료", imageUrl: "https://example.com/item.webp" }, { variant: "board" })).toContain(">완료<");
    expect(renderCard({ ...basePost, type: "lost", status: "찾음" } as unknown as PostDTO, { variant: "board" })).toContain(">찾음<");
  });

  it("keeps the type label and status everywhere else (mixed lists)", () => {
    const markup = renderCard(basePost);

    expect(markup).toContain(ko["search.type.found"]);
    expect(markup).toContain("보관 중");
  });

  it("is a list row on phones and tablets and a vertical card from lg", () => {
    const markup = renderCard(basePost, { variant: "board" });

    expect(markup).toContain("size-24");
    expect(markup).toContain("lg:flex-col");
  });
});

describe("PostCard attribution", () => {
  it("leaves the personal author (and the external-access badge) to the detail page", () => {
    const markup = renderCard({ ...basePost, author: { ...basePost.author, userType: "EXTERNAL_VERIFIED" } });
    expect(markup).not.toContain("인증된 외부 관계자");
    expect(markup).not.toContain(basePost.author.nickname!);
  });

  it("names the organization on an organization-attributed post", () => {
    const markup = renderCard({
      ...basePost,
      organizationId: 3,
      organizationName: "종합관 경비실",
      author: { ...basePost.author, userType: "EXTERNAL_VERIFIED" },
    });
    expect(markup).toContain("종합관 경비실");
    expect(markup).toContain('href="/organizations/3"');
    expect(markup).not.toContain("인증된 외부 관계자");
  });
});
