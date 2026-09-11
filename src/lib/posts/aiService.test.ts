import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/generated/prisma/client";

const lostPost = {
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};
const foundPost = {
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};
// Phase 23: updateLostPost/updateFoundPost invalidate this cache after a
// re-embed -- see aiService.ts's invalidateMatchCandidateCache().
const matchCandidateCache = { deleteMany: vi.fn() };

// Phase H-5-1: createLostPost/createFoundPost/updateLostPost/updateFoundPost
// now defer embedPostBestEffort() (and, for updates, the match-candidate-
// cache invalidation alongside it) into next/server's after() instead of
// awaiting them directly -- see aiService.ts's own comments. after() only
// works inside a real Next.js request scope, which this unit-test suite
// has none of, so it's mocked here to *capture* the callback instead of
// running it -- tests that care whether the deferred work eventually runs
// call flushAfterCallbacks() explicitly (rather than relying on real
// microtask-ordering timing, which would make these tests fragile), and a
// dedicated test below asserts the callback is captured but NOT yet run
// by the time the service function itself returns, which is the actual
// behavior this phase changes.
let afterCallbacks: Array<() => unknown> = [];
const after = vi.fn((callback: () => unknown) => {
  afterCallbacks.push(callback);
});
async function flushAfterCallbacks() {
  const callbacks = afterCallbacks.splice(0);
  await Promise.all(callbacks.map((cb) => cb()));
}
vi.mock("next/server", () => ({ after }));

const embedPostBestEffort = vi.fn();
// Phase 12: semantic search's two collaborators, mocked wholesale --
// never loading the real ~106MB model or issuing a real $queryRaw in this
// fast unit-test suite, same convention as postEmbedding's own tests.
const embed = vi.fn();
const findPostsBySemanticQuery = vi.fn();
// Phase 32: image search's own collaborators, mocked the same way.
const imageEmbed = vi.fn();
const findPostsByImageQuery = vi.fn();

vi.mock("@/lib/db/prisma", () => ({ prisma: { lostPost, foundPost, matchCandidateCache } }));
vi.mock("@/generated/prisma/client", () => ({
  LostPostStatus: { SEARCHING: "SEARCHING", FOUND: "FOUND" },
  FoundPostStatus: { KEEPING: "KEEPING", COMPLETED: "COMPLETED" },
}));
// Likewise: embedPostBestEffort() actually loading the real ~106MB ONNX
// model has no place in a fast unit-test suite (see its own tests in
// src/lib/ai/embedding.test.ts) -- mocked wholesale here so these tests
// only assert *whether* aiService.ts calls it. EMBEDDING_INPUT_FIELDS is
// redeclared verbatim (not imported from the real module) so this mock
// factory can't accidentally pull in anything heavier.
vi.mock("@/lib/ai/postEmbedding", () => ({
  EMBEDDING_INPUT_FIELDS: ["title", "description", "category", "location"],
  embedPostBestEffort,
}));
vi.mock("@/lib/ai/embedding", () => ({ getEmbeddingProvider: () => ({ embed }) }));
vi.mock("@/lib/ai/imageEmbedding", () => ({ getImageEmbeddingProvider: () => ({ embed: imageEmbed }) }));
vi.mock("@/lib/ai/vectorSearch", () => ({ findPostsBySemanticQuery, findPostsByImageQuery }));
// Phase 12-5: organization/service.ts's own import chain (authz.ts,
// generated Prisma enums for OrganizationRole/Status/RequestStatus) has
// nothing to do with what this file tests -- only validateOrganizationPosting()
// is actually called by aiService.ts's createLostPost/createFoundPost, and
// only when a test explicitly passes organizationId, so it's stubbed
// directly, same "mock a heavy sibling module wholesale" convention this
// file already uses for @/lib/ai/*.
const validateOrganizationPosting = vi.fn();
vi.mock("@/lib/organization/service", () => ({ validateOrganizationPosting }));

// Phase 21: this module (aiService.ts) is what actually houses
// createLostPost/updateLostPost/createFoundPost/updateFoundPost, and
// searchPosts (the AI-aware superset) after the posts/service.ts split --
// see that file's own comment. Its searchPosts() delegates non-semantic
// dispatch to the real (unmocked) ./service module, so this test file
// exercises that delegation end-to-end rather than mocking it away.
const {
  createFoundPost,
  createLostPost,
  updateFoundPost,
  updateLostPost,
  searchPosts,
  searchPostsByImage,
  searchPostsAI,
} = await import("./aiService");

// A minimal stand-in for the Prisma User type -- these tests only exercise
// aiService.ts's own logic (author id, suspension check), never Prisma
// itself (mocked above), so the full User shape isn't needed.
const author = {
  id: 1,
  email: "author@mju.ac.kr",
  isSuspended: false,
  suspendedUntil: null,
} as unknown as User;

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: "지갑을 잃어버렸어요",
    description: "검은색 가죽 지갑",
    category: "지갑",
    location: "학생회관",
    status: "SEARCHING",
    imageUrl: null,
    lostAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    user: { id: 1, nickname: "닉네임" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks = [];
  lostPost.findMany.mockResolvedValue([]);
  lostPost.count.mockResolvedValue(0);
  foundPost.findMany.mockResolvedValue([]);
  foundPost.count.mockResolvedValue(0);
});

describe("createLostPost / createFoundPost", () => {
  it("sets the author from the session user, not from the input", async () => {
    lostPost.create.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    await createLostPost(author, {
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      campus: "인문캠퍼스",
      lostAt: new Date(),
    });

    expect(lostPost.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: author.id }) }),
    );
  });

  it("generates an embedding for the newly created post", async () => {
    const created = {
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    };
    lostPost.create.mockResolvedValueOnce(created);

    await createLostPost(author, {
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      campus: "인문캠퍼스",
      lostAt: new Date(),
    });
    await flushAfterCallbacks();

    expect(embedPostBestEffort).toHaveBeenCalledWith("lost", 1, expect.objectContaining({ title: "t" }));
  });

  // Phase H-5-1: the actual point of this phase -- embedding must not run
  // (or be awaited) before createLostPost's own response is ready, only
  // once the deferred after() callback is explicitly run afterward.
  it("does not run the embedding until the deferred after() callback is flushed", async () => {
    lostPost.create.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await createLostPost(author, {
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      campus: "인문캠퍼스",
      lostAt: new Date(),
    });

    expect(result.kind).toBe("ok"); // the response is ready immediately...
    expect(after).toHaveBeenCalledTimes(1); // ...with the embedding only *registered*...
    expect(embedPostBestEffort).not.toHaveBeenCalled(); // ...not yet run.

    await flushAfterCallbacks();
    expect(embedPostBestEffort).toHaveBeenCalledWith("lost", 1, expect.objectContaining({ title: "t" }));
  });

  // Phase P-5: null location/lostAt (위치/시간 미상) must not block creation
  // or the embedding step -- buildEmbeddingText() (src/lib/ai/embedding.ts)
  // already skips a falsy field, so passing the row through unchanged
  // (including its null location) is the correct, minimal behavior here.
  it("creates a post with location and lostAt both null (위치/시간 미상) and still embeds it", async () => {
    lostPost.create.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: null,
      status: "SEARCHING",
      imageUrl: null,
      lostAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await createLostPost(author, {
      title: "t",
      description: "d",
      category: "c",
      location: null,
      campus: "인문캠퍼스",
      lostAt: null,
    });
    await flushAfterCallbacks();

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.location).toBeNull();
      expect(result.data.lostAt).toBeNull();
    }
    expect(lostPost.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ location: null, lostAt: null }) }),
    );
    expect(embedPostBestEffort).toHaveBeenCalledWith("lost", 1, expect.objectContaining({ location: null }));
  });

  it("rejects post creation for a suspended user without writing to the DB", async () => {
    const suspended = { ...author, isSuspended: true, suspendedUntil: null };

    const result = await createFoundPost(suspended, {
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      campus: "인문캠퍼스",
      foundAt: new Date(),
    });

    expect(result).toEqual({ kind: "forbidden", reason: "suspended" });
    expect(foundPost.create).not.toHaveBeenCalled();
    expect(embedPostBestEffort).not.toHaveBeenCalled();
  });
});

// Phase 12-5 §31: organization attribution on post creation --
// validateOrganizationPosting() (mocked at the top of this file) is the
// single source of truth this suite verifies is actually consulted and
// actually respected; the specific existence/ACTIVE/membership logic
// itself is covered by organization/service.test.ts's own
// validateOrganizationPosting tests, not duplicated here.
describe("createLostPost / createFoundPost -- organization attribution (Phase 12-5)", () => {
  const lostInput = {
    title: "t",
    description: "d",
    category: "c",
    location: "l",
    campus: "인문캠퍼스" as const,
    lostAt: new Date(),
  };

  it("organizationId omitted -- personal post, validateOrganizationPosting never called", async () => {
    lostPost.create.mockResolvedValueOnce({
      id: 1,
      ...lostInput,
      status: "SEARCHING",
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
      organization: null,
    });

    const result = await createLostPost(author, lostInput);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.organizationId).toBeNull();
      expect(result.data.organizationName).toBeNull();
    }
    expect(validateOrganizationPosting).not.toHaveBeenCalled();
    const callArgs = lostPost.create.mock.calls[0][0];
    expect(callArgs.data).not.toHaveProperty("organizationId");
  });

  it("organizationId: null -- explicit personal post, same as omitted", async () => {
    lostPost.create.mockResolvedValueOnce({
      id: 1,
      ...lostInput,
      status: "SEARCHING",
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
      organization: null,
    });

    const result = await createLostPost(author, { ...lostInput, organizationId: null });

    expect(result.kind).toBe("ok");
    expect(validateOrganizationPosting).not.toHaveBeenCalled();
  });

  it("ACTIVE organization + active member -- succeeds and persists organizationId", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "ok" });
    lostPost.create.mockResolvedValueOnce({
      id: 1,
      ...lostInput,
      status: "SEARCHING",
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
      organization: { id: 10, name: "도서관 자치 위원회" },
    });

    const result = await createLostPost(author, { ...lostInput, organizationId: 10 });

    expect(validateOrganizationPosting).toHaveBeenCalledWith(author.id, 10);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.organizationId).toBe(10);
      expect(result.data.organizationName).toBe("도서관 자치 위원회");
    }
    expect(lostPost.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: 10 }) }),
    );
  });

  it("non-member -- rejected as forbidden without writing to the DB", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await createLostPost(author, { ...lostInput, organizationId: 10 });

    expect(result).toEqual({ kind: "forbidden", reason: "organization_not_member" });
    expect(lostPost.create).not.toHaveBeenCalled();
  });

  it("INACTIVE organization -- rejected even for an existing member", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "inactive_organization" });

    const result = await createLostPost(author, { ...lostInput, organizationId: 10 });

    expect(result).toEqual({ kind: "forbidden", reason: "organization_inactive" });
    expect(lostPost.create).not.toHaveBeenCalled();
  });

  it("nonexistent organizationId -- not_found", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "not_found" });

    const result = await createLostPost(author, { ...lostInput, organizationId: 999999 });

    expect(result).toEqual({ kind: "forbidden", reason: "organization_not_found" });
    expect(lostPost.create).not.toHaveBeenCalled();
  });

  // §31 role spoofing: this suite has no way to even *send* a client
  // "role" field -- CreateLostPostInput only carries organizationId (see
  // posts/schema.ts) -- so the only thing createLostPost ever passes to
  // validateOrganizationPosting is (author.id, organizationId), never
  // anything client-supplied about role/membership. Asserting the exact
  // call signature here is what proves a spoofed role has nowhere to go.
  it("never passes anything but (userId, organizationId) to validateOrganizationPosting -- no role field exists to spoof", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "ok" });
    lostPost.create.mockResolvedValueOnce({
      id: 1,
      ...lostInput,
      status: "SEARCHING",
      imageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
      organization: { id: 10, name: "org" },
    });

    await createLostPost(author, { ...lostInput, organizationId: 10 });

    expect(validateOrganizationPosting).toHaveBeenCalledWith(author.id, 10);
    expect(validateOrganizationPosting.mock.calls[0]).toHaveLength(2);
  });

  it("suspended user is rejected before organization validation even runs", async () => {
    const suspended = { ...author, isSuspended: true, suspendedUntil: null };

    const result = await createLostPost(suspended, { ...lostInput, organizationId: 10 });

    expect(result).toEqual({ kind: "forbidden", reason: "suspended" });
    expect(validateOrganizationPosting).not.toHaveBeenCalled();
    expect(lostPost.create).not.toHaveBeenCalled();
  });

  it("createFoundPost -- same organization gate as createLostPost", async () => {
    validateOrganizationPosting.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await createFoundPost(author, {
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      campus: "인문캠퍼스",
      foundAt: new Date(),
      organizationId: 10,
    });

    expect(result).toEqual({ kind: "forbidden", reason: "organization_not_member" });
    expect(foundPost.create).not.toHaveBeenCalled();
  });
});

describe("updateLostPost", () => {
  it("allows the owner to update their own post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "새 제목",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await updateLostPost(1, 1, { title: "새 제목" });

    expect(result.kind).toBe("ok");
  });

  // Phase 12-7 §4: organizationId omitted from the update input entirely
  // -- attribution must stay untouched (this is what distinguishes
  // "omitted" from an explicit organizationId: null, tested separately
  // below in the dedicated organization-attribution describe block).
  it("leaves organizationId untouched when omitted from the update input", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "새 제목",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
      organization: { id: 10, name: "원래 단체" },
    });

    await updateLostPost(1, 1, { title: "새 제목" });

    const callArgs = lostPost.update.mock.calls[0][0];
    expect(callArgs.data).not.toHaveProperty("organizationId");
    expect(validateOrganizationPosting).not.toHaveBeenCalled();
  });

  it("re-embeds when an embedding-relevant field (title) changes", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "새 제목",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    await updateLostPost(1, 1, { title: "새 제목" });
    await flushAfterCallbacks();

    expect(embedPostBestEffort).toHaveBeenCalledWith("lost", 1, expect.objectContaining({ title: "새 제목" }));
  });

  // Phase P-5: 미상 <-> known transitions must round-trip through a plain
  // update, same as any other field edit -- location re-embeds (it's an
  // EMBEDDING_INPUT_FIELDS member); lostAt does not (it never was).
  it("updates location from a known value to null (known -> 위치 미상) and re-embeds", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: null,
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await updateLostPost(1, 1, { location: null });
    await flushAfterCallbacks();

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.location).toBeNull();
    expect(lostPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ location: null }) }),
    );
    expect(embedPostBestEffort).toHaveBeenCalledWith("lost", 1, expect.objectContaining({ location: null }));
  });

  it("updates location from null to a real value (위치 미상 -> known) and re-embeds", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: "학생회관 2층",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await updateLostPost(1, 1, { location: "학생회관 2층" });
    await flushAfterCallbacks();

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.location).toBe("학생회관 2층");
    expect(embedPostBestEffort).toHaveBeenCalledWith(
      "lost",
      1,
      expect.objectContaining({ location: "학생회관 2층" }),
    );
  });

  it("updates lostAt from a known value to null (known -> 시간 미상) without triggering a re-embed", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await updateLostPost(1, 1, { lostAt: null });
    await flushAfterCallbacks();

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.data.lostAt).toBeNull();
    expect(lostPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lostAt: null }) }),
    );
    // lostAt is not an EMBEDDING_INPUT_FIELDS member -- an lostAt-only edit
    // shouldn't burn an inference call.
    expect(embedPostBestEffort).not.toHaveBeenCalled();
  });

  // Phase 23: a changed embedding can change what this post's cached
  // match candidates should be (see match/candidates.ts's own comment) --
  // the stale cache row must be cleared, not left to serve outdated
  // candidates forever.
  it("invalidates this post's cached match candidates when it re-embeds", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "새 제목",
      description: "d",
      category: "c",
      location: "l",
      status: "SEARCHING",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    await updateLostPost(1, 1, { title: "새 제목" });
    await flushAfterCallbacks();

    expect(matchCandidateCache.deleteMany).toHaveBeenCalledWith({
      where: { sourceType: "lost", sourcePostId: 1 },
    });
  });

  it("does not re-embed for a status-only update (no embedding-relevant field changed)", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      status: "FOUND",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    await updateLostPost(1, 1, { status: "찾음" });

    expect(embedPostBestEffort).not.toHaveBeenCalled();
    expect(matchCandidateCache.deleteMany).not.toHaveBeenCalled();
  });

  // No "image-only update -> no re-embed" test here: image changes never
  // go through updateLostPost()/updateFoundPost() at all -- they're a
  // separate code path (src/lib/images/service.ts's setPostImage()/
  // clearPostImage(), which writes imageUrl directly and isn't even part
  // of UpdateLostPostInput/UpdateFoundPostInput's schema, see
  // src/lib/posts/schema.ts). So there's structurally nothing to trigger
  // a re-embed from an image change in the first place.

  // Phase 9: status-change UI (StatusChangeControl) calls the same
  // PATCH /api/posts/[id] -> updateLostPost()/updateFoundPost() path as
  // any other field update -- no new API, so these tests exercise that
  // existing ownership gate specifically for a status-only body.
  it("owner can change their own post's status", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
    lostPost.update.mockResolvedValueOnce({
      id: 1,
      title: "t",
      description: "d",
      category: "c",
      location: "l",
      status: "FOUND",
      imageUrl: null,
      lostAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await updateLostPost(1, 1, { status: "찾음" });

    expect(result.kind).toBe("ok");
    expect(lostPost.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ status: "FOUND" }) }),
    );
  });

  it("non-owner cannot change another user's post status", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });

    const result = await updateLostPost(1, 2, { status: "찾음" });

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(lostPost.update).not.toHaveBeenCalled();
  });

  it("rejects updating someone else's post", async () => {
    lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });

    const result = await updateLostPost(1, 2, { title: "해킹 시도" });

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(lostPost.update).not.toHaveBeenCalled();
  });

  it("reports not_found for a nonexistent post", async () => {
    lostPost.findUnique.mockResolvedValueOnce(null);
    expect(await updateLostPost(999, 1, { title: "x" })).toEqual({ kind: "not_found" });
  });

  it("rejects updating someone else's FoundPost the same way", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 1 });

    const result = await updateFoundPost(2, 2, { title: "해킹 시도" });

    expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
    expect(foundPost.update).not.toHaveBeenCalled();
  });

  // Phase P-5: FoundPost mirrors LostPost's own location/foundAt-null
  // handling exactly (see updateLostPost's own tests above) -- one
  // representative case here confirms the symmetry, not a full duplicate
  // of every LostPost scenario.
  it("updates a FoundPost's location and foundAt to null (위치/시간 미상) and only re-embeds for location", async () => {
    foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 1 });
    foundPost.update.mockResolvedValueOnce({
      id: 2,
      title: "t",
      description: "d",
      category: "c",
      location: null,
      status: "KEEPING",
      imageUrl: null,
      foundAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: 1, nickname: "닉네임" },
    });

    const result = await updateFoundPost(2, 1, { location: null, foundAt: null });
    await flushAfterCallbacks();

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.location).toBeNull();
      expect(result.data.foundAt).toBeNull();
    }
    expect(embedPostBestEffort).toHaveBeenCalledWith("found", 2, expect.objectContaining({ location: null }));
  });

  // Phase 12-7 §4: organizationId is now editable on update -- reverses
  // Phase 12-5's original "fixed at creation" policy. All four
  // transitions (개인→개인/개인→단체/단체 A→단체 B/단체→개인) go through
  // the exact same validateOrganizationPosting() gate createLostPost's own
  // create-time check uses.
  describe("organization attribution changes (Phase 12-7)", () => {
    it("개인 → 단체: validates and persists the new organizationId", async () => {
      validateOrganizationPosting.mockResolvedValueOnce({ kind: "ok" });
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });
      lostPost.update.mockResolvedValueOnce({
        id: 1,
        title: "t",
        description: "d",
        category: "c",
        location: "l",
        status: "SEARCHING",
        imageUrl: null,
        lostAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: 1, nickname: "닉네임" },
        organization: { id: 10, name: "총학생회" },
      });

      const result = await updateLostPost(1, 1, { organizationId: 10 });

      expect(validateOrganizationPosting).toHaveBeenCalledWith(1, 10);
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.data.organizationId).toBe(10);
      expect(lostPost.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: 10 }) }),
      );
    });

    it("단체 A → 단체 B: re-validates membership in the new target organization", async () => {
      validateOrganizationPosting.mockResolvedValueOnce({ kind: "ok" });
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, organizationId: 10 });
      lostPost.update.mockResolvedValueOnce({
        id: 1,
        title: "t",
        description: "d",
        category: "c",
        location: "l",
        status: "SEARCHING",
        imageUrl: null,
        lostAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: 1, nickname: "닉네임" },
        organization: { id: 20, name: "AI 동아리" },
      });

      const result = await updateLostPost(1, 1, { organizationId: 20 });

      expect(validateOrganizationPosting).toHaveBeenCalledWith(1, 20);
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.data.organizationId).toBe(20);
    });

    it("단체 → 개인: explicit null bypasses validateOrganizationPosting entirely", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1, organizationId: 10 });
      lostPost.update.mockResolvedValueOnce({
        id: 1,
        title: "t",
        description: "d",
        category: "c",
        location: "l",
        status: "SEARCHING",
        imageUrl: null,
        lostAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: 1, nickname: "닉네임" },
        organization: null,
      });

      const result = await updateLostPost(1, 1, { organizationId: null });

      expect(validateOrganizationPosting).not.toHaveBeenCalled();
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.data.organizationId).toBeNull();
      expect(lostPost.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: null }) }),
      );
    });

    it("권한 없는 단체로 변경 시도 -- forbidden, DB에 쓰지 않는다", async () => {
      validateOrganizationPosting.mockResolvedValueOnce({ kind: "forbidden" });
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });

      const result = await updateLostPost(1, 1, { organizationId: 999 });

      expect(result).toEqual({ kind: "forbidden", reason: "organization_not_member" });
      expect(lostPost.update).not.toHaveBeenCalled();
    });

    it("INACTIVE 단체로 변경 시도 -- forbidden, DB에 쓰지 않는다", async () => {
      validateOrganizationPosting.mockResolvedValueOnce({ kind: "inactive_organization" });
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });

      const result = await updateLostPost(1, 1, { organizationId: 10 });

      expect(result).toEqual({ kind: "forbidden", reason: "organization_inactive" });
      expect(lostPost.update).not.toHaveBeenCalled();
    });

    it("존재하지 않는 단체로 변경 시도 -- not_found", async () => {
      validateOrganizationPosting.mockResolvedValueOnce({ kind: "not_found" });
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 1 });

      const result = await updateLostPost(1, 1, { organizationId: 999999 });

      expect(result).toEqual({ kind: "forbidden", reason: "organization_not_found" });
      expect(lostPost.update).not.toHaveBeenCalled();
    });

    it("소유자가 아니면 organizationId 검증 전에 이미 forbidden", async () => {
      lostPost.findUnique.mockResolvedValueOnce({ id: 1, userId: 2 });

      const result = await updateLostPost(1, 1, { organizationId: 10 });

      expect(result).toEqual({ kind: "forbidden", reason: "not_owner" });
      expect(validateOrganizationPosting).not.toHaveBeenCalled();
    });

    it("updateFoundPost도 동일한 검증 게이트를 거친다", async () => {
      validateOrganizationPosting.mockResolvedValueOnce({ kind: "forbidden" });
      foundPost.findUnique.mockResolvedValueOnce({ id: 2, userId: 1 });

      const result = await updateFoundPost(2, 1, { organizationId: 10 });

      expect(result).toEqual({ kind: "forbidden", reason: "organization_not_member" });
      expect(foundPost.update).not.toHaveBeenCalled();
    });
  });
});

// Phase 12: semantic search dispatch through searchPosts() -- the plain
// (non-semantic) dispatch itself is tested against ./service directly in
// search.service.test.ts; these tests exercise this module's own
// mode="semantic" branch and its delegation to ./service for everything
// else.
describe("searchPosts -- mode=semantic (Phase 12)", () => {
  it("defaults to keyword search when mode is omitted (no regression)", async () => {
    await searchPosts({ type: "lost", page: 1, limit: 20 });

    expect(embed).not.toHaveBeenCalled();
    expect(findPostsBySemanticQuery).not.toHaveBeenCalled();
    expect(lostPost.findMany).toHaveBeenCalled();
  });

  it("computes a query embedding and calls findPostsBySemanticQuery, never the keyword path", async () => {
    embed.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    findPostsBySemanticQuery.mockResolvedValueOnce([]);

    await searchPosts({ type: "lost", mode: "semantic", q: "검은색 에어팟", page: 1, limit: 20 });

    expect(embed).toHaveBeenCalledWith("검은색 에어팟");
    expect(findPostsBySemanticQuery).toHaveBeenCalledWith("lost", [0.1, 0.2, 0.3], 10, expect.any(Object));
    expect(lostPost.findMany).not.toHaveBeenCalled();
  });

  it("returns matched posts in similarity-ranked order with their score attached", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 2, score: 0.9 },
      { id: 1, score: 0.4 },
    ]);
    // findMany({id:{in:[2,1]}}) -- deliberately returned out of that order,
    // to prove the service re-sorts by the similarity ranking rather than
    // trusting the DB's own row order.
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "지갑 분실" }),
      row({ id: 2, title: "에어팟 분실" }),
    ]);

    // Query text deliberately shares no token with either title -- this
    // test is about row-order independence, not the Phase 13-2 lexical
    // tie-breaker (see the "hard-negative tie-breaker" describe block
    // below for that), so it must not incidentally trigger the bonus.
    const result = await searchPosts({ type: "lost", mode: "semantic", q: "분실물찾아요", page: 1, limit: 20 });

    expect(result.items.map((p) => p.id)).toEqual([2, 1]);
    expect(result.items[0].score).toBeCloseTo(0.9);
    expect(result.items[1].score).toBeCloseTo(0.4);
    expect(result.total).toBe(2);
  });

  it("passes category/campus/status/dateFrom/dateTo through to findPostsBySemanticQuery", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([]);
    const dateFrom = new Date("2026-01-01");
    const dateTo = new Date("2026-01-31");

    await searchPosts({
      type: "found",
      mode: "semantic",
      q: "지갑",
      page: 1,
      limit: 20,
      category: "지갑",
      campus: "인문캠퍼스",
      status: "보관 중",
      dateFrom,
      dateTo,
    });

    expect(findPostsBySemanticQuery).toHaveBeenCalledWith(
      "found",
      [0.1],
      10,
      expect.objectContaining({ category: "지갑", campus: "인문캠퍼스", status: "보관 중", dateFrom, dateTo }),
    );
  });

  it("returns an empty page (not an error) when nothing matches", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([]);

    const result = await searchPosts({ type: "lost", mode: "semantic", q: "존재하지않는물건", page: 1, limit: 20 });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    expect(lostPost.findMany).not.toHaveBeenCalled(); // no point fetching rows for zero ids
  });

  it("propagates an embedding provider failure instead of silently returning an empty result", async () => {
    embed.mockRejectedValueOnce(new Error("model unavailable"));

    await expect(
      searchPosts({ type: "lost", mode: "semantic", q: "에어팟", page: 1, limit: 20 }),
    ).rejects.toThrow("model unavailable");
  });

  it("drops a result whose post was deleted between the vector search and the row fetch, without erroring", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 1, score: 0.9 },
      { id: 2, score: 0.5 }, // this one will "not be found" below
    ]);
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1 })]); // id 2 missing

    const result = await searchPosts({ type: "lost", mode: "semantic", q: "에어팟", page: 1, limit: 20 });

    expect(result.items.map((p) => p.id)).toEqual([1]);
    expect(result.total).toBe(1);
  });
});

function foundRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: "지갑을 찾았어요",
    description: "검은색 가죽 지갑",
    category: "지갑",
    location: "학생회관",
    status: "KEEPING",
    imageUrl: null,
    foundAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    user: { id: 2, nickname: "닉네임2" },
    ...overrides,
  };
}

// Phase 11-2: type=all's semantic path -- ranks LostPost and FoundPost
// independently (same query vector) and merges by score, since both
// boards' cosine-similarity scores already live on the same 0-1 scale
// (same model, same normalizeScore -- see aiService.ts's own comment on
// why this merge is exact, not an approximation).
describe("searchPosts -- mode=semantic, type=all (Phase 11-2)", () => {
  it("queries both boards with the same embedding and merges by score", async () => {
    embed.mockResolvedValueOnce([0.1, 0.2]);
    findPostsBySemanticQuery.mockImplementation(async (type: string) =>
      type === "lost" ? [{ id: 1, score: 0.4 }] : [{ id: 1, score: 0.9 }],
    );
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1, title: "지갑 분실" })]);
    foundPost.findMany.mockResolvedValueOnce([foundRow({ id: 1, title: "지갑 습득" })]);

    const result = await searchPosts({ type: "all", mode: "semantic", q: "분실물찾아요", page: 1, limit: 20 });

    expect(findPostsBySemanticQuery).toHaveBeenCalledWith("lost", [0.1, 0.2], 10, expect.any(Object));
    expect(findPostsBySemanticQuery).toHaveBeenCalledWith("found", [0.1, 0.2], 10, expect.any(Object));
    // Higher-scoring found post ranks first even though it was queried
    // second -- proves this is a real score merge, not concatenation.
    expect(result.items.map((p) => `${p.type}-${p.id}`)).toEqual(["found-1", "lost-1"]);
    expect(result.total).toBe(2);
  });

  it("returns just the found results when lost has none, not an error", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockImplementation(async (type: string) =>
      type === "lost" ? [] : [{ id: 5, score: 0.7 }],
    );
    foundPost.findMany.mockResolvedValueOnce([foundRow({ id: 5 })]);

    const result = await searchPosts({ type: "all", mode: "semantic", q: "지갑", page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("found");
    expect(lostPost.findMany).not.toHaveBeenCalled();
  });

  it("returns an empty page when neither board has a match", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValue([]);

    const result = await searchPosts({ type: "all", mode: "semantic", q: "존재하지않는물건", page: 1, limit: 20 });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  // One board's own vector-search query can fail independently (e.g. a
  // transient DB error) without sinking a result the other board could
  // still legitimately return.
  it("still returns the other board's results when one board's query rejects", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockImplementation(async (type: string) => {
      if (type === "lost") throw new Error("db blip");
      return [{ id: 9, score: 0.6 }];
    });
    foundPost.findMany.mockResolvedValueOnce([foundRow({ id: 9 })]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await searchPosts({ type: "all", mode: "semantic", q: "지갑", page: 1, limit: 20 });

    expect(result.items.map((p) => p.type)).toEqual(["found"]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rethrows when both boards' queries reject", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockRejectedValue(new Error("db down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      searchPosts({ type: "all", mode: "semantic", q: "지갑", page: 1, limit: 20 }),
    ).rejects.toThrow("db down");

    consoleError.mockRestore();
  });

  it("propagates an embedding provider failure before either board is even queried", async () => {
    embed.mockRejectedValueOnce(new Error("model unavailable"));

    await expect(
      searchPosts({ type: "all", mode: "semantic", q: "지갑", page: 1, limit: 20 }),
    ).rejects.toThrow("model unavailable");
    expect(findPostsBySemanticQuery).not.toHaveBeenCalled();
  });
});

// Phase 13-2: a real, reproduced hard-negative failure from Phase 13-1's
// real-DB evaluation (real ONNX model + real Supabase pgvector, not
// hypothetical) -- "카드지갑 분실" (a wallet post whose *description*
// happens to mention "학생증") outscored the actual "학생증 분실1" post for
// the query "학생증 잃어버렸어요", 0.912 vs 0.893. These tests use the same
// scores/titles, but via a mocked findPostsBySemanticQuery/findMany (no
// real model load), matching this file's existing convention.
describe("searchPosts -- semantic hard-negative tie-breaker (Phase 13-2)", () => {
  it("promotes a title-matching near-tie candidate above a higher-raw-score decoy that only matches in its description", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 2, score: 0.912 }, // "카드지갑 분실" -- raw semantic winner
      { id: 1, score: 0.893 }, // "학생증 분실1" -- the actual correct answer
    ]);
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "학생증 분실1", description: "학생증을 정문에서 잃어버렸어요" }),
      row({ id: 2, title: "카드지갑 분실", description: "카드지갑을 잃어버렸습니다. 학생증이 들어있어요" }),
    ]);

    const result = await searchPosts({
      type: "lost",
      mode: "semantic",
      q: "학생증 잃어버렸어요",
      page: 1,
      limit: 20,
    });

    // Title "학생증 분실1" contains the query token "학생증"; title "카드지갑
    // 분실" does not (only its description does) -- so only id=1 gets the
    // bonus, closing the 0.019 gap and taking rank 1.
    expect(result.items.map((p) => p.id)).toEqual([1, 2]);
    expect(result.items[0].score).toBeCloseTo(0.893 + 0.03);
    expect(result.items[1].score).toBeCloseTo(0.912); // decoy's score is untouched
  });

  it("does not override a real semantic gap just because a lower-ranked title happens to match", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 1, score: 0.95 }, // clearly the best semantic match, title doesn't match query tokens
      { id: 2, score: 0.6 }, // far behind, but its title literally contains a query token
    ]);
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "무선 이어폰 분실", description: "회색 무선 이어폰을 잃어버렸습니다" }),
      row({ id: 2, title: "학생증 지갑", description: "지갑을 주웠는데 안에 아무것도 없어요" }),
    ]);

    const result = await searchPosts({
      type: "lost",
      mode: "semantic",
      q: "학생증 잃어버렸어요",
      page: 1,
      limit: 20,
    });

    // 0.6 + 0.03 bonus (0.63) is still nowhere close to 0.95 -- the bonus
    // is a tie-breaker, not a general keyword override.
    expect(result.items.map((p) => p.id)).toEqual([1, 2]);
  });

  it("leaves ranking unchanged when neither title matches a query token", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 2, score: 0.7 },
      { id: 1, score: 0.6 },
    ]);
    lostPost.findMany.mockResolvedValueOnce([
      row({ id: 1, title: "지갑 분실", description: "갈색 지갑을 잃어버렸어요" }),
      row({ id: 2, title: "가방 분실", description: "백팩을 잃어버렸어요" }),
    ]);

    const result = await searchPosts({ type: "lost", mode: "semantic", q: "학생증", page: 1, limit: 20 });

    expect(result.items.map((p) => p.id)).toEqual([2, 1]);
    expect(result.items[0].score).toBeCloseTo(0.7);
    expect(result.items[1].score).toBeCloseTo(0.6);
  });
});

// Phase 32: image search's own coverage -- mirrors searchPosts's semantic-
// mode describe block above (embed -> rank -> re-order/score -> paginate),
// `imageEmbed`/`findPostsByImageQuery` in place of `embed`/
// findPostsBySemanticQuery, and no lexical tie-breaker (that's text-only).
describe("searchPostsByImage", () => {
  it("embeds the uploaded image and ranks targetType's own board", async () => {
    const fakeImage = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    imageEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    findPostsByImageQuery.mockResolvedValueOnce([{ id: 7, score: 0.8 }]);
    foundPost.findMany.mockResolvedValueOnce([row({ id: 7, foundAt: new Date("2026-01-01") })]);

    const result = await searchPostsByImage("found", fakeImage, { page: 1, limit: 20 });

    expect(imageEmbed).toHaveBeenCalledWith(fakeImage);
    expect(findPostsByImageQuery).toHaveBeenCalledWith("found", [0.1, 0.2, 0.3], 10, {});
    expect(foundPost.findMany).toHaveBeenCalled();
    expect(lostPost.findMany).not.toHaveBeenCalled();
    expect(result.items.map((p) => p.id)).toEqual([7]);
    expect(result.items[0].score).toBeCloseTo(0.8);
  });

  it("searches LostPost when targetType is lost", async () => {
    const fakeImage = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    imageEmbed.mockResolvedValueOnce([0.1]);
    findPostsByImageQuery.mockResolvedValueOnce([{ id: 1, score: 0.5 }]);
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1 })]);

    const result = await searchPostsByImage("lost", fakeImage, { page: 1, limit: 20 });

    expect(lostPost.findMany).toHaveBeenCalled();
    expect(foundPost.findMany).not.toHaveBeenCalled();
    expect(result.items.map((p) => p.type)).toEqual(["lost"]);
  });

  it("returns an empty page (not an error) when nothing matches", async () => {
    const fakeImage = new Blob([], { type: "image/jpeg" });
    imageEmbed.mockResolvedValueOnce([0.1]);
    findPostsByImageQuery.mockResolvedValueOnce([]);

    const result = await searchPostsByImage("lost", fakeImage, { page: 1, limit: 20 });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    expect(lostPost.findMany).not.toHaveBeenCalled();
  });

  it("re-orders results to match the similarity ranking and attaches score", async () => {
    const fakeImage = new Blob([], { type: "image/jpeg" });
    imageEmbed.mockResolvedValueOnce([0.1]);
    findPostsByImageQuery.mockResolvedValueOnce([
      { id: 2, score: 0.9 },
      { id: 1, score: 0.4 },
    ]);
    // Deliberately out of ranked order, to prove re-sorting happens.
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1 }), row({ id: 2 })]);

    const result = await searchPostsByImage("lost", fakeImage, { page: 1, limit: 20 });

    expect(result.items.map((p) => p.id)).toEqual([2, 1]);
    expect(result.items[0].score).toBeCloseTo(0.9);
    expect(result.items[1].score).toBeCloseTo(0.4);
  });

  it("paginates the ranked results using page/limit", async () => {
    const fakeImage = new Blob([], { type: "image/jpeg" });
    imageEmbed.mockResolvedValueOnce([0.1]);
    findPostsByImageQuery.mockResolvedValueOnce([
      { id: 1, score: 0.9 },
      { id: 2, score: 0.8 },
      { id: 3, score: 0.7 },
    ]);
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]);

    const result = await searchPostsByImage("lost", fakeImage, { page: 2, limit: 1 });

    expect(result.items.map((p) => p.id)).toEqual([2]);
    expect(result.total).toBe(3);
    expect(result.totalPages).toBe(3);
  });

  it("passes category/campus/status filters through to findPostsByImageQuery", async () => {
    const fakeImage = new Blob([], { type: "image/jpeg" });
    imageEmbed.mockResolvedValueOnce([0.1]);
    findPostsByImageQuery.mockResolvedValueOnce([]);

    await searchPostsByImage("found", fakeImage, {
      page: 1,
      limit: 20,
      category: "지갑",
      campus: "인문캠퍼스",
      status: "보관 중",
    });

    expect(findPostsByImageQuery).toHaveBeenCalledWith(
      "found",
      [0.1],
      10,
      expect.objectContaining({ category: "지갑", campus: "인문캠퍼스", status: "보관 중" }),
    );
  });
});

// AI 검색 고도화 Phase: searchPostsAI() is the one entry point behind
// POST /api/posts?mode=ai -- these tests exercise its three input
// combinations (text only, image only, text+image) and its two validation
// invariants (at least one input required; an image forces a concrete
// board), all delegating to the exact same collaborators already exercised
// above (searchPosts's semantic branch, searchPostsByImage, and
// findPostsBySemanticQuery/findPostsByImageQuery for the combined path).
describe("searchPostsAI", () => {
  it("text only: delegates to the same semantic search path as searchPosts(mode=semantic)", async () => {
    embed.mockResolvedValueOnce([0.1, 0.2]);
    findPostsBySemanticQuery.mockResolvedValueOnce([{ id: 1, score: 0.6 }]);
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1 })]);

    const result = await searchPostsAI("lost", "검은색 에어팟", undefined, { page: 1, limit: 20 });

    expect(embed).toHaveBeenCalledWith("검은색 에어팟");
    expect(imageEmbed).not.toHaveBeenCalled();
    expect(findPostsByImageQuery).not.toHaveBeenCalled();
    expect(result.items.map((p) => p.id)).toEqual([1]);
  });

  it("text only + type=all: reaches both boards, same as searchPosts(mode=semantic, type=all)", async () => {
    embed.mockResolvedValueOnce([0.1]);
    findPostsBySemanticQuery.mockResolvedValueOnce([{ id: 5, score: 0.7 }]);
    lostPost.findMany.mockResolvedValueOnce([row({ id: 5 })]);
    foundPost.findMany.mockResolvedValueOnce([]);

    const result = await searchPostsAI("all", "지갑", undefined, { page: 1, limit: 20 });

    expect(lostPost.findMany).toHaveBeenCalled();
    expect(result.items.map((p) => p.id)).toEqual([5]);
  });

  it("image only: delegates to searchPostsByImage() unchanged", async () => {
    const fakeImage = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    imageEmbed.mockResolvedValueOnce([0.3]);
    findPostsByImageQuery.mockResolvedValueOnce([{ id: 9, score: 0.9 }]);
    lostPost.findMany.mockResolvedValueOnce([row({ id: 9 })]);

    const result = await searchPostsAI("lost", undefined, fakeImage, { page: 1, limit: 20 });

    expect(embed).not.toHaveBeenCalled();
    expect(findPostsBySemanticQuery).not.toHaveBeenCalled();
    expect(result.items.map((p) => p.id)).toEqual([9]);
  });

  it("text + image: runs both vector searches and combines them via the shared rankFusion logic", async () => {
    embed.mockResolvedValueOnce([0.1]);
    imageEmbed.mockResolvedValueOnce([0.2]);
    // Candidate 3 is present in both the text and image ranking (and is
    // the best raw score in each), while 1 only has a text score and 2
    // only has an image score -- min-max normalizing each signal over its
    // own {low, high} pair maps 3 to 1 on both signals (averaging to 1),
    // while 1 and 2 each normalize to 0 with no second signal to average
    // against -- so 3 should rank first, 1 and 2 tied behind it.
    findPostsBySemanticQuery.mockResolvedValueOnce([
      { id: 1, score: 0.5 },
      { id: 3, score: 0.9 },
    ]);
    findPostsByImageQuery.mockResolvedValueOnce([
      { id: 2, score: 0.4 },
      { id: 3, score: 0.9 },
    ]);
    lostPost.findMany.mockResolvedValueOnce([row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]);

    const result = await searchPostsAI("lost", "검은색 에어팟", new Blob([], { type: "image/jpeg" }), {
      page: 1,
      limit: 20,
    });

    expect(embed).toHaveBeenCalledWith("검은색 에어팟");
    expect(imageEmbed).toHaveBeenCalled();
    expect(result.items.map((p) => p.id)).toEqual([3, 1, 2]);
    expect(result.items[0].score).toBeCloseTo(1);
  });

  it("rejects when neither text nor image is given", async () => {
    await expect(searchPostsAI("lost", undefined, undefined, { page: 1, limit: 20 })).rejects.toThrow();
    expect(embed).not.toHaveBeenCalled();
    expect(imageEmbed).not.toHaveBeenCalled();
  });

  it("rejects an image-only search against type=all -- imageEmbedding has no cross-board query", async () => {
    const fakeImage = new Blob([], { type: "image/jpeg" });
    await expect(searchPostsAI("all", undefined, fakeImage, { page: 1, limit: 20 })).rejects.toThrow();
    expect(imageEmbed).not.toHaveBeenCalled();
  });

  it("rejects a text+image search against type=all for the same reason", async () => {
    const fakeImage = new Blob([], { type: "image/jpeg" });
    await expect(searchPostsAI("all", "지갑", fakeImage, { page: 1, limit: 20 })).rejects.toThrow();
    expect(embed).not.toHaveBeenCalled();
    expect(imageEmbed).not.toHaveBeenCalled();
  });
});
