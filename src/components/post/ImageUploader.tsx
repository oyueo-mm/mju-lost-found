"use client";

import { useEffect, useRef, useState } from "react";

import { validateImageFile } from "@/lib/images/client";

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

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm">이미지</span>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- local blob: object URL preview, not a remote/optimizable image.
        <img
          src={previewUrl}
          alt="선택한 이미지 미리보기"
          className="h-48 w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      {showExisting && (
        // eslint-disable-next-line @next/next/no-img-element -- simple form preview; the optimized <Image> is used on read-only pages instead.
        <img
          src={existingImageUrl}
          alt="현재 등록된 이미지"
          className="h-48 w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      {markedForRemoval && (
        <div className="flex items-center justify-between rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <span>저장 시 이미지가 삭제됩니다.</span>
          <button
            type="button"
            onClick={handleUndoRemoval}
            disabled={disabled}
            className="text-zinc-700 underline disabled:opacity-60 dark:text-zinc-300"
          >
            취소
          </button>
        </div>
      )}

      {!previewUrl && !showExisting && !markedForRemoval && (
        <div className="flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
          등록된 이미지가 없습니다.
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={handleFileChange}
          className="text-sm disabled:opacity-60"
        />
        {showExisting && (
          <button
            type="button"
            onClick={handleRemoveExisting}
            disabled={disabled}
            className="text-sm text-red-600 underline disabled:opacity-60 dark:text-red-400"
          >
            이미지 삭제
          </button>
        )}
      </div>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        JPEG, PNG, WebP · 최대 10MB
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
