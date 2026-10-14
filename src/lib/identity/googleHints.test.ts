import { describe, expect, it, vi } from "vitest";

import {
  fetchDepartmentHint,
  GOOGLE_ORG_SCOPE,
  googleScopes,
  hintsFromProfile,
  MEMBER_TYPE_WORDS,
  nameHintFromProfile,
  parseGoogleDisplayName,
  sourceOf,
} from "./googleHints";

describe("Google scopes", () => {
  it("asks for openid email profile -- and the department scope only when explicitly enabled", () => {
    expect(googleScopes({})).toBe("openid email profile");
    expect(googleScopes({ GOOGLE_ORG_SCOPE_ENABLED: "1" })).toBe("openid email profile");
    expect(googleScopes({ GOOGLE_ORG_SCOPE_ENABLED: "true" })).toBe(`openid email profile ${GOOGLE_ORG_SCOPE}`);
  });

  it("never asks for an admin-only directory scope", () => {
    expect(googleScopes({ GOOGLE_ORG_SCOPE_ENABLED: "true" })).not.toMatch(/admin\.directory|directory\.readonly/);
  });
});

describe("nameHintFromProfile", () => {
  it("suggests the Google account name when it looks like a name", () => {
    expect(nameHintFromProfile({ name: "  홍 길동 " })).toBe("홍 길동");
    expect(nameHintFromProfile({ name: "Nguyễn Văn An" })).toBe("Nguyễn Văn An");
  });

  it("suggests nothing for a missing or unusable name (the member types it)", () => {
    for (const profile of [undefined, null, {}, { name: 42 }, { name: "학생123" }, { name: "x" }]) {
      expect(nameHintFromProfile(profile)).toBeNull();
    }
  });
});

describe("fetchDepartmentHint", () => {
  const respond = (body: unknown, ok = true) => vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 403 }));

  it("reads the member's own profile with their token and prefers the primary organization", async () => {
    const fetchImpl = respond({
      organizations: [{ department: "총무팀" }, { department: "컴퓨터공학과", metadata: { primary: true } }],
    });
    expect(await fetchDepartmentHint("token-1", fetchImpl)).toBe("컴퓨터공학과");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://people.googleapis.com/v1/people/me?personFields=organizations");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
  });

  it("is just 'no hint' when the field is empty, the scope is refused, the value is unusable, or the call fails", async () => {
    expect(await fetchDepartmentHint("t", respond({}))).toBeNull();
    expect(await fetchDepartmentHint("t", respond({ organizations: [{ name: "명지대학교" }] }))).toBeNull();
    expect(await fetchDepartmentHint("t", respond({ error: "insufficient scope" }, false))).toBeNull();
    expect(await fetchDepartmentHint("t", respond({ organizations: [{ department: "@@" }] }))).toBeNull();
    expect(await fetchDepartmentHint("t", vi.fn(async () => Promise.reject(new Error("offline"))))).toBeNull();
  });
});

describe("sourceOf", () => {
  it("credits Google only when the saved value is the suggestion unchanged", () => {
    expect(sourceOf("홍길동", "홍길동", "google_profile")).toBe("google_profile");
    expect(sourceOf("홍길순", "홍길동", "google_profile")).toBe("self");
    expect(sourceOf("홍길동", null, "google_profile")).toBe("self");
  });
});

// 표시 이름 "이름/신분/소속" (the earlier MJU Find's format; unconfirmed on a
// real MJU account). Split only on an exact match -- never a wrong name.
describe("parseGoogleDisplayName", () => {
  it("splits an exact 이름/신분/소속 name into name and affiliation (the role is not returned)", () => {
    expect(parseGoogleDisplayName("홍길동/학생/컴퓨터공학과")).toEqual({ name: "홍길동", affiliation: "컴퓨터공학과" });
    expect(parseGoogleDisplayName(" 홍길동 / 교수 / 인공지능·소프트웨어융합대학 ")).toEqual({
      name: "홍길동",
      affiliation: "인공지능·소프트웨어융합대학",
    });
    for (const role of MEMBER_TYPE_WORDS) {
      expect(parseGoogleDisplayName(`홍길동/${role}/학생지원팀`)).toEqual({ name: "홍길동", affiliation: "학생지원팀" });
    }
  });

  it("refuses anything that is not exactly that form", () => {
    for (const raw of [
      "홍길동", // plain name
      "홍길동/학생", // two parts
      "홍길동/학생/컴퓨터공학과/추가", // four parts
      "홍길동/졸업생/컴퓨터공학과", // unknown role word
      "학생/홍길동/컴퓨터공학과", // role in the wrong place
      "/학생/컴퓨터공학과", // empty name
      "홍길동/학생/", // empty affiliation
      "홍길동//컴퓨터공학과", // empty role
      "홍길동1/학생/컴퓨터공학과", // name with a digit
      "홍/학생/컴퓨터공학과", // one-letter name
      "<b>홍길동</b>/학생/컴퓨터공학과", // markup
      "홍길동/학생/@@", // junk affiliation
      `홍길동/학생/${"가".repeat(51)}`, // affiliation too long
      "홍길동／학생／컴퓨터공학과", // fullwidth slashes are not the format
      "",
    ]) {
      expect(parseGoogleDisplayName(raw), raw).toBeNull();
    }
    expect(parseGoogleDisplayName(undefined)).toBeNull();
    expect(parseGoogleDisplayName(42)).toBeNull();
  });
});

describe("hintsFromProfile", () => {
  it("fills both fields from a structured name, marked google_display_name", () => {
    expect(hintsFromProfile({ name: "홍길동/학생/컴퓨터공학과" })).toEqual({
      name: "홍길동",
      department: "컴퓨터공학과",
      nameSource: "google_display_name",
      departmentSource: "google_display_name",
    });
  });

  it("keeps the plain Google name behaviour for an ordinary name", () => {
    expect(hintsFromProfile({ name: "Nguyễn Văn An" })).toEqual({ name: "Nguyễn Văn An", department: null, nameSource: "google_profile" });
  });

  it("never offers the whole display name, or a guess, when the format does not match", () => {
    for (const name of ["홍길동/졸업생/컴퓨터공학과", "홍길동/학생", "홍길동1/학생/컴퓨터공학과", "a/b/c/d"]) {
      expect(hintsFromProfile({ name }), name).toEqual({ name: null, department: null });
    }
    expect(hintsFromProfile(undefined)).toEqual({ name: null, department: null });
  });
});

// The probe script (scripts/probeGoogleIdentity.mjs) reports the format of
// a real account's name without its value; its rules must match the app's.
describe("probe script format check matches the app parser", () => {
  it("agrees on every case", async () => {
    const { classifyDisplayName } = await import("../../../scripts/probeGoogleIdentity.mjs");
    for (const raw of [
      "홍길동/학생/컴퓨터공학과",
      "홍길동/교수/인공지능·소프트웨어융합대학",
      "홍길동/졸업생/컴퓨터공학과",
      "홍길동/학생",
      "홍길동1/학생/컴퓨터공학과",
      "홍길동/학생/@@",
      " 홍길동 / 직원 / 학생지원팀 ",
      "홍길동",
      "",
    ]) {
      expect(Boolean(classifyDisplayName(raw).wouldSplit), raw).toBe(parseGoogleDisplayName(raw) !== null);
    }
    expect(classifyDisplayName("홍길동/학생/컴퓨터공학과").affiliationLevel).toBe("department_like");
    expect(classifyDisplayName("홍길동/학생/인공지능·소프트웨어융합대학").affiliationLevel).toBe("college_like");
  });
});
