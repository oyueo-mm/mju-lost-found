import { describe, expect, it } from "vitest";

import { adminMutationResultToResponse } from "@/lib/moderation/response";
import {
  adminActionProposalMutationResultToResponse,
  adminUserMutationResultToResponse,
  LAST_ADMIN_MESSAGE,
} from "./response";

// 관리자 승인 인원 정책 Phase: every path that can end up refusing an action
// because it would leave 0 active admins answers 409 with the same message.
describe("last_admin responses", () => {
  it("maps the user-management result to 409", async () => {
    const res = adminUserMutationResultToResponse({ kind: "last_admin" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(LAST_ADMIN_MESSAGE);
  });

  it("maps the proposal result to 409", async () => {
    const res = adminActionProposalMutationResultToResponse({ kind: "last_admin" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(LAST_ADMIN_MESSAGE);
  });

  it("maps the report-moderation result to 409", async () => {
    const res = adminMutationResultToResponse({ kind: "last_admin" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(LAST_ADMIN_MESSAGE);
  });
});
