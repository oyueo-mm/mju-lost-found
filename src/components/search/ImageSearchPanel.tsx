"use client";

import { useEffect, useRef, useState } from "react";

import { validateImageFile } from "@/lib/images/client";
import { reviveDates } from "@/lib/posts/reviveDates";
import type { PostDTO } from "@/lib/posts/service";
import type { PostListType } from "@/lib/posts/schema";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { ImageOffIcon } from "@/components/icons";

type ImageSearchPanelProps = {
  // Phase 32: image search always targets one concrete board (its
  // imageEmbedding column) -- same "user picks lost or found" contract AI
  // 의미 검색 already enforces for type=all, reusing SearchFilterBar's own
  // `type` state rather than adding a second board selector.
  type: PostListType;
};

// Phase 32: "이미지로 검색" -- a third search mode alongside keyword/AI 의미
// 검색 (see SearchFilterBar's own mode radio group). Deliberately its own
// component/state machine rather than folded into SearchFilterBar's
// existing form: the other two modes navigate (router.push -> a server-
// rendered results page), but an uploaded photo can't be represented in a
// URL, so this mode fetches POST /api/posts?mode=image client-side and
// renders its own results below the file picker instead.
export function ImageSearchPanel({ type }: ImageSearchPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // null = "haven't searched yet" (nothing to show below the picker);
  // [] vs non-empty distinguishes "searched, no matches" from "has results".
  const [results, setResults] = useState<PostDTO[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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
    if (!file) return;
    if (type === "all") {
      setError("이미지 검색은 분실물 또는 습득물 게시판을 선택한 경우에만 사용할 수 있습니다.");
      return;
    }

    setPending(true);
    setError(null);
    setResults(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch(`/api/posts?mode=image&type=${type}`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(json?.error ?? "이미지 검색에 실패했습니다. 다시 시도해주세요.");
        return;
      }

      const items = ((json?.data ?? []) as Record<string, unknown>[]).map(reviveDates);
      setResults(items);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="relative flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-card border border-dashed border-border bg-muted sm:w-40">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob: object URL preview, not a remote/optimizable image.
            <img src={previewUrl} alt="검색할 이미지 미리보기" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-4 text-center text-xs text-muted-foreground">
              <ImageOffIcon className="size-5" />
              <span>선택한 이미지가 여기에 표시돼요</span>
            </div>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 sm:pt-1">
          <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-foreground/30 has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
            {file ? "다른 사진으로 교체" : "사진 선택"}
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={pending}
              onChange={handleFileChange}
              className="sr-only"
            />
          </label>
          <p className="text-xs text-muted-foreground">JPEG, PNG, WebP · 최대 10MB</p>

          <Button
            type="button"
            size="sm"
            disabled={!file || pending || type === "all"}
            onClick={handleSearch}
            className="w-fit"
          >
            {pending ? "검색 중..." : "이미지로 검색"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      {results !== null && (
        <div className="flex flex-col gap-3">
          {/* Phase G-2: same Top-K framing as SearchFilterBar's own
              SemanticSearchNotice (AI 의미 검색) -- image search is the
              same shape of ranked-recommendation, capped server-side (see
              /api/posts's mode=image handler), so it deserves the same
              "this isn't the full result set" expectation-setting. Shown
              only once results actually came back (matching
              SemanticSearchNotice's own "never on an empty/not-yet-
              searched state" behavior), not above the picker where there's
              nothing yet to caveat. */}
          {results.length > 0 && (
            <p className="rounded-lg bg-primary-muted px-3 py-2 text-xs text-primary">
              AI가 사진과 가장 유사한 상위 10건을 보여드립니다.
            </p>
          )}
          {results.length === 0 ? (
            <EmptyState title="비슷한 게시글을 찾지 못했어요." description="다른 사진으로 다시 시도해보세요." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {results.map((post) => (
                <PostCard key={`${post.type}-${post.id}`} post={post} scoreLabel="이미지 유사도" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
