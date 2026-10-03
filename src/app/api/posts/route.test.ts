import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { jsonError } from "@/lib/posts/response";

const requireUserForApi = vi.fn();
const searchPosts = vi.fn();
const searchPostsAI = vi.fn();
const createLostPost = vi.fn();
const createFoundPost = vi.fn();

// Mocked wholesale (not via importActual) so this never loads the real
// @/lib/posts/http.ts, which imports next-auth through getCurrentUser() --
// next-auth's package doesn't resolve under Vitest's plain Node ESM
// outside of Next's own bundler. The response helpers re-exported here
// are the real ones (from the auth-free @/lib/posts/response.ts), only
// requireUserForApi is faked.
vi.mock("@/lib/posts/http", async () => {
  const response = await import("@/lib/posts/response");
  return { ...response, requireUserForApi };
});
vi.mock("@/lib/posts/aiService", () => ({
  searchPosts,
  searchPostsAI,
  createLostPost,
  createFoundPost,
}));
// AI search is rate-limited per user (or hashed IP for anonymous
// visitors); post creation per user. The limiter itself is tested in
// src/lib/rateLimit -- here only which bucket each request is charged to,
// and that a 429 stops the request before any search/create work.
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
const enforceRateLimit = vi.fn();
vi.mock("@/lib/rateLimit", () => ({
  enforceRateLimit,
  clientIpFrom: (headers: Headers) => headers.get("x-forwarded-for"),
}));

const { GET, POST } = await import("./route");

const sessionUser = { id: 1, nickname: "닉네임" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(null);
  enforceRateLimit.mockResolvedValue(null);
});

describe("GET /api/posts", () => {
  it("rejects an unrecognized type", async () => {
    const res = await GET(new NextRequest("http://localhost/api/posts?type=banana"));
    expect(res.status).toBe(400);
  });

  it("accepts type=all", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    const res = await GET(new NextRequest("http://localhost/api/posts?type=all"));
    expect(res.status).toBe(200);
  });

  it("clamps an excessive limit before querying the DB", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 50, total: 0, totalPages: 1 });

    await GET(new NextRequest("http://localhost/api/posts?type=lost&limit=100000"));

    expect(searchPosts).toHaveBeenCalledWith(expect.objectContaining({ type: "lost", page: 1, limit: 50 }));
  });

  it("rejects a search query longer than the max length", async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/posts?type=lost&q=${"a".repeat(101)}`),
    );
    expect(res.status).toBe(400);
    expect(searchPosts).not.toHaveBeenCalled();
  });

  it("rejects an invalid sort value", async () => {
    const res = await GET(new NextRequest("http://localhost/api/posts?type=lost&sort=random"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid period date and an inverted range", async () => {
    const bad = await GET(new NextRequest("http://localhost/api/posts?type=lost&period=custom&from=not-a-date"));
    expect(bad.status).toBe(400);
    const inverted = await GET(
      new NextRequest("http://localhost/api/posts?type=lost&period=custom&from=2026-09-15&to=2026-09-01"),
    );
    expect(inverted.status).toBe(400);
  });

  it("passes the resolved 분실/습득 시점 period to the service layer", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    await GET(
      new NextRequest("http://localhost/api/posts?type=found&period=custom&from=2026-09-01&to=2026-09-15&unknownTime=include"),
    );

    expect(searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "found",
        eventFrom: new Date("2026-08-31T15:00:00.000Z"),
        eventTo: new Date("2026-09-15T14:59:59.999Z"),
        includeUnknownEventTime: true,
      }),
    );
  });

  describe("POST ?mode=ai -- period filter", () => {
    const aiRequest = (query: string) => {
      const form = new FormData();
      form.append("q", "지갑");
      return new NextRequest(`http://localhost/api/posts?mode=ai&${query}`, { method: "POST", body: form });
    };

    it("forwards the same period parameters to AI 검색", async () => {
      searchPostsAI.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

      const res = await POST(aiRequest("type=lost&period=custom&from=2026-09-01&to=2026-09-15"));

      expect(res.status).toBe(200);
      expect(searchPostsAI).toHaveBeenCalledWith(
        "lost",
        "지갑",
        undefined,
        expect.objectContaining({
          eventFrom: new Date("2026-08-31T15:00:00.000Z"),
          eventTo: new Date("2026-09-15T14:59:59.999Z"),
          includeUnknownEventTime: false,
        }),
      );
    });

    it("rejects an inverted range with 400 before searching", async () => {
      const res = await POST(aiRequest("type=lost&period=custom&from=2026-09-15&to=2026-09-01"));

      expect(res.status).toBe(400);
      expect(searchPostsAI).not.toHaveBeenCalled();
    });

    it("searches without a time filter when no period is given", async () => {
      searchPostsAI.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

      await POST(aiRequest("type=found"));

      expect(searchPostsAI).toHaveBeenCalledWith(
        "found",
        "지갑",
        undefined,
        expect.objectContaining({ eventFrom: undefined, eventTo: undefined }),
      );
    });
  });

  it("passes q/category/campus/sort through to the service layer", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    await GET(
      new NextRequest(
        "http://localhost/api/posts?type=lost&q=지갑&category=전자기기&campus=인문캠퍼스&sort=oldest",
      ),
    );

    expect(searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "lost",
        q: "지갑",
        category: "전자기기",
        campus: "인문캠퍼스",
        sort: "oldest",
      }),
    );
  });

  it("requires no authentication -- search/list is public", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    const res = await GET(new NextRequest("http://localhost/api/posts?type=all&q=지갑"));

    expect(res.status).toBe(200);
    expect(requireUserForApi).not.toHaveBeenCalled();
  });

  it("includes totalPages in the pagination envelope", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 41, totalPages: 3 });

    const res = await GET(new NextRequest("http://localhost/api/posts?type=lost"));
    const json = await res.json();

    expect(json.pagination).toEqual({ page: 1, limit: 20, total: 41, totalPages: 3 });
  });
});

// Phase 12: AI semantic search mode.
describe("GET /api/posts -- mode=semantic (Phase 12)", () => {
  it("defaults to mode=keyword when omitted (no regression)", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    await GET(new NextRequest("http://localhost/api/posts?type=lost"));

    expect(searchPosts).toHaveBeenCalledWith(expect.objectContaining({ mode: "keyword" }));
  });

  it("rejects an unrecognized mode value", async () => {
    const res = await GET(new NextRequest("http://localhost/api/posts?type=lost&mode=fuzzy"));
    expect(res.status).toBe(400);
    expect(searchPosts).not.toHaveBeenCalled();
  });

  it("dispatches mode=semantic with q through to the service layer", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    await GET(
      new NextRequest(
        `http://localhost/api/posts?type=lost&mode=semantic&q=${encodeURIComponent("검은색 에어팟을 도서관에서 잃어버렸어요")}`,
      ),
    );

    expect(searchPosts).toHaveBeenCalledWith(
      expect.objectContaining({ type: "lost", mode: "semantic", q: "검은색 에어팟을 도서관에서 잃어버렸어요" }),
    );
  });

  // Phase 11-2: previously rejected -- see listQuerySchema's own
  // superRefine comment for why type=all is now valid for mode=semantic
  // too (both boards' scores are already on a comparable scale).
  it("dispatches mode=semantic with type=all through to the service layer", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    const res = await GET(new NextRequest("http://localhost/api/posts?type=all&mode=semantic&q=지갑"));

    expect(res.status).toBe(200);
    expect(searchPosts).toHaveBeenCalledWith(expect.objectContaining({ type: "all", mode: "semantic", q: "지갑" }));
  });

  it("rejects mode=semantic with no q", async () => {
    const res = await GET(new NextRequest("http://localhost/api/posts?type=lost&mode=semantic"));
    expect(res.status).toBe(400);
    expect(searchPosts).not.toHaveBeenCalled();
  });

  it("requires no authentication for semantic search either -- same public policy as keyword search", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    const res = await GET(
      new NextRequest("http://localhost/api/posts?type=lost&mode=semantic&q=지갑"),
    );

    expect(res.status).toBe(200);
    expect(requireUserForApi).not.toHaveBeenCalled();
  });

  it("returns similarity scores in the response when the service provides them", async () => {
    searchPosts.mockResolvedValueOnce({
      items: [{ id: 1, type: "lost", title: "에어팟 분실", score: 0.87 }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });

    const res = await GET(
      new NextRequest("http://localhost/api/posts?type=lost&mode=semantic&q=에어팟"),
    );
    const json = await res.json();

    expect(json.data[0].score).toBeCloseTo(0.87);
  });
});

describe("POST /api/posts", () => {
  it("rejects an unauthenticated request", async () => {
    requireUserForApi.mockResolvedValueOnce({ response: jsonError(401, "로그인이 필요합니다.") });

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ type: "lost" }),
      }),
    );

    expect(res.status).toBe(401);
    expect(createLostPost).not.toHaveBeenCalled();
  });

  it("rejects a request missing required fields", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({ type: "lost", title: "제목만 있음" }),
      }),
    );

    expect(res.status).toBe(400);
    expect(createLostPost).not.toHaveBeenCalled();
  });

  it("creates a LostPost as the current session user, not any userId in the body", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createLostPost.mockResolvedValueOnce({
      kind: "ok",
      data: { id: 10, type: "lost", author: { id: 1, nickname: "닉네임" } },
    });

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({
          type: "lost",
          title: "지갑을 잃어버렸어요",
          description: "검은색 지갑",
          category: "지갑",
          location: "학생회관",
          campus: "인문캠퍼스",
          lostAt: "2026-01-01T10:00",
          userId: 999, // must be ignored -- author comes from the session
        }),
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.author.id).toBe(1);
    expect(createLostPost).toHaveBeenCalledWith(sessionUser, expect.any(Object));
  });

  it("creates a FoundPost when type is 'found'", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    createFoundPost.mockResolvedValueOnce({
      kind: "ok",
      data: { id: 11, type: "found" },
    });

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({
          type: "found",
          title: "지갑을 주웠어요",
          description: "검은색 지갑",
          category: "지갑",
          location: "학생회관",
          campus: "인문캠퍼스",
          foundAt: "2026-01-01T10:00",
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(createFoundPost).toHaveBeenCalled();
  });
});

describe("rate limits", () => {
  const tooMany = async () => {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "요청이 너무 많습니다." }, { status: 429 });
  };

  it("charges anonymous AI search to the caller's IP and stops with 429 before searching", async () => {
    enforceRateLimit.mockResolvedValueOnce(await tooMany());
    const form = new FormData();
    form.set("q", "지갑");

    const res = await POST(
      new NextRequest("http://localhost/api/posts?mode=ai&type=lost", {
        method: "POST",
        body: form,
        headers: { "x-forwarded-for": "198.51.100.7" },
      }),
    );

    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith("aiSearch", { ip: "198.51.100.7" });
    expect(searchPostsAI).not.toHaveBeenCalled();
  });

  it("charges a signed-in user's semantic search to their user id", async () => {
    getCurrentUser.mockResolvedValueOnce({ id: 42 });
    enforceRateLimit.mockResolvedValueOnce(await tooMany());

    const res = await GET(new NextRequest("http://localhost/api/posts?type=lost&mode=semantic&q=지갑"));

    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith("aiSearch", { userId: 42 });
    expect(searchPosts).not.toHaveBeenCalled();
  });

  it("does not rate-limit plain keyword search", async () => {
    searchPosts.mockResolvedValueOnce({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });

    await GET(new NextRequest("http://localhost/api/posts?type=lost&q=지갑"));

    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("stops post creation with 429 once over the limit", async () => {
    requireUserForApi.mockResolvedValueOnce({ user: sessionUser });
    enforceRateLimit.mockResolvedValueOnce(await tooMany());

    const res = await POST(
      new NextRequest("http://localhost/api/posts", {
        method: "POST",
        body: JSON.stringify({
          type: "lost",
          title: "지갑을 잃어버렸어요",
          description: "검은색 지갑",
          category: "지갑",
          location: "학생회관",
          campus: "인문캠퍼스",
          lostAt: "2026-01-01T10:00",
        }),
      }),
    );

    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith("postCreate", { userId: 1 });
    expect(createLostPost).not.toHaveBeenCalled();
  });
});
