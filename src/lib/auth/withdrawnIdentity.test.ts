import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn();
const findFirst = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { withdrawnIdentity: { count, findFirst } } }));
const releaseResolvedWithdrawnIdentities = vi.fn<(ids?: number[]) => Promise<number[]>>(async () => []);
vi.mock("@/lib/auth/identityRelease", () => ({ releaseResolvedWithdrawnIdentities }));

const { identityHmac, identitySubject, findHeldIdentity, MissingIdentitySecretError } = await import("./withdrawnIdentity");

const SECRET = "x".repeat(40);

beforeEach(() => {
  vi.stubEnv("WITHDRAWN_IDENTITY_SECRET", SECRET);
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("identityHmac", () => {
  it("is a keyed HMAC-SHA256: deterministic, hex, never the input itself", () => {
    const a = identityHmac("google:1234567890");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(identityHmac("google:1234567890"));
    expect(a).not.toContain("1234567890");
  });

  it("depends on the server secret (a DB copy alone can't recompute it)", () => {
    const a = identityHmac("google:1");
    vi.stubEnv("WITHDRAWN_IDENTITY_SECRET", "y".repeat(40));
    expect(identityHmac("google:1")).not.toBe(a);
  });

  it("refuses to run without a (long enough) secret", () => {
    vi.stubEnv("WITHDRAWN_IDENTITY_SECRET", "");
    expect(() => identityHmac("google:1")).toThrow(MissingIdentitySecretError);
    vi.stubEnv("WITHDRAWN_IDENTITY_SECRET", "short");
    expect(() => identityHmac("google:1")).toThrow(MissingIdentitySecretError);
  });
});

describe("identitySubject", () => {
  it("keys on the Google id, falling back to the normalised e-mail", () => {
    expect(identitySubject({ googleId: "42", email: "A@x.com" })).toBe("google:42");
    expect(identitySubject({ googleId: null, email: " A@X.com " })).toBe("email:a@x.com");
  });
});

describe("findHeldIdentity", () => {
  it("does nothing (and needs no secret) while no hold exists", async () => {
    vi.stubEnv("WITHDRAWN_IDENTITY_SECRET", "");
    count.mockResolvedValueOnce(0);
    expect(await findHeldIdentity({ googleId: "1", email: "a@x.com" })).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("fails closed when holds exist but the secret is missing", async () => {
    vi.stubEnv("WITHDRAWN_IDENTITY_SECRET", "");
    count.mockResolvedValueOnce(1);
    await expect(findHeldIdentity({ googleId: "1", email: "a@x.com" })).rejects.toThrow(MissingIdentitySecretError);
  });

  it("looks up only by HMACs of the google id and e-mail, active and unexpired", async () => {
    count.mockResolvedValueOnce(1);
    findFirst.mockResolvedValueOnce({ id: 9, rejoinRequests: [{ id: 3, status: "PENDING", consumedAt: null }] });
    const held = await findHeldIdentity({ googleId: "1", email: "a@x.com" });
    expect(held).toEqual({ id: 9, latestRequest: { id: 3, status: "PENDING", consumedAt: null } });
    const where = findFirst.mock.calls[0][0].where;
    expect(where.identityHmac.in).toEqual([identityHmac("google:1"), identityHmac("email:a@x.com")]);
    expect(JSON.stringify(where)).not.toContain("a@x.com");
    expect(where.status).toBe("ACTIVE");
  });

  it("a hold whose purpose has ended is released at sign-in -> normal sign-up", async () => {
    count.mockResolvedValueOnce(1);
    findFirst.mockResolvedValueOnce({ id: 9, rejoinRequests: [] });
    releaseResolvedWithdrawnIdentities.mockResolvedValueOnce([9]);
    expect(await findHeldIdentity({ googleId: "1", email: "a@x.com" })).toBeNull();
    expect(releaseResolvedWithdrawnIdentities).toHaveBeenCalledWith([9]);
  });
});
