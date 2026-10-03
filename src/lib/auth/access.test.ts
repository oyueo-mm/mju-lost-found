import { beforeEach, describe, expect, it, vi } from "vitest";

const grantFindUnique = vi.fn();
const isGoogleTestModeEnabled = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { externalAccessGrant: { findUnique: grantFindUnique } } }));
vi.mock("@/lib/settings/service", () => ({ isGoogleTestModeEnabled }));
vi.mock("@/generated/prisma/client", () => ({
  UserType: { STUDENT: "STUDENT", EXTERNAL_VERIFIED: "EXTERNAL_VERIFIED", EXTERNAL_TEST: "EXTERNAL_TEST" },
  ExternalAccessStatus: { ACTIVE: "ACTIVE", REVOKED: "REVOKED" },
}));

const { decideSignIn, hasOngoingExternalAccess, userTypeForEmail } = await import("./access");

beforeEach(() => {
  vi.clearAllMocks();
  grantFindUnique.mockResolvedValue(null);
  isGoogleTestModeEnabled.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("decideSignIn", () => {
  it("lets any @mju.ac.kr account in as STUDENT, without looking up approvals", async () => {
    expect(await decideSignIn("student@mju.ac.kr", true)).toEqual({ allowed: true, userType: "STUDENT" });
    expect(await decideSignIn("Staff@MJU.ac.kr", undefined)).toEqual({ allowed: true, userType: "STUDENT" });
    expect(grantFindUnique).not.toHaveBeenCalled();
  });

  it("lets an approved external email in as EXTERNAL_VERIFIED (case-insensitively)", async () => {
    grantFindUnique.mockResolvedValueOnce({ status: "ACTIVE" });

    expect(await decideSignIn("Guard.Kim@Gmail.com", true)).toEqual({ allowed: true, userType: "EXTERNAL_VERIFIED" });
    expect(grantFindUnique).toHaveBeenCalledWith({ where: { email: "guard.kim@gmail.com" }, select: { status: true } });
  });

  it("refuses an unapproved external account while test mode is off", async () => {
    expect(await decideSignIn("someone@gmail.com", true)).toEqual({ allowed: false, reason: "not_allowed" });
  });

  it("keeps the existing test-mode rule for unapproved accounts (EXTERNAL_TEST)", async () => {
    isGoogleTestModeEnabled.mockResolvedValueOnce(true);
    expect(await decideSignIn("someone@gmail.com", true)).toEqual({ allowed: true, userType: "EXTERNAL_TEST" });
  });

  it("always refuses a revoked approval -- even while test mode is on", async () => {
    grantFindUnique.mockResolvedValue({ status: "REVOKED" });
    isGoogleTestModeEnabled.mockResolvedValue(true);

    expect(await decideSignIn("guard@gmail.com", true)).toEqual({ allowed: false, reason: "revoked" });
    expect(isGoogleTestModeEnabled).not.toHaveBeenCalled();
  });

  it("refuses an unverified Google email, even @mju.ac.kr", async () => {
    expect(await decideSignIn("student@mju.ac.kr", false)).toEqual({ allowed: false, reason: "unverified_email" });
    expect(await decideSignIn(null, true)).toEqual({ allowed: false, reason: "unverified_email" });
  });

  it("fails closed if the test-mode setting can't be read", async () => {
    isGoogleTestModeEnabled.mockRejectedValueOnce(new Error("db down"));
    expect(await decideSignIn("someone@gmail.com", true)).toEqual({ allowed: false, reason: "not_allowed" });
  });

  it("is not fooled by a lookalike domain", async () => {
    expect((await decideSignIn("x@mju.ac.kr.evil.com", true)).allowed).toBe(false);
    expect((await decideSignIn("x@notmju.ac.kr.com", true)).allowed).toBe(false);
  });
});

describe("userTypeForEmail", () => {
  it("is derived from the server-side approval state only", async () => {
    expect(await userTypeForEmail("a@mju.ac.kr")).toBe("STUDENT");
    grantFindUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    expect(await userTypeForEmail("guard@gmail.com")).toBe("EXTERNAL_VERIFIED");
    expect(await userTypeForEmail("other@gmail.com")).toBe("EXTERNAL_TEST");
  });
});

describe("hasOngoingExternalAccess (checked on every request)", () => {
  it("keeps an approved external account signed in", async () => {
    grantFindUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    expect(await hasOngoingExternalAccess({ email: "guard@gmail.com", userType: "EXTERNAL_VERIFIED" as never })).toBe(true);
  });

  it("cuts off an external account whose approval was revoked or removed", async () => {
    grantFindUnique.mockResolvedValueOnce({ status: "REVOKED" });
    expect(await hasOngoingExternalAccess({ email: "guard@gmail.com", userType: "EXTERNAL_VERIFIED" as never })).toBe(false);
    grantFindUnique.mockResolvedValueOnce(null);
    expect(await hasOngoingExternalAccess({ email: "guard@gmail.com", userType: "EXTERNAL_VERIFIED" as never })).toBe(false);
  });

  it("leaves a test-mode account alone unless its email was explicitly revoked", async () => {
    expect(await hasOngoingExternalAccess({ email: "t@gmail.com", userType: "EXTERNAL_TEST" as never })).toBe(true);
    grantFindUnique.mockResolvedValueOnce({ status: "REVOKED" });
    expect(await hasOngoingExternalAccess({ email: "t@gmail.com", userType: "EXTERNAL_TEST" as never })).toBe(false);
  });
});
