import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustodyFields } from "./CustodyFields";

describe("보관 질문의 조건부 입력", () => {
  it("does not ask for a private location when the finder keeps the item", () => {
    const html = renderToStaticMarkup(<CustodyFields value={{ state: "SELF", place: "" }} onChange={() => {}} />);
    expect(html).toContain("현재 습득물을 보관 중인가요?");
    expect(html).toContain("개인 보관 위치는 공개하지 않아도 됩니다");
    expect(html).not.toContain('list="custody-places"');
  });
  it("asks for a place for plans and reports, without asserting verification", () => {
    for (const state of ["PLANNED", "REPORTED"] as const) {
      const html = renderToStaticMarkup(<CustodyFields value={{ state, place: "국제관 경비실" }} onChange={() => {}} />);
      expect(html).toContain('list="custody-places"');
      expect(html).toContain("실제 접수 여부는 담당자가 확인한 뒤");
      expect(html).not.toContain("확인 완료");
    }
  });
  it("separates not kept, unknown, and handed-over items", () => {
    const html = renderToStaticMarkup(<CustodyFields value={{ state: "UNKNOWN", place: "" }} onChange={() => {}} />);
    expect(html).toContain("기관에 전달함");
    expect(html).toContain("보관 위치 모름");
    expect(html).toContain("보관하지 않음");
  });
});
