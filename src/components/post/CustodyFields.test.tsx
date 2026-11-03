import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustodyFields } from "./CustodyFields";
import { custodyInputSchema, custodySummary } from "@/lib/posts/custodySchema";

const render = (value: Parameters<typeof CustodyFields>[0]["value"], required = false) =>
  renderToStaticMarkup(<CustodyFields value={value} onChange={() => {}} campus="인문캠퍼스" required={required} />);

describe("보관 질문의 조건부 입력", () => {
  it("asks one question with separate 맡길 예정 / 맡겼어요 answers, none chosen for a new post", () => {
    const html = render(null, true);
    expect(html).toContain("지금 물건은 어디에 있나요?");
    for (const label of ["제가 보관하고 있어요", "기관에 맡길 예정이에요", "기관에 맡겼어요", "가져오지 않았어요"]) expect(html).toContain(label);
    expect(html).not.toContain("checked");
    expect(html).toMatch(/type="radio"[^>]*required/);
    // the old yes/no question that repeated 기관에 전달함 is gone
    expect(html).not.toContain("보관 중인가요?");
    expect(html).not.toContain("보관 위치 모름");
  });

  it("does not ask for a private location when the finder keeps the item", () => {
    const html = render({ state: "SELF", place: "" });
    expect(html).toContain("보관 위치는 공개되지 않아요");
    expect(html).not.toContain("<datalist");
  });

  it("맡길 예정: an optional place with suggestions, never marked as handed over", () => {
    const html = render({ state: "PLANNED", place: "" });
    expect(html).toContain("맡길 곳");
    expect(html).toContain("(정했다면)");
    expect(html).not.toMatch(/<input[^>]*list="[^"]*"[^>]*required/);
    expect(html).toContain('value="교내 경비실"');
    expect(html).toContain('value="학생회관(S2)"');
    expect(html).toContain("입력 예시");
    expect(html).toContain("실제 접수 여부는 담당자가 확인한 뒤");
    expect(html).not.toContain("확인 완료");
  });

  it("맡겼어요: asks whether the place is known; known -> a required place", () => {
    const html = render({ state: "REPORTED", place: "국제관 경비실" });
    expect(html).toContain("맡긴 곳을 알고 있나요?");
    expect(html).toMatch(/<input[^>]*required[^>]*value="국제관 경비실"|<input[^>]*value="국제관 경비실"[^>]*required|<input[^>]*required[^>]*>/);
    expect(html).toContain('aria-pressed="true"');
  });

  it("맡겼어요 with no place stored opens on 잘 모르겠어요 and stores nothing", () => {
    const html = render({ state: "REPORTED", place: "" });
    expect(html).toContain("장소는 비워 둘게요");
    expect(html).not.toContain('placeholder="예: 국제관 1층 경비실"');
  });

  it("an older post's 보관 위치 모름 stays selectable", () => {
    const html = render({ state: "UNKNOWN", place: "" });
    expect(html).toContain("보관 위치 모름");
    expect(html).toContain("checked");
  });
});

describe("custodyInputSchema", () => {
  it("accepts a plan or a hand-over without a place (undecided / unknown), keeping it empty", () => {
    expect(custodyInputSchema.parse({ state: "PLANNED", place: "" })).toEqual({ state: "PLANNED", place: "" });
    expect(custodyInputSchema.parse({ state: "REPORTED", place: "  " })).toEqual({ state: "REPORTED", place: "" });
    expect(custodyInputSchema.parse({ state: "REPORTED", place: "학생회관 경비실" })).toEqual({ state: "REPORTED", place: "학생회관 경비실" });
  });
  it("drops a place for states that have none", () => {
    expect(custodyInputSchema.parse({ state: "SELF", place: "내 방" })).toEqual({ state: "SELF", place: "" });
    expect(custodyInputSchema.parse({ state: "UNHELD", place: "x" })).toEqual({ state: "UNHELD", place: "" });
  });
});

describe("custodySummary (post page)", () => {
  const info = (state: "SELF" | "PLANNED" | "REPORTED" | "UNHELD" | "UNKNOWN", place = "", confirmed = false) => ({
    state,
    place,
    confirmedAt: confirmed ? "2026-11-03T00:00:00.000Z" : null,
    confirmedBy: null,
    institution: confirmed ? "학생지원팀" : null,
  });
  it("tells a plan from a hand-over, and an unknown place from a confirmed one", () => {
    expect(custodySummary(info("PLANNED", "국제관 경비실"), false).place).toBe("국제관 경비실 (전달 예정)");
    expect(custodySummary(info("PLANNED"), false).place).toBe("전달 예정 (장소 미정)");
    expect(custodySummary(info("REPORTED"), false)).toEqual({ place: "기관에 전달함 (장소 모름)", state: "기관에 전달함 (작성자 신고)", note: "작성자 신고 · 관리자 미확인" });
    expect(custodySummary(info("REPORTED", "S4 경비실", true), false)).toEqual({ place: "S4 경비실", state: "기관 보관 중", note: "기관 접수 확인 완료 (학생지원팀)" });
    expect(custodySummary(info("SELF"), false).place).toContain("위치 비공개");
  });
  it("keeps the old wording for posts without custody info", () => {
    expect(custodySummary(null, false)).toEqual({ place: "미등록", state: "보관 위치 모름", note: "보관 정보 미등록" });
    expect(custodySummary(null, true).state).toBe("반환 완료 표시");
  });
});
