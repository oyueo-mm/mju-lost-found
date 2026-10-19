import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { FallbackImage } from "./FallbackImage";
import { forgetImageFailures, initialStage, stageAfterError } from "@/lib/images/fallback";

const SRC = "https://project.supabase.co/storage/v1/object/public/post-images/posts/lost/1/a.webp";
const html = () =>
  renderToStaticMarkup(<FallbackImage src={SRC} alt="지갑" fill sizes="64px" fallback={<span data-testid="placeholder">no photo</span>} />);

beforeEach(() => forgetImageFailures());

describe("사진 대체 표시", () => {
  it("goes forward only: optimized -> original -> placeholder, never back", () => {
    expect(initialStage(SRC)).toBe("optimized");
    expect(stageAfterError(SRC, "optimized")).toBe("original");
    expect(stageAfterError(SRC, "original")).toBe("failed");
    expect(stageAfterError(SRC, "failed")).toBe("failed");
  });

  it("remembers failures for the page, so other copies do not repeat a failing request", () => {
    stageAfterError(SRC, "optimized");
    expect(initialStage(SRC)).toBe("original");
    stageAfterError(SRC, "original");
    expect(initialStage(SRC)).toBe("failed");
    expect(initialStage("https://project.supabase.co/other.webp")).toBe("optimized");
  });

  it("a local or relative image has no original to try", () => {
    expect(stageAfterError("/icon.png", "optimized")).toBe("failed");
    expect(initialStage(null)).toBe("optimized");
  });

  it("normally renders the optimized image, unchanged", () => {
    const out = html();
    expect(out).toContain("/_next/image?url=");
    expect(out).toContain('alt="지갑"');
    expect(out).not.toContain("placeholder");
  });

  it("after an optimization failure renders the original file, then the placeholder", () => {
    stageAfterError(SRC, "optimized");
    const original = html();
    expect(original).not.toContain("/_next/image");
    expect(original).toContain(`src="${SRC}"`);
    stageAfterError(SRC, "original");
    expect(html()).toBe('<span data-testid="placeholder">no photo</span>');
  });
});
