"use client";

import { useEffect, useRef, useState } from "react";

import { validateImageFile } from "@/lib/images/client";
import { ImageOffIcon } from "@/components/icons";

type ImageUploaderProps = {
  existingImageUrl: string | null;
  disabled?: boolean;
  onFileSelected: (file: File | null) => void;
  onRemoveExisting: (remove: boolean) => void;
};

// Purely local UI state (file picking, preview, client-side validation
// message) -- the actual upload only happens when PostForm submits, and
// only PostForm knows the postId needed to do it. This component just
// reports the user's choice upward.
export function ImageUploader({
  existingImageUrl,
  disabled,
  onFileSelected,
  onRemoveExisting,
}: ImageUploaderProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markedForRemoval, setMarkedForRemoval] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError(null);

    if (!file) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      onFileSelected(null);
      return;
    }

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError.message);
      event.target.value = "";
      onFileSelected(null);
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setMarkedForRemoval(false);
    onRemoveExisting(false);
    onFileSelected(file);
  }

  function handleRemoveExisting() {
    setMarkedForRemoval(true);
    onRemoveExisting(true);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (inputRef.current) inputRef.current.value = "";
    onFileSelected(null);
  }

  function handleUndoRemoval() {
    setMarkedForRemoval(false);
    onRemoveExisting(false);
  }

  const showExisting = existingImageUrl && !previewUrl && !markedForRemoval;
  const hasImage = Boolean(previewUrl || showExisting);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex h-56 w-full items-center justify-center overflow-hidden rounded-card border border-border bg-muted">
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- local blob: object URL preview, not a remote/optimizable image.
          <img src={previewUrl} alt="선택한 이미지 미리보기" className="h-full w-full object-cover" />
        )}

        {showExisting && (
          // eslint-disable-next-line @next/next/no-img-element -- simple form preview; the optimized <Image> is used on read-only pages instead.
          <img src={existingImageUrl} alt="현재 등록된 이미지" className="h-full w-full object-cover" />
        )}

        {markedForRemoval && (
          <div className="flex flex-col items-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <ImageOffIcon className="size-6" />
            <span>저장 시 이미지가 삭제됩니다.</span>
            <button
              type="button"
              onClick={handleUndoRemoval}
              disabled={disabled}
              className="text-sm font-medium text-primary underline disabled:opacity-60"
            >
              삭제 취소
            </button>
          </div>
        )}

        {!previewUrl && !showExisting && !markedForRemoval && (
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <ImageOffIcon className="size-6" />
            <span>등록된 이미지가 없습니다</span>
          </div>
        )}

        {showExisting && (
          <button
            type="button"
            onClick={handleRemoveExisting}
            disabled={disabled}
            className="absolute top-2 right-2 rounded-full bg-card/90 px-3 py-1.5 text-xs font-medium text-destructive shadow-sm backdrop-blur-sm disabled:opacity-60"
          >
            삭제
          </button>
        )}
      </div>

      <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
        {hasImage ? "다른 사진으로 교체" : "사진 선택"}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={handleFileChange}
          className="sr-only"
        />
      </label>

      <p className="text-xs text-muted-foreground">JPEG, PNG, WebP · 최대 10MB</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
