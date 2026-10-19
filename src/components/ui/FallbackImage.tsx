"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

import { initialStage, stageAfterError, type ImageStage } from "@/lib/images/fallback";

// next/image with a way out (lib/images/fallback.ts): optimized as usual;
// if /_next/image fails (e.g. the Image Optimization quota is used up --
// 402), the same photo straight from Storage, unoptimized; if that fails
// too, `fallback` (the caller's existing placeholder). Same props, same
// layout; nothing else changes while optimization works.
export function FallbackImage({ fallback = null, onError, unoptimized, alt, ...props }: ImageProps & { fallback?: ReactNode }) {
  const src = typeof props.src === "string" ? props.src : null;
  const [state, setState] = useState<{ src: string | null; stage: ImageStage }>(() => ({ src, stage: initialStage(src) }));
  // a new photo starts over (React's pattern for state that follows a prop)
  if (state.src !== src) setState({ src, stage: initialStage(src) });
  const stage = state.src === src ? state.stage : initialStage(src);

  if (stage === "failed") return <>{fallback}</>;
  return (
    <Image
      alt={alt}
      {...props}
      unoptimized={unoptimized || stage === "original"}
      onError={(event) => {
        const next = stageAfterError(src, stage);
        setState({ src, stage: next });
        onError?.(event);
      }}
    />
  );
}
