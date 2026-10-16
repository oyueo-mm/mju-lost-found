import { beforeEach, describe, expect, it, vi } from "vitest";

// 개인정보 동의·처리방침 구조 (auth/terms.ts, lib/policy/privacyPolicy.ts):
//  1. a policy revision alone never sends anyone to the consent screen;
//  2. only dropping a version from ACCEPTED_PRIVACY_VERSIONS (a change that
//     needs everyone's new consent) does;
//  3. records stay exact -- a new consent records the current screen
//     version, an accepted earlier record is never rewritten.

const auth = vi.fn();
const findUnique = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ auth }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/auth/access", () => ({ hasOngoingExternalAccess: vi.fn(), userTypeForEmail: vi.fn() }));
vi.mock("@/lib/auth/withdrawnIdentity", () => ({ consumeApprovedRejoin: vi.fn(), findHeldIdentity: vi.fn() }));

// An in-memory User row; updateMany applies Prisma's { id, OR: [...] } with
// the null / not / notIn conditions recordRequiredConsents uses.
let row: Record<string, unknown> = {};
const matches = (cond: Record<string, unknown>) =>
  Object.entries(cond).every(([k, v]) =>
    v === null
      ? row[k] === null
      : typeof v === "object" && v && "notIn" in v
        ? !(v.notIn as unknown[]).includes(row[k])
        : typeof v === "object" && v && "not" in v
          ? row[k] !== v.not
          : row[k] === v,
  );
const tx = {
  user: {
    updateMany: async ({ where, data }: { where: { id: number; OR: Record<string, unknown>[] }; data: Record<string, unknown> }) => {
      if (row.id !== where.id || !where.OR.some(matches)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    findUniqueOrThrow: async () => ({ ...row }),
    findUnique: (...args: unknown[]) => findUnique(...args),
  },
};
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) }, $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }));

const productionMember = {
  id: 1,
  nickname: "기존회원",
  userType: "STUDENT",
  deletedAt: null,
  isSuspended: false,
  suspendedUntil: null,
  privacyConsentAt: new Date("2026-10-14T03:00:00Z"),
  privacyConsentVersion: "2026-10-14",
  termsAcceptedAt: new Date("2026-10-14T03:00:00Z"),
  termsVersion: "2026-10-04",
  identityConsentAt: new Date("2026-10-14T03:00:00Z"),
  identityConsentVersion: "2026-10-14",
};

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/policy/privacyPolicy");
  vi.doUnmock("@/lib/auth/terms");
  auth.mockReset().mockResolvedValue({ user: { id: "1" } });
  findUnique.mockReset();
});

describe("1. 처리방침 개정만으로는 재동의 없음", () => {
  it("a new revision date changes the policy and the notice, not anyone's consent", async () => {
    vi.doMock("@/lib/policy/privacyPolicy", async () => {
      const actual = await vi.importActual<typeof import("@/lib/policy/privacyPolicy")>("@/lib/policy/privacyPolicy");
      const next = { date: "2027-03-01", summary: "개인정보 처리 위탁 업체 정보를 갱신했습니다.", consent: "notice" as const };
      return { ...actual, PRIVACY_POLICY_REVISIONS: [next, ...actual.PRIVACY_POLICY_REVISIONS], PRIVACY_POLICY_EFFECTIVE_DATE: next.date, LATEST_PRIVACY_POLICY_REVISION: next };
    });
    const { hasRequiredConsents, requireReadyUser } = await import("./session");
    const { privacyNotice } = await import("@/lib/policy/privacyNotice");
    findUnique.mockResolvedValue(productionMember);

    expect(hasRequiredConsents(productionMember)).toBe(true);
    await expect(requireReadyUser()).resolves.toMatchObject({ id: 1 });
    expect(privacyNotice("2027-02-25")?.text).toBe("개인정보처리방침이 2027년 3월 1일부터 변경됩니다.");
  });
});

describe("2. 새 동의가 필요한 변경만 동의 화면으로", () => {
  it("sends members on a dropped version to the consent screen, and only them", async () => {
    vi.doMock("@/lib/auth/terms", async () => {
      const actual = await vi.importActual<typeof import("./terms")>("./terms");
      const accepted = ["2027-03-01"]; // a change that needs everyone's new consent
      return {
        ...actual,
        CURRENT_PRIVACY_VERSION: "2027-03-01",
        ACCEPTED_PRIVACY_VERSIONS: accepted,
        isAcceptedPrivacyVersion: (v: string | null) => actual.isAcceptedPrivacyVersion(v, accepted),
      };
    });
    const { requireReadyUser } = await import("./session");
    findUnique.mockResolvedValue(productionMember);
    await expect(requireReadyUser()).rejects.toThrow("REDIRECT:/privacy-consent");
    findUnique.mockResolvedValue({ ...productionMember, privacyConsentVersion: "2027-03-01" });
    await expect(requireReadyUser()).resolves.toMatchObject({ id: 1 });
  });

  it("keeps everyone in when the screen only explains more (earlier version still accepted)", async () => {
    const { isAcceptedPrivacyVersion } = await import("./terms");
    expect(isAcceptedPrivacyVersion("2026-10-14", ["2027-03-01", "2026-10-16", "2026-10-14"])).toBe(true);
    expect(isAcceptedPrivacyVersion("2026-10-14", ["2027-03-01"])).toBe(false);
  });
});

describe("3. 동의 기록이 정확하게 유지", () => {
  it("records a new member's consent with the current versions", async () => {
    const { recordRequiredConsents } = await import("./user");
    const { CURRENT_IDENTITY_CONSENT_VERSION, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } = await import("./terms");
    row = { id: 9, privacyConsentAt: null, privacyConsentVersion: null, termsAcceptedAt: null, termsVersion: null, identityConsentAt: null, identityConsentVersion: null };
    const user = await recordRequiredConsents(9, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, CURRENT_IDENTITY_CONSENT_VERSION);
    expect(user).toMatchObject({ privacyConsentVersion: "2026-10-16", termsVersion: "2026-10-04", identityConsentVersion: "2026-10-14" });
  });

  it("leaves an accepted earlier record as it is (only the outdated terms are stamped)", async () => {
    const { recordRequiredConsents } = await import("./user");
    const { CURRENT_IDENTITY_CONSENT_VERSION, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } = await import("./terms");
    const at = new Date("2026-10-14T03:00:00Z");
    row = { id: 1, privacyConsentAt: at, privacyConsentVersion: "2026-10-14", termsAcceptedAt: at, termsVersion: "2026-09-27", identityConsentAt: at, identityConsentVersion: "2026-10-14" };
    const user = await recordRequiredConsents(1, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, CURRENT_IDENTITY_CONSENT_VERSION);
    expect(user).toMatchObject({ privacyConsentVersion: "2026-10-14", privacyConsentAt: at, identityConsentVersion: "2026-10-14", termsVersion: "2026-10-04" });
    expect(user.termsAcceptedAt).not.toBe(at);
  });

  it("re-stamps a record that is no longer accepted", async () => {
    const { recordRequiredConsents } = await import("./user");
    row = { id: 2, privacyConsentAt: new Date(), privacyConsentVersion: "2026-10-05", termsAcceptedAt: new Date(), termsVersion: "2026-10-04", identityConsentAt: null, identityConsentVersion: null };
    const user = await recordRequiredConsents(2, "2026-10-04", "2026-10-16", "2026-10-14");
    expect(user).toMatchObject({ privacyConsentVersion: "2026-10-16", identityConsentVersion: "2026-10-14" });
  });
});
