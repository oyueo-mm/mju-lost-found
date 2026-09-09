"use client";

import Image from "next/image";

import { MAX_IMAGES_PER_POST } from "@/lib/images/config";
import type { GalleryItem } from "@/lib/images/galleryState";
import { ChevronDownIcon, ChevronUpIcon, ImageOffIcon, XIcon } from "@/components/icons";

type PostImageManagerProps = {
  items: GalleryItem[];
  disabled?: boolean;
  // Per-item id of an existing image currently mid-delete (its own DELETE
  // request in flight) -- disables that one item's own controls without
  // freezing the whole gallery.
  deletingExistingId?: number | null;
  onFilesSelected: (files: File[]) => void;
  onRemoveNew: (localId: string) => void;
  onDeleteExisting: (id: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
};

// Phase 11-4D: replaces the old single-image ImageUploader -- PostForm now
// owns every bit of gallery state (see its own `items`/handlers) and passes
// it down here purely for rendering + reporting user actions back up, the
// same "component reports the user's choice upward, PostForm does the
// actual API work" split ImageUploader already established for the single-
// image flow. `items`' own order IS displayOrder -- index 0 is always
// primary, rendered with the "대표" badge below.
export function PostImageManager({
  items,
  disabled,
  deletingExistingId,
  onFilesSelected,
  onRemoveNew,
  onDeleteExisting,
  onMove,
}: PostImageManagerProps) {
  const atMax = items.length >= MAX_IMAGES_PER_POST;

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // lets picking the exact same file again re-fire onChange
    if (files.length > 0) onFilesSelected(files);
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <div className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border text-sm text-muted-foreground">
          <ImageOffIcon className="size-6" />
          <span>등록된 이미지가 없습니다</span>
        </div>
      ) : (
        // Phase 11-4D section 18: 3 columns even at 375px keeps each thumbnail
        // (plus its own control row below, not overlaid on top of it) wide
        // enough for three real touch targets without crowding -- verified
        // against this phase's own 375/390 viewport requirement.
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((item, index) => {
            const key = item.kind === "existing" ? `existing-${item.id}` : `new-${item.localId}`;
            const url = item.kind === "existing" ? item.url : item.previewUrl;
            const isPrimary = index === 0;
            const itemDisabled = disabled || (item.kind === "existing" && deletingExistingId === item.id);

            return (
              <li key={key} className="flex flex-col gap-1.5">
                <div className="relative aspect-square w-full overflow-hidden rounded-card border border-border bg-muted">
                  {/* Phase 11-4D: a "new" item's preview is a local blob:
                      object URL (never optimizable/remote), same reasoning
                      ImageUploader's own preview <img> already documented --
                      an "existing" item's URL is a real Supabase Storage
                      URL, so next/image is used for that one instead. */}
                  {item.kind === "new" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local blob: object URL preview.
                    <img src={url} alt="선택한 이미지 미리보기" className="h-full w-full object-cover" />
                  ) : (
                    <Image src={url} alt="게시글 이미지" fill sizes="200px" className="object-cover" />
                  )}
                  {isPrimary && (
                    <span className="absolute top-1.5 left-1.5 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur-sm">
                      대표
                    </span>
                  )}
                  {itemDisabled && item.kind === "existing" && deletingExistingId === item.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-card/60 text-xs text-muted-foreground">
                      삭제 중...
                    </div>
                  )}
                </div>

                {/* Phase 11-4D section 18: controls sit in their own row
                    below the thumbnail, never overlaid on top of it -- three
                    icon buttons overlaid on a small mobile thumbnail would
                    be too cramped to reliably tap. */}
                <div className="flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMove(index, -1)}
                    disabled={itemDisabled || index === 0}
                    aria-label="위로 이동"
                    className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronUpIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(index, 1)}
                    disabled={itemDisabled || index === items.length - 1}
                    aria-label="아래로 이동"
                    className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronDownIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => (item.kind === "existing" ? onDeleteExisting(item.id) : onRemoveNew(item.localId))}
                    disabled={itemDisabled}
                    aria-label="이미지 삭제"
                    className="flex size-7 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive-muted disabled:pointer-events-none disabled:opacity-30"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <label
        className={`inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50 ${atMax ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
      >
        사진 추가
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={disabled || atMax}
          onChange={handleFileInputChange}
          className="sr-only"
        />
      </label>

      <p className="text-xs text-muted-foreground">
        JPEG, PNG, WebP · 최대 10MB · 최대 {MAX_IMAGES_PER_POST}장 ({items.length}/{MAX_IMAGES_PER_POST})
      </p>
    </div>
  );
}
