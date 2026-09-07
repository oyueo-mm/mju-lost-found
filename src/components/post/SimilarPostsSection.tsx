"use client";

import { useEffect, useRef, useState } from "react";

import { MAX_SEARCH_QUERY_LENGTH, type PostType } from "@/lib/posts/schema";
import type { PostDTO } from "@/lib/posts/service";
import { reviveDates } from "@/lib/posts/reviveDates";
import { validateImageFile } from "@/lib/images/client";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { SearchIcon, ImageOffIcon } from "@/components/icons";

type SearchMode = "text" | "image";

// Same "the other board" convention findSimilarPostsByImageForDisplay()
// already established (Phase 15-2) -- viewing a lost post, you're looking
// for it among found posts, and vice versa. Kept here too so both search
// modes point at the same, more useful board.
const OPPOSITE_TYPE: Record<PostType, PostType> = { lost: "found", found: "lost" };
const BOARD_LABEL: Record<PostType, string> = { lost: "분실물", found: "습득물" };

const RESULT_LIMIT = 6;

// Phase I section 9: replaces ImageSimilaritySection -- unifies the
// text-based AI 의미 검색 (already used on /lost /found /search, just never
// exposed on the post detail page before) and the existing image
// similarity search behind one "비슷한 게시물 찾기" control, with one shared
// results area. Reuses the exact same two backend endpoints those
// features already have (GET /api/posts?mode=semantic and POST
// /api/posts?mode=image) -- no new API route, no change to the AI models
// or ranking logic themselves, only this front-end composition.
export function SimilarPostsSection({ sourceType }: { sourceType: PostType }) {
  const targetType = OPPOSITE_TYPE[sourceType];

  const [mode, setMode] = useState<SearchMode>("text");
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = "haven't searched yet"; [] vs non-empty distinguishes "searched,
  // no matches" from "has results" -- same convention ImageSearchPanel's
  // own results state already uses.
  const [results, setResults] = useState<PostDTO[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function switchMode(next: SearchMode) {
    setMode(next);
    setResults(null);
    setError(null);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setError(null);
    setResults(null);

    if (!selected) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setFile(null);
      return;
    }

    const validationError = validateImageFile(selected);
    if (validationError) {
      setError(validationError.message);
      event.target.value = "";
      setFile(null);
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(selected));
    setFile(selected);
  }

  async function handleSearch() {
    if (mode === "text" && !query.trim()) return;
    if (mode === "image" && !file) return;
    if (pending) return;

    setPending(true);
    setError(null);
    setResults(null);

    try {
      let res: Response;
      if (mode === "text") {
        const params = new URLSearchParams({
          type: targetType,
          mode: "semantic",
          q: query.trim(),
          limit: String(RESULT_LIMIT),
        });
        res = await fetch(`/api/posts?${params.toString()}`);
      } else {
        const formData = new FormData();
        formData.append("image", file!);
        res = await fetch(`/api/posts?mode=image&type=${targetType}`, { method: "POST", body: formData });
      }

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "비슷한 게시물을 찾지 못했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      const items = ((json?.data ?? []) as Record<string, unknown>[]).slice(0, RESULT_LIMIT).map(reviveDates);
      setResults(items);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  const searchDisabled = pending || (mode === "text" ? !query.trim() : !file);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground">비슷한 게시물 찾기</h2>
        <p className="text-xs text-muted-foreground">
          {BOARD_LABEL[targetType]} 게시판에서 AI로 비슷한 게시물을 찾아드려요. 실제 동일 물건 여부를 보장하지는 않아요.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-4 text-sm" role="radiogroup" aria-label="검색 기준">
          <span className="text-xs font-medium text-muted-foreground">검색 기준</span>
          <label className="flex items-center gap-1.5 text-foreground">
            <input type="radio" checked={mode === "text"} onChange={() => switchMode("text")} disabled={pending} />
            자연어로 찾기
          </label>
          <label className="flex items-center gap-1.5 text-foreground">
            <input type="radio" checked={mode === "image"} onChange={() => switchMode("image")} disabled={pending} />
            이미지로 찾기
          </label>
        </div>

        {mode === "text" ? (
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={2}
            maxLength={MAX_SEARCH_QUERY_LENGTH}
            disabled={pending}
            placeholder="찾고 있는 물건을 설명해주세요. 예: 검은색 백팩, 안에 노트북 파우치가 들어있어요"
            className="rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground disabled:opacity-60"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <div className="relative flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-card border border-dashed border-border bg-muted sm:w-28">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- local blob: object URL preview, not a remote/optimizable image.
                <img src={previewUrl} alt="검색할 이미지 미리보기" className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 px-3 text-center text-xs text-muted-foreground">
                  <ImageOffIcon className="size-5" />
                  <span>이미지 선택</span>
                </div>
              )}
            </div>
            <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-foreground/30 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
              {file ? "다른 사진으로 교체" : "사진 선택"}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={pending}
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
          </div>
        )}

        <Button type="button" size="sm" onClick={handleSearch} disabled={searchDisabled} className="w-fit">
          <SearchIcon className="size-4" />
          {pending ? "찾는 중..." : "비슷한 게시물 찾기"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results !== null &&
        !error &&
        (results.length === 0 ? (
          <EmptyState title="비슷한 게시물을 찾지 못했어요." description="다른 설명이나 사진으로 다시 시도해보세요." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {results.map((p) => (
              <PostCard key={`${p.type}-${p.id}`} post={p} scoreLabel={mode === "text" ? "검색 유사도" : "이미지 유사도"} />
            ))}
          </div>
        ))}
    </div>
  );
}
