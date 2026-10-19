// 사진 대체 표시 (components/ui/FallbackImage): which form of a photo to
// show. A photo starts optimized (Vercel Image Optimization, /_next/image);
// if that fails it is shown once as the original file from Storage, and if
// that fails too, the caller's placeholder. Only forward, never back: no
// retry loop.
//
// The browser's error event carries no status code, so a quota response
// (402), an outage and a deleted photo all look alike -- every failure gets
// the same single step. Failures are remembered for this page's lifetime
// (memory only), so the other copies of a photo on the page (the card's
// blurred backdrop, the home rows' repeated cards) start at the step that
// works instead of repeating a failing request.

export type ImageStage = "optimized" | "original" | "failed";

const MAX_REMEMBERED = 500;
const optimizedFailed = new Set<string>();
const originalFailed = new Set<string>();

const remember = (set: Set<string>, src: string) => {
  if (set.size >= MAX_REMEMBERED) set.delete(set.values().next().value as string);
  set.add(src);
};

// Only remote photos (Storage URLs) have an original to fall back to.
const hasOriginal = (src: string | null): src is string => !!src && /^https:\/\//.test(src);

export function initialStage(src: string | null): ImageStage {
  if (!hasOriginal(src)) return "optimized";
  if (originalFailed.has(src)) return "failed";
  if (optimizedFailed.has(src)) return "original";
  return "optimized";
}

// The stage after a load error at `stage`.
export function stageAfterError(src: string | null, stage: ImageStage): ImageStage {
  if (!hasOriginal(src)) return "failed";
  if (stage === "optimized") {
    remember(optimizedFailed, src);
    return "original";
  }
  remember(originalFailed, src);
  return "failed";
}

// tests only
export function forgetImageFailures() {
  optimizedFailed.clear();
  originalFailed.clear();
}
