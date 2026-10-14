import { describe, expect, it, vi } from "vitest";

import { fetchDepartmentHint, GOOGLE_ORG_SCOPE, googleScopes, nameHintFromProfile, sourceOf } from "./googleHints";

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
