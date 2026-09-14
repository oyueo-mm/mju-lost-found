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
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  author: { id: 1, nickname: "테스터", publicId: "tester" },
  organizationId: null,
  organizationName: null,
  viewCount: 3,
};

function renderCard(post: PostDTO): string {
  return renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <PostCard post={post} />
    </I18nProvider>,
  );
}

describe("PostCard desktop layout", () => {
  it("renders a no-image description directly below the body on the card surface", () => {
    const markup = renderCard(basePost);

    expect(markup).toContain("h-full");
    expect(markup).not.toContain("md:min-h-");
    expect(markup).toContain("border-t border-border px-3.5 py-3 text-xs leading-relaxed text-muted-foreground");
    expect(markup).toContain("line-clamp-4");
    expect(markup).not.toContain("bg-muted p-3 text-xs leading-relaxed");
    expect(markup).toContain(basePost.description);
  });

  it("does not add an empty media placeholder without a description", () => {
    const markup = renderCard({ ...basePost, description: "" });

    expect(markup).not.toContain("border-t border-border px-3.5 py-3 text-xs leading-relaxed text-muted-foreground");
    expect(markup).not.toContain("aspect-3/2 w-full shrink-0 border-t border-border");
  });

  it("uses the shared larger desktop media ratio for image cards", () => {
    const markup = renderCard({ ...basePost, imageUrl: "https://example.com/item.webp" });

    expect(markup).toContain("aspect-3/2");
    expect(markup).toContain("md:aspect-4/3");
    expect(markup).toContain("object-cover");
  });

  it("wraps unbroken title and preview tokens while retaining the existing clamps", () => {
    const longToken = "1234567890".repeat(40);
    const markup = renderCard({ ...basePost, title: longToken, description: longToken });

    expect(markup).toContain("line-clamp-2 text-base font-bold text-foreground [overflow-wrap:anywhere]");
    expect(markup).toContain("line-clamp-4 [overflow-wrap:anywhere]");
    expect(markup).toContain(longToken);
    expect(markup).toContain("min-w-0 self-start");
  });
});
