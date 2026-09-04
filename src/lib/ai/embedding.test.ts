import { describe, expect, it } from "vitest";

import { buildEmbeddingText, EMBEDDING_DIMENSIONS, getEmbeddingProvider } from "./embedding";

describe("buildEmbeddingText", () => {
  it("includes title, description, category, and location", () => {
    const text = buildEmbeddingText({
      title: "검은색 에어팟 프로",
      description: "도서관 3층에서 잃어버렸습니다",
      category: "전자기기",
      location: "명지대학교 도서관",
    });

    expect(text).toContain("검은색 에어팟 프로");
    expect(text).toContain("도서관 3층에서 잃어버렸습니다");
    expect(text).toContain("전자기기");
    expect(text).toContain("명지대학교 도서관");
  });

  it("builds text from title alone when nothing else is given", () => {
    expect(buildEmbeddingText({ title: "지갑" })).toBe("지갑");
  });

  it("builds text from description alone when nothing else is given", () => {
    expect(buildEmbeddingText({ description: "검은색 가죽 지갑을 잃어버렸어요" })).toBe(
      "검은색 가죽 지갑을 잃어버렸어요",
    );
  });

  it("skips empty/missing fields instead of inserting blank tokens", () => {
    const text = buildEmbeddingText({ title: "지갑", description: "", category: undefined, location: "학생회관" });
    expect(text).toBe("지갑 학생회관");
    expect(text).not.toContain("  "); // no doubled-up separator from a skipped field
  });

  it("returns an empty string when every field is empty", () => {
    expect(buildEmbeddingText({})).toBe("");
  });
});

describe("getEmbeddingProvider (default lexical provider)", () => {
  it("returns a vector of the declared dimensionality", async () => {
    const provider = getEmbeddingProvider();
    const vector = await provider.embed("검은색 지갑");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("is deterministic -- the same text always embeds to the same vector", async () => {
    const provider = getEmbeddingProvider();
    const a = await provider.embed("검은색 지갑을 학생회관에서 잃어버렸습니다");
    const b = await provider.embed("검은색 지갑을 학생회관에서 잃어버렸습니다");
    expect(a).toEqual(b);
  });

  it("produces different vectors for clearly different text", async () => {
    const provider = getEmbeddingProvider();
    const a = await provider.embed("검은색 지갑을 학생회관에서 잃어버렸습니다");
    const b = await provider.embed("아이폰 15 프로 명지대 도서관에서 습득");
    expect(a).not.toEqual(b);
  });

  it("returns an all-zero vector for empty text rather than throwing", async () => {
    const provider = getEmbeddingProvider();
    const vector = await provider.embed("");
    expect(vector.every((v) => v === 0)).toBe(true);
  });
});
