import { describe, expect, it } from "vitest";
import { needsSearchApi, usesSemanticSearch } from "./searchIntent";

describe("unified search intent", () => {
  it.each(["검은색 지갑", "에어팟 한쪽", "C타입 충전기", "파란색 텀블러", "black wallet", "AirPods case", "a".repeat(100), "검정 지갑 파랑 우산 빨강 가방 흰색 충전기", "", undefined])("keeps keywords/identifiers lexical: %s", (q) => {
    expect(usesSemanticSearch(q)).toBe(false);
  });
  it.each(["어제 도서관에서 검은색 반지갑을 잃어버렸어요", "학생회관에서 흰색 무선 이어폰 케이스를 주웠어요", "I lost a black leather wallet near the library yesterday", "Looking for my white earphone case left in the student hall", "어제도서관에서검은색가죽반지갑을잃어버렸어요"])('uses both retrievers for a description: %s', (q) => {
    expect(usesSemanticSearch(q)).toBe(true);
  });
  it("keeps explicit legacy keyword links and plain listing on the light page path", () => {
    const q = "어제 도서관에서 검은색 반지갑을 잃어버렸어요";
    expect(needsSearchApi("keyword", q)).toBe(false);
    expect(needsSearchApi("unified", q)).toBe(true);
    expect(needsSearchApi("unified", "지갑")).toBe(true);
    expect(needsSearchApi("unified", "")).toBe(false);
    expect(needsSearchApi("semantic", "지갑")).toBe(true);
  });
});
