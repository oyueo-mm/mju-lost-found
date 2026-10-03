import { describe, expect, it } from "vitest";

import { applyCommentRemoval } from "./commentRemoval";

const c = (id: number, parentId: number | null, isDeleted = false) => ({
  id,
  parentId,
  content: isDeleted ? "" : `댓글 ${id}`,
  isDeleted,
});

describe("applyCommentRemoval", () => {
  it("removes a comment without replies", () => {
    expect(applyCommentRemoval([c(1, null), c(2, null)], 1)).toEqual([c(2, null)]);
  });

  it("keeps a comment with replies as a tombstone and keeps every reply", () => {
    const next = applyCommentRemoval([c(1, null), c(2, 1), c(3, 2)], 1);

    expect(next).toEqual([c(1, null, true), c(2, 1), c(3, 2)]);
  });

  it("removes a tombstoned parent once its last reply is removed, walking up the chain", () => {
    const next = applyCommentRemoval([c(1, null, true), c(2, 1, true), c(3, 2), c(9, null)], 3);

    expect(next).toEqual([c(9, null)]);
  });

  it("keeps a tombstoned parent that still has other replies", () => {
    const next = applyCommentRemoval([c(1, null, true), c(2, 1), c(3, 1)], 2);

    expect(next).toEqual([c(1, null, true), c(3, 1)]);
  });

  it("never removes a live parent when its reply is removed", () => {
    expect(applyCommentRemoval([c(1, null), c(2, 1)], 2)).toEqual([c(1, null)]);
  });
});
