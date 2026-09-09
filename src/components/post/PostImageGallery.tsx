"use client";

import { useState } from "react";
import Image from "next/image";

type GalleryImage = { id: number; imageUrl: string; isPrimary: boolean };

type PostImageGalleryProps = {
  images: GalleryImage[];
  title: string;
};

// Phase 11-4D: only rendered by post/[id]/page.tsx when a post has 2+
// images -- 0 and 1 keep that page's own pre-existing single-image/
// no-image markup unchanged (see this component's own non-use there), so
// this never has to reproduce those states. "use client" only because
// thumbnail selection needs local state; the images themselves are still
// plain server-fetched data (post.images, ordered by displayOrder), no
// client fetch of its own.
export function PostImageGallery({ images, title }: PostImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = images[selectedIndex] ?? images[0];

  return (
    <div className="flex flex-col gap-2">
      {/* Same box treatment (aspect/height bounds, object-contain, muted
          letterbox) as the single-image case this replaces -- see
          post/[id]/page.tsx's own comment on why `fill` + `object-contain`
          inside a height-bounded box was chosen there. */}
      <div className="relative h-[45vh] w-full overflow-hidden rounded-card border border-border bg-muted md:h-[65vh]">
        <Image
          key={selected.id}
          src={selected.imageUrl}
          alt={title}
          fill
          sizes="(min-width: 768px) 768px, 100vw"
          className="object-contain"
          priority
        />
      </div>

      {/* Thumbnail strip -- horizontally scrollable (never wraps into a
          grid that would push the rest of the page down unpredictably)
          since a post can have up to 5 images; each thumbnail is a real
          <button> (keyboard-operable, not a div with an onClick) with an
          aria-label naming its position, and aria-current marks the one
          currently shown in the hero above. */}
      <div role="tablist" aria-label="이미지 목록" className="flex gap-2 overflow-x-auto pb-1">
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            role="tab"
            aria-selected={index === selectedIndex}
            aria-current={index === selectedIndex}
            aria-label={`${index + 1}번째 이미지${image.isPrimary ? " (대표)" : ""} 보기`}
            onClick={() => setSelectedIndex(index)}
            className={`relative size-16 shrink-0 overflow-hidden rounded-lg border transition-colors ${
              index === selectedIndex ? "border-primary" : "border-border hover:border-foreground/30"
            }`}
          >
            <Image src={image.imageUrl} alt="" fill sizes="64px" className="object-cover" />
            {image.isPrimary && (
              <span className="absolute right-0.5 bottom-0.5 rounded-full bg-card/90 px-1 text-[9px] font-medium text-foreground shadow-sm">
                대표
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
