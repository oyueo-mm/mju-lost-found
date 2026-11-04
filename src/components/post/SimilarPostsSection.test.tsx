import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import type { PostDTO } from "@/lib/posts/service";
import { SimilarPostsSection } from "./SimilarPostsSection";

const post = (id: number, title: string, score: number): PostDTO =>
  ({
    id,
    type: "found",
    title,
    description: "설명",
    category: "지갑",
    location: "학생회관",
    campus: "인문캠퍼스",
    status: "보관 중",
    imageUrl: null,
    foundAt: null,
    foundDate: null,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    updatedAt: new Date("2026-11-01T00:00:00Z"),
    author: { id: 1, nickname: "테스터", publicId: "tester", userType: "STUDENT" },
    organizationId: null,
    organizationName: null,
    viewCount: 0,
    score,
  }) as unknown as PostDTO;

const render = (recommendations: PostDTO[], extra: Partial<Parameters<typeof SimilarPostsSection>[0]> = {}) =>
  renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <SimilarPostsSection sourceType="lost" recommendations={recommendations} loadFailed={false} {...extra} />
    </I18nProvider>,
  );

describe("게시글 상세 추천", () => {
  const recs = [post(3, "첫째 검은 지갑", 0.57), post(1, "둘째 검은 지갑", 0.54), post(2, "셋째 검은 지갑", 0.52)];

  it("shows no similarity badge at all -- no label, no number", () => {
    for (const html of [render(recs), render(recs, { pending: true })]) {
      expect(html).not.toContain(ko["post.score.ai"]);
      expect(html).not.toMatch(/0\.5[247]/);
      expect(html).not.toMatch(/>[^<]*\d+%[^<]*</); // a percentage shown as text
    }
  });

  it("keeps the recommendations, in the order the server ranked them, each linking to its post", () => {
    const html = render(recs);
    const at = (s: string) => html.indexOf(s);
    expect(at("첫째 검은 지갑")).toBeGreaterThan(-1);
    expect(at("첫째 검은 지갑")).toBeLessThan(at("둘째 검은 지갑"));
    expect(at("둘째 검은 지갑")).toBeLessThan(at("셋째 검은 지갑"));
    for (const id of [3, 1, 2]) expect(html).toContain(`href="/post/${id}?type=found"`);
    expect(html).toContain("학생회관");
  });

  it("still shows the small empty state when there is nothing to suggest", () => {
    const html = render([]);
    expect(html).toContain(ko["recommend.empty.title"].replace("{board}", ko["post.type.found"]));
  });
});
