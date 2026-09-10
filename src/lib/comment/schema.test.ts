import { describe, expect, it } from "vitest";

import { createCommentSchema, updateCommentSchema } from "./schema";

// Phase 12-5: same organizationId shape/reasoning as posts/schema.test.ts's
// own createLostPostSchema/updateLostPostSchema coverage -- mirrored here
// for Comment.
describe("createCommentSchema -- organizationId (Phase 12-5)", () => {
  it("accepts a payload with no organizationId at all (personal comment)", () => {
    const result = createCommentSchema.safeParse({ content: "댓글입니다" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBeUndefined();
  });

  it("accepts organizationId: null (explicit personal comment)", () => {
    const result = createCommentSchema.safeParse({ content: "댓글입니다", organizationId: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBeNull();
  });

  it("accepts a positive integer organizationId", () => {
    const result = createCommentSchema.safeParse({ content: "댓글입니다", organizationId: 10 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.organizationId).toBe(10);
  });

  it("rejects a non-positive organizationId", () => {
    expect(createCommentSchema.safeParse({ content: "댓글입니다", organizationId: 0 }).success).toBe(false);
    expect(createCommentSchema.safeParse({ content: "댓글입니다", organizationId: -1 }).success).toBe(false);
  });
});

describe("updateCommentSchema -- organizationId immutability (Phase 12-5 §20)", () => {
  it("silently strips organizationId from an update payload instead of applying it", () => {
    const result = updateCommentSchema.safeParse({ content: "수정된 댓글", organizationId: 999 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("organizationId");
  });
});
