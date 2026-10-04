import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/posts/service", () => ({ deletePostRowInTx: vi.fn(), deletePostStorageObjects: vi.fn() }));
vi.mock("@/lib/images/chatStorage", () => ({ deleteChatImageSafely: vi.fn() }));
vi.mock("@/lib/auth/user", () => ({ soleLeaderOrganizationNames: vi.fn() }));

const { holdReasonsFor } = await import("./withdrawal");

const none = { activeSuspension: false, pendingReports: 0, pendingProposals: 0, pendingAppeals: 0 };

describe("holdReasonsFor (when a WithdrawnIdentity is kept)", () => {
  it("nothing open -> no hold (plain withdrawal, free re-signup)", () => {
    expect(holdReasonsFor(none)).toEqual([]);
  });

  it("each open sanction matter is a reason on its own", () => {
    expect(holdReasonsFor({ ...none, activeSuspension: true })).toEqual(["active_suspension"]);
    expect(holdReasonsFor({ ...none, pendingReports: 2 })).toEqual(["pending_report"]);
    expect(holdReasonsFor({ ...none, pendingProposals: 1 })).toEqual(["pending_sanction_proposal"]);
    expect(holdReasonsFor({ ...none, pendingAppeals: 1 })).toEqual(["pending_appeal"]);
  });

  it("collects every reason that applies", () => {
    expect(holdReasonsFor({ activeSuspension: true, pendingReports: 1, pendingProposals: 1, pendingAppeals: 1 })).toEqual([
      "active_suspension",
      "pending_report",
      "pending_sanction_proposal",
      "pending_appeal",
    ]);
  });
});
