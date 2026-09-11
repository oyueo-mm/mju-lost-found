"use client";

import { useEffect, useRef, useState } from "react";

import { validateImageFile } from "@/lib/images/client";
import { reviveDates } from "@/lib/posts/reviveDates";
import type { PostDTO } from "@/lib/posts/service";
import type { PostListType } from "@/lib/posts/schema";
import { MAX_SEARCH_QUERY_LENGTH } from "@/lib/posts/schema";
import { PostCard } from "@/components/post/PostCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Lost112Notice } from "@/components/search/Lost112Notice";
import { Button } from "@/components/ui/Button";
import { ImageOffIcon } from "@/components/icons";

type AISearchPanelProps = {
  // AI 검색 고도화 Phase: replaces the old ImageSearchPanel (이미지 전용)
  // -- same "user picks lost/found/전체 from SearchFilterBar's own `type`
  // state" contract, but now the query itself is optional text AND/OR an
  // optional image (POST /api/posts?mode=ai&type=..., see route.ts's
  // handleAiSearch). Text-only can search type="all" (reuses
  // searchPostsSemantic/-All exactly as the old "AI 의미 검색" mode did);
  // an image (alone or combined with text) still requires a specific
  // board, same restriction the old image-only mode already had --
  // imageEmbedding is a per-board column, there's no cross-board query.
  type: PostListType;
};

// AI 검색 고도화 Phase: "AI 검색" -- 검색어(선택) + 사진(선택), 최소
// 하나는 있어야 검색된다. 키워드 검색과 명확히 분리된 별도 모드로,
// 키워드 검색(SearchFilterBar의 기존 q input + router.push 흐름)은 이
// 컴포넌트가 전혀 건드리지 않는다. 이미지가 URL에 담길 수 없으므로(기존
// "이미지로 검색"과 동일한 이유) 이 컴포넌트도 client-side fetch로 직접
// /api/posts를 호출하고 자기 자신이 결과 영역을 그린다 -- 페이지
// 네비게이션이 일어나지 않는다.
export function AISearchPanel({ type }: AISearchPanelProps) {
  const [query, setQuery] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // null = "haven't searched yet" (nothing to show below the inputs);
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

  function handleRemoveImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
    setResults(null);
  }

  const trimmedQuery = query.trim();
  // 이미지가 있으면(단독이든 텍스트와 결합이든) 특정 게시판이 필요하다 --
  // handleAiSearch의 서버 측 검증과 동일한 규칙을 클라이언트에서도 미리
  // 보여준다(진짜 방어는 서버가 한다).
  const hasImageTypeConflict = file !== null && type === "all";
  const canSearch = (trimmedQuery !== "" || file !== null) && !hasImageTypeConflict;

  async function handleSearch() {
    if (!canSearch) return;

    setPending(true);
    setError(null);
    setResults(null);

    try {
      const formData = new FormData();
      if (trimmedQuery !== "") formData.append("q", trimmedQuery);
      if (file) formData.append("image", file);

      const res = await fetch(`/api/posts?mode=ai&type=${type}`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(json?.error ?? "AI 검색에 실패했습니다. 다시 시도해주세요.");
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
      <div className="flex flex-col gap-1.5">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setResults(null);
          }}
          placeholder="예: 검은색 무선 이어폰을 잃어버렸어요"
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          disabled={pending}
          className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        <p className="text-xs text-muted-foreground">검색어만, 사진만, 또는 검색어와 사진을 함께 입력할 수 있어요.</p>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="relative flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-card border border-dashed border-border bg-muted sm:w-40">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob: object URL preview, not a remote/optimizable image.
            <img src={previewUrl} alt="검색할 이미지 미리보기" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-4 text-center text-xs text-muted-foreground">
              <ImageOffIcon className="size-5" />
              <span>사진은 선택사항이에요</span>
            </div>
          )}
        </div>

        <div className="flex w-full flex-col gap-2 sm:pt-1">
          <div className="flex flex-wrap gap-2">
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
            {file && (
              <button
                type="button"
                onClick={handleRemoveImage}
                disabled={pending}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 disabled:opacity-50"
              >
                사진 제거
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">JPEG, PNG, WebP · 최대 10MB</p>
          {hasImageTypeConflict && (
            <p className="text-xs text-warning">
              이미지가 포함된 AI 검색은 분실물 또는 습득물 게시판을 선택한 경우에만 사용할 수 있습니다.
            </p>
          )}

          <Button type="button" size="sm" disabled={!canSearch || pending} onClick={handleSearch} className="w-fit">
            {pending ? "검색 중..." : "AI로 검색"}
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
          {results.length > 0 && (
            <p className="rounded-lg bg-primary-muted px-3 py-2 text-xs text-primary">
              AI가 가장 유사한 상위 10건을 보여드립니다. AI 유사도는 AI가 계산한 유사도 점수로, 값이 높을수록 검색
              조건과 더 유사한 결과예요.
            </p>
          )}
          {results.length === 0 ? (
            <div className="flex flex-col gap-4">
              <EmptyState title="비슷한 게시글을 찾지 못했어요." description="다른 검색어나 사진으로 다시 시도해보세요." />
              <Lost112Notice />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {results.map((post) => (
                <PostCard key={`${post.type}-${post.id}`} post={post} scoreLabel="AI 유사도" scoreDisplay="decimal" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
