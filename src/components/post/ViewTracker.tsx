"use client";

import { useEffect, useRef } from "react";

import { recordPostViewAction } from "@/lib/posts/views";
import type { PostType } from "@/lib/posts/schema";

// Invisible -- fires the view-count Server Action once per mount, after
// the post itself has already rendered (this runs in an effect, not
// during render), so a slow/failed view-count write can never delay or
// break the page the viewer came to read. `useRef` guards against
// React 19 Strict Mode's dev-only double-invoke firing this twice locally
// (recordPostViewAction's own one-per-viewer-per-post dedup would absorb
// that anyway, but this avoids the redundant call entirely).
export function ViewTracker({ type, postId }: { type: PostType; postId: number }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    recordPostViewAction(type, postId);
  }, [type, postId]);

  return null;
}
