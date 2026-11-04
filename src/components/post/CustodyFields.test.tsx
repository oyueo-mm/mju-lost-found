import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/client";
import { ko } from "@/lib/i18n/messages/ko";
import { CustodyFields, custodyAfterChoice } from "./CustodyFields";
import { custodyInputOf, custodyInputSchema, custodyView, readCustody, type CustodyInfo, type CustodyInput } from "@/lib/posts/custodySchema";

const render = (value: CustodyInput | null, extra: Partial<Parameters<typeof CustodyFields>[0]> = {}) =>
  renderToStaticMarkup(
    <I18nProvider locale="ko" messages={ko}>
      <CustodyFields value={value} onChange={() => {}} campus="인문캠퍼스" {...extra} />
    </I18nProvider>,
  );

describe("현재 물건의 보관 상태 (Phase 3-A)", () => {
  it("is one optional question with three short answers, none chosen at first", () => {
    const html = render(null);
    expect(html).toContain(ko["form.custody.title"]);
    expect(html).toContain(ko["form.custody.optional"]);
    expect(html).toContain(ko["form.custody.help"]);
    for (const key of ["form.custody.self", "form.custody.handed", "form.custody.other"] as const) expect(html).toContain(`>${ko[key]}</button>`);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toMatch(/required/);
    expect(html).not.toContain("*");
    // no large radio cards and no clear button before anything is chosen
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain(ko["form.custody.clear"]);
    // the old four-card wording is gone
    for (const old of ["제가 보관하고 있어요", "기관에 맡길 예정이에요", "가져오지 않았어요"]) expect(html).not.toContain(old);
  });

  it("직접 보관: nothing more to fill in, no private location asked", () => {
    const html = render({ state: "SELF", place: "" });
    expect(html).toMatch(/aria-pressed="true"[^>]*>직접 보관</);
    expect(html).toContain(ko["form.custody.selfHelp"]);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).toContain(ko["form.custody.clear"]);
  });

  it("기관에 맡김: an optional office/place combobox with the stored value, never required", () => {
    const html = render({ state: "REPORTED", place: "국제관 경비실" });
    expect(html).toContain(ko["form.custody.placeLabel"]);
    expect(html).toContain(ko["form.custody.placeOptional"]);
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*value="국제관 경비실"/);
    expect(html).not.toMatch(/<input[^>]*required/);
    expect(html).toContain(ko["form.custody.placeHelp"]);
    expect(html).toContain('placeholder="예: 종합관 경비실"');
  });

  it("기타: a free-text field; an empty 기타 shows its error next to the field", () => {
    const html = render({ state: "OTHER", place: "", note: "내일 학생지원팀에 맡길 예정" }, { error: ko["form.custody.otherRequired"] });
    expect(html).toContain(ko["form.custody.otherLabel"]);
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(html).toContain('role="alert"');
    expect(html).toContain(ko["form.custody.otherRequired"]);
    expect(html).toContain(ko["form.custody.otherExamples"]);
  });

  it("an older post's 맡길 예정 sits under 기타 with its meaning spelled out, text left empty", () => {
    const html = render({ state: "PLANNED", place: "국제관 경비실" });
    expect(html).toMatch(/aria-pressed="true"[^>]*>기타</);
    expect(html).toContain("이전에 등록한 상태: 기관에 맡길 예정 · 국제관 경비실.");
    expect(html).toContain(ko["form.custody.legacyKeep"]);
    expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
  });

  it("older 보관 위치 모름 / 그대로 둠 are named too", () => {
    expect(render({ state: "UNKNOWN", place: "" })).toContain("이전에 등록한 상태: 보관 위치 모름.");
    expect(render({ state: "UNHELD", place: "" })).toContain("이전에 등록한 상태: 발견한 자리에 그대로 둠.");
  });
});

describe("custodyAfterChoice", () => {
  const memory = { handedPlace: "", otherNote: "", legacy: null };

  it("chooses, switches and unselects (tapping the chosen answer again)", () => {
    expect(custodyAfterChoice("self", null, memory)).toEqual({ state: "SELF", place: "" });
    expect(custodyAfterChoice("self", { state: "SELF", place: "" }, memory)).toBeNull();
    expect(custodyAfterChoice("handed", { state: "SELF", place: "" }, memory)).toEqual({ state: "REPORTED", place: "" });
    expect(custodyAfterChoice("other", { state: "REPORTED", place: "" }, memory)).toEqual({ state: "OTHER", place: "", note: "" });
  });

  it("brings back what was typed for an answer, and only that answer's input", () => {
    const typed = { handedPlace: "종합관 경비실", otherNote: "다른 학생이 보관 중", legacy: null };
    expect(custodyAfterChoice("handed", { state: "OTHER", place: "", note: "다른 학생이 보관 중" }, typed)).toEqual({ state: "REPORTED", place: "종합관 경비실" });
    expect(custodyAfterChoice("other", { state: "REPORTED", place: "종합관 경비실" }, typed)).toEqual({ state: "OTHER", place: "", note: "다른 학생이 보관 중" });
    expect(custodyAfterChoice("self", { state: "REPORTED", place: "종합관 경비실" }, typed)).toEqual({ state: "SELF", place: "" });
  });

  it("기타 with no new text on an older post returns that post's own state unchanged", () => {
    const legacy = { state: "PLANNED", place: "국제관 경비실" } as const;
    expect(custodyAfterChoice("other", { state: "SELF", place: "" }, { ...memory, legacy })).toEqual(legacy);
    // and it is still 기타, so tapping 기타 again unselects
    expect(custodyAfterChoice("other", legacy, { ...memory, legacy })).toBeNull();
  });
});

describe("custodyInputSchema", () => {
  it("keeps every older state valid, and a plan or hand-over without a place", () => {
    expect(custodyInputSchema.parse({ state: "PLANNED", place: "" })).toEqual({ state: "PLANNED", place: "" });
    expect(custodyInputSchema.parse({ state: "REPORTED", place: "  " })).toEqual({ state: "REPORTED", place: "" });
    expect(custodyInputSchema.parse({ state: "REPORTED", place: "학생회관 경비실" })).toEqual({ state: "REPORTED", place: "학생회관 경비실" });
    expect(custodyInputSchema.parse({ state: "UNKNOWN", place: "" })).toEqual({ state: "UNKNOWN", place: "" });
  });

  it("drops a place for states that have none", () => {
    expect(custodyInputSchema.parse({ state: "SELF", place: "내 방" })).toEqual({ state: "SELF", place: "" });
    expect(custodyInputSchema.parse({ state: "UNHELD", place: "x" })).toEqual({ state: "UNHELD", place: "" });
  });

  it("기타 needs its text (trimmed), keeps it in note and never as a place", () => {
    expect(custodyInputSchema.safeParse({ state: "OTHER", place: "" }).success).toBe(false);
    expect(custodyInputSchema.safeParse({ state: "OTHER", place: "", note: "   " }).success).toBe(false);
    expect(custodyInputSchema.parse({ state: "OTHER", place: "경비실", note: " 내일 경비실에 맡길 예정 " })).toEqual({ state: "OTHER", place: "", note: "내일 경비실에 맡길 예정" });
    expect(custodyInputSchema.safeParse({ state: "OTHER", place: "", note: "x".repeat(201) }).success).toBe(false);
  });

  it("drops a note from any other state", () => {
    expect(custodyInputSchema.parse({ state: "SELF", place: "", note: "x" })).toEqual({ state: "SELF", place: "" });
  });

  it("still rejects an owner-forged confirmation", () => {
    expect(custodyInputSchema.safeParse({ state: "REPORTED", place: "경비실", confirmedAt: "2026-11-03T00:00:00.000Z" }).success).toBe(false);
  });
});

describe("readCustody / custodyInputOf", () => {
  it("reads a stored 기타 with its note, and re-writes it unchanged", () => {
    const info = readCustody({ state: "OTHER", place: "", note: "발견한 자리에 그대로 두었어요" });
    expect(info?.note).toBe("발견한 자리에 그대로 두었어요");
    expect(custodyInputOf(info!)).toEqual({ state: "OTHER", place: "", note: "발견한 자리에 그대로 두었어요" });
  });
  it("re-writes an older state exactly as stored (no note added)", () => {
    expect(custodyInputOf(readCustody({ state: "PLANNED", place: "국제관 경비실" })!)).toEqual({ state: "PLANNED", place: "국제관 경비실" });
  });
});

describe("custodyView (post page)", () => {
  const info = (state: CustodyInfo["state"], place = "", extra: Partial<CustodyInfo> = {}): CustodyInfo => ({
    state,
    place,
    confirmedAt: null,
    confirmedBy: null,
    institution: null,
    ...extra,
  });

  it("shows nothing invented when nothing was entered", () => {
    expect(custodyView(null, false)).toBeNull();
  });

  it("tells a plan from a hand-over, and a finder's report from a confirmed receipt", () => {
    expect(custodyView(info("PLANNED", "국제관 경비실"), false)).toEqual({ stateKey: "post.custody.state.planned", place: "국제관 경비실" });
    expect(custodyView(info("PLANNED"), false)).toEqual({ stateKey: "post.custody.state.planned", placeKey: "post.custody.place.undecided" });
    expect(custodyView(info("REPORTED", "종합관 경비실"), false)).toEqual({ stateKey: "post.custody.state.reported", place: "종합관 경비실", noteKey: "post.custody.note.reported" });
    expect(custodyView(info("REPORTED"), false)?.placeKey).toBe("post.custody.place.unknown");
    expect(custodyView(info("REPORTED", "S4 경비실", { confirmedAt: "2026-11-03T00:00:00.000Z", institution: "학생지원팀" }), false)).toEqual({
      stateKey: "post.custody.state.institutionConfirmed",
      place: "S4 경비실",
      noteKey: "post.custody.note.confirmed",
      institution: "학생지원팀",
    });
  });

  it("never shows a private location for 직접 보관, and shows 기타 exactly as written", () => {
    const self = custodyView(info("SELF"), false);
    expect(self).toEqual({ stateKey: "post.custody.state.self", noteKey: "post.custody.note.self" });
    expect(custodyView(info("OTHER", "", { note: "내일 학생지원팀에 맡길 예정이에요." }), false)).toEqual({
      stateKey: "post.custody.state.other",
      stateText: "내일 학생지원팀에 맡길 예정이에요.",
    });
    expect(custodyView(info("UNHELD"), false)?.stateKey).toBe("post.custody.state.unheld");
    expect(custodyView(info("UNKNOWN"), false)?.stateKey).toBe("post.custody.state.unknown");
  });

  it("a returned item says so, whatever was entered", () => {
    expect(custodyView(info("SELF"), true)).toEqual({ stateKey: "post.custody.state.returned" });
    expect(custodyView(null, true)).toEqual({ stateKey: "post.custody.state.returned" });
  });

  it("every key it can return exists in the Korean dictionary", () => {
    const keys = ["post.custody.state.returned", "post.custody.state.institutionConfirmed", "post.custody.state.self", "post.custody.state.reported", "post.custody.state.planned", "post.custody.state.unheld", "post.custody.state.unknown", "post.custody.state.other", "post.custody.place.unregistered", "post.custody.place.unknown", "post.custody.place.undecided", "post.custody.note.confirmed", "post.custody.note.self", "post.custody.note.reported"];
    for (const k of keys) expect(ko).toHaveProperty([k]);
  });
});
