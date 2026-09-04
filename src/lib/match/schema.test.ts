import { describe, expect, it } from "vitest";

import { createMatchSchema, matchQuerySchema } from "./schema";

describe("createMatchSchema", () => {
  it("accepts a valid lostPostId/foundPostId pair", () => {
    expect(createMatchSchema.safeParse({ lostPostId: 1, foundPostId: 2 }).success).toBe(true);
  });

  it("accepts an optional score between 0 and 1", () => {
    expect(createMatchSchema.safeParse({ lostPostId: 1, foundPostId: 2, score: 0.8 }).success).toBe(
      true,
    );
  });

  it("rejects a score outside 0-1", () => {
    expect(createMatchSchema.safeParse({ lostPostId: 1, foundPostId: 2, score: 1.5 }).success).toBe(
      false,
    );
  });

  it("rejects a missing lostPostId or foundPostId", () => {
    expect(createMatchSchema.safeParse({ foundPostId: 2 }).success).toBe(false);
    expect(createMatchSchema.safeParse({ lostPostId: 1 }).success).toBe(false);
  });

  it("rejects a non-positive id", () => {
    expect(createMatchSchema.safeParse({ lostPostId: 0, foundPostId: 2 }).success).toBe(false);
    expect(createMatchSchema.safeParse({ lostPostId: 1, foundPostId: -1 }).success).toBe(false);
  });

  // The schema itself only ever accepts one lostPostId (looked up against
  // LostPost) and one foundPostId (looked up against FoundPost) -- there's
  // no way to express "two lost posts" or "two found posts" through this
  // shape at all, which is what actually enforces the Lost<->Found-only
  // direction rule, on top of the service layer's existence checks.
  it("has no way to express two ids of the same board", () => {
    const shape = createMatchSchema.shape;
    expect(Object.keys(shape).sort()).toEqual(["foundPostId", "lostPostId", "score"].sort());
  });
});

describe("matchQuerySchema", () => {
  it("accepts neither postId nor type", () => {
    expect(matchQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts both postId and type together", () => {
    expect(matchQuerySchema.safeParse({ postId: "1", type: "lost" }).success).toBe(true);
  });

  it("rejects postId without type", () => {
    expect(matchQuerySchema.safeParse({ postId: "1" }).success).toBe(false);
  });

  it("rejects type without postId", () => {
    expect(matchQuerySchema.safeParse({ type: "lost" }).success).toBe(false);
  });
});
