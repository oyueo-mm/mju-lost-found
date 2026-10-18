import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { searchPosts } = vi.hoisted(() => ({ searchPosts: vi.fn() }));
vi.mock("@/lib/posts/service", () => ({ searchPosts }));
vi.mock("@/lib/metrics/record", () => ({ recordDaily: vi.fn() }));
vi.mock("@/lib/i18n/server", () => ({ getTranslator: async () => (key: string) => key }));
vi.mock("./SearchFilterBar", () => ({ SearchFilterBar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./BoardHeader", () => ({ BoardHeader: () => null }));
vi.mock("./SemanticSearchNotice", () => ({ SemanticSearchNotice: () => null }));
vi.mock("./SemanticSearchResults", () => ({ SemanticSearchResults: ({ params }: { params: Record<string, string> }) => <div data-semantic-type={params.type} data-query={params.q} /> }));

import SearchPage from "@/app/(main)/search/page";
import LostPage from "@/app/(main)/lost/page";
import FoundPage from "@/app/(main)/found/page";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("semantic pages behind Deployment Protection", () => {
  it.each([
    ["search", SearchPage, "found"],
    ["lost", LostPage, "lost"],
    ["found", FoundPage, "found"],
  ] as const)("%s renders browser search without a server HTTP call", async (_name, Page, type) => {
    const fetch = vi.fn().mockRejectedValue(new Error("server self-fetch forbidden"));
    vi.stubGlobal("fetch", fetch);
    const element = await Page({ searchParams: Promise.resolve({ mode: "semantic", q: "검은 지갑" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain(`data-semantic-type="${type}"`);
    expect(html).toContain('data-query="검은 지갑"');
    expect(fetch).not.toHaveBeenCalled();
    expect(searchPosts).not.toHaveBeenCalled();
  });
});
