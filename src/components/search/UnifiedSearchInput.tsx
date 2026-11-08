"use client";

import { useEffect, useRef } from "react";
import { CameraIcon, SearchIcon, XIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { ALLOWED_IMAGE_CONTENT_TYPES } from "@/lib/images/config";
import { validateImageFile } from "@/lib/images/client";
import { MAX_SEARCH_QUERY_LENGTH } from "@/lib/posts/schema";

export function UnifiedSearchInput({ file, onFileChange, onImageError, query, defaultQuery, onQueryChange, placeholder, disabled = false, allowImage = true }: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onImageError: (message: string) => void;
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowImage?: boolean;
}) {
  const { t } = useI18n();
  const picker = useRef<HTMLInputElement>(null);
  const imageElement = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = file ? URL.createObjectURL(file) : null;
    if (url && imageElement.current) imageElement.current.src = url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-full border border-border bg-card px-2 py-1.5 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:px-3">
      {allowImage && <>
        {file ? <div className="relative shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- local attachment preview */}
          <img ref={imageElement} alt={t("aiSearch.previewAlt")} className="size-9 rounded-full object-cover" />
          <button type="button" aria-label={t("aiSearch.removePhoto")} disabled={disabled} onClick={() => { onFileChange(null); if (picker.current) picker.current.value = ""; }} className="absolute -top-1 -right-1 rounded-full border border-border bg-card p-0.5 focus-visible:outline-2 focus-visible:outline-primary"><XIcon className="size-3.5" /></button>
        </div> : <button type="button" aria-label={t("aiSearch.attachPhoto")} disabled={disabled} onClick={() => picker.current?.click()} className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"><CameraIcon aria-hidden="true" className="size-5" /></button>}
        <input ref={picker} type="file" accept={ALLOWED_IMAGE_CONTENT_TYPES.join(",")} aria-label={t("aiSearch.attachPhoto")} disabled={disabled} className="sr-only" onChange={(event) => {
          const image = event.target.files?.[0] ?? null;
          const error = image ? validateImageFile(image) : null;
          if (error) { onImageError(error.message); event.target.value = ""; return; }
          onFileChange(image);
        }} />
      </>}
      <input name="q" type="search" value={query} defaultValue={defaultQuery} onChange={onQueryChange ? (e) => onQueryChange(e.target.value) : undefined} maxLength={MAX_SEARCH_QUERY_LENGTH} aria-label={t("search.unified.placeholder")} placeholder={placeholder ?? t("search.unified.placeholder")} disabled={disabled} className="h-9 w-full min-w-0 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
      <button type="submit" aria-label={t("common.search")} disabled={disabled} className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50 sm:px-5"><SearchIcon aria-hidden="true" className="size-4 sm:hidden" /><span className="hidden sm:inline">{disabled ? t("common.searching") : t("common.search")}</span></button>
    </div>
  );
}
