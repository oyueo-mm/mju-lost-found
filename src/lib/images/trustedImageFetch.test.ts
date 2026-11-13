import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageTooLargeError, UntrustedImageUrlError, fetchTrustedImage, isTrustedImageUrl } from "./trustedImageFetch";

const PROD = "https://tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/post-images/posts/lost/1/0b5c3d1e-1111-4222-8333-944445555666.jpg";
const PREVIEW = "https://swqvlihgupranzfzjevb.supabase.co/storage/v1/object/public/post-images/posts/found/2/0b5c3d1e-1111-4222-8333-944445555666.webp";
const BLOB = "https://abc123xyz.public.blob.vercel-storage.com/lost-1.jpg";

describe("isTrustedImageUrl (SSRF allow-list)", () => {
  it("accepts post-images of the two known Supabase projects and legacy Vercel Blob URLs", () => {
    expect(isTrustedImageUrl(PROD)).toBe(true);
    expect(isTrustedImageUrl(PREVIEW)).toBe(true);
    expect(isTrustedImageUrl(BLOB)).toBe(true);
  });

  it("refuses other Supabase projects, other buckets and non-public endpoints", () => {
    expect(isTrustedImageUrl("https://attackerproject1234567.supabase.co/storage/v1/object/public/post-images/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/chat-images/chat/1/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/sign/post-images/x.jpg?token=t")).toBe(false);
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co/rest/v1/User")).toBe(false);
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/post-images/")).toBe(false);
  });

  it("refuses internal addresses, localhost and cloud metadata in every spelling", () => {
    for (const host of ["127.0.0.1", "localhost", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "0.0.0.0", "10.0.0.1", "2130706433", "0x7f000001", "metadata.google.internal"]) {
      expect(isTrustedImageUrl(`https://${host}/storage/v1/object/public/post-images/x.jpg`)).toBe(false);
    }
  });

  it("refuses look-alike hosts, credentials, ports and scheme tricks", () => {
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co.evil.com/storage/v1/object/public/post-images/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://evil.com\\@tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/post-images/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://user:pw@tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/post-images/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co:8443/storage/v1/object/public/post-images/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("http://tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/post-images/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://abc.public.blob.vercel-storage.com.evil.com/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://evil.com/?u=https://abc.public.blob.vercel-storage.com/x.jpg")).toBe(false);
    for (const raw of ["file:///etc/passwd", "data:image/png;base64,AAAA", "javascript:alert(1)", "ftp://x/y", "", "not a url"]) {
      expect(isTrustedImageUrl(raw)).toBe(false);
    }
  });

  it("refuses path traversal out of the bucket, plain or percent-encoded", () => {
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/post-images/../chat-images/chat/1/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/post-images/%2e%2e/chat-images/x.jpg")).toBe(false);
    expect(isTrustedImageUrl("https://tmifqtyxojtuoejxjrng.supabase.co/storage/v1/object/public/post-images/a%2Fb.jpg")).toBe(false);
  });
});

describe("fetchTrustedImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never sends a request for an untrusted URL", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    await expect(fetchTrustedImage("https://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(UntrustedImageUrlError);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("refuses redirects and sets a time limit", async () => {
    const fetchStub = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    await fetchTrustedImage(PROD);
    expect(fetchStub).toHaveBeenCalledWith(PROD, expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });

  it("propagates the abort when the server is too slow", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    await expect(fetchTrustedImage(PROD, { timeoutMs: 20 })).rejects.toThrow();
  });

  it("refuses a declared length over the limit without reading the body", async () => {
    const body = new ReadableStream({ pull: () => { throw new Error("body must not be read"); } });
    vi.stubGlobal("fetch", async () => new Response(body, { status: 200, headers: { "content-length": String(11 * 1024 * 1024) } }));
    await expect(fetchTrustedImage(PROD)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("stops reading as soon as an undeclared body passes the limit", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 1000) controller.close();
      },
    });
    vi.stubGlobal("fetch", async () => new Response(body, { status: 200 }));
    await expect(fetchTrustedImage(PROD, { maxBytes: 4096 })).rejects.toBeInstanceOf(ImageTooLargeError);
    expect(pulled).toBeLessThan(10);
  });

  it("returns the bytes of a normal response and fails on an error status", async () => {
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    const blob = await fetchTrustedImage(PREVIEW);
    expect(blob.size).toBe(3);
    vi.stubGlobal("fetch", async () => new Response("no", { status: 404 }));
    await expect(fetchTrustedImage(PREVIEW)).rejects.toThrow("404");
  });
});
