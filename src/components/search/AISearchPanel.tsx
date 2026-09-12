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
import { CameraIcon, SearchIcon, XIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";

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
  // AI 검색 UI 시안 개선 Phase: Home의 히어로 검색창도 이 컴포넌트를 그대로
  // 재사용한다 -- 새 검색 로직/엔드포인트를 만들지 않고, 입력창
  // placeholder만 이 화면에 맞게 살짝 바꿀 수 있도록 하는 선택적 prop.
  // 생략하면 기존 문구 그대로. (검색 대상 및 게시글 목록 UX 개선 Phase:
  // Home도 `type`을 "all"로 고정하지 않는다 -- 기본값은 "found"이고,
  // HomeSearchBar 자신의 select로 사용자가 바꿀 수 있다. 이 컴포넌트
  // 입장에서는 /search·/lost·/found와 똑같이 그냥 호출자가 넘겨준 type을
  // 그대로 쓸 뿐이다.)
  placeholder?: string;
};

// AI 검색 UI 시안 개선 Phase: 이 컴포넌트의 입력 영역을 "검색어 입력 +
// 사진 선택(선택사항) + 검색"이 한 줄의 압축된 바(bar)에 자연스럽게 녹아
// 있는 형태로 다시 그렸다 -- 이전에는 사진 선택이 처음부터 넓은 점선 박스
// + 별도 버튼 줄로 항상 펼쳐져 있어 "사진이 필요한 기능"처럼 보였다.
// 이제는 텍스트 입력 왼쪽의 작은 카메라 아이콘 버튼 하나가 photo attach의
// 전부다: 누르기 전에는 입력창 폭을 거의 차지하지 않고, 사진을 고르면
// 그 자리가 작은 thumbnail chip(제거 버튼 포함)으로 바뀐다. 검색/랭킹
// 로직(handleSearch 이하)은 이전과 완전히 동일 -- 이번 Phase는 시안(UI)
// 변경이며 API/알고리즘을 건드리지 않는다.
export function AISearchPanel({ type, placeholder }: AISearchPanelProps) {
  const { t } = useI18n();
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

  async function handleSearch(event?: React.FormEvent) {
    event?.preventDefault();
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
        // 서버가 돌려준 메시지는 아직 한국어다(API 계층은 이번 번역
        // 범위 밖) -- 서버 메시지가 없을 때의 기본 문구만 번역된다.
        setError(json?.error ?? t("aiSearch.failed"));
        return;
      }

      const items = ((json?.data ?? []) as Record<string, unknown>[]).map(reviveDates);
      setResults(items);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setPending(false);
    }
  }

  // 사진이 없고 아직 검색하지 않은 상태에서만 "사진은 선택이다"를 한 줄로
  // 알려준다 -- 사진을 고른 뒤나 결과가 이미 떠 있을 때는 같은 말을
  // 반복할 필요가 없어 자동으로 사라진다(섹션 2/3 요구사항: 사진을 필수
  // 입력처럼 보이게 하지 않는다).
  const showOptionalHint = !file && results === null;

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={handleSearch}
        className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1.5 shadow-sm transition-colors focus-within:border-primary sm:px-2.5 sm:py-2"
      >
        {previewUrl ? (
          <div className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: object URL preview, not a remote/optimizable image. */}
            <img
              src={previewUrl}
              alt={t("aiSearch.previewAlt")}
              className="size-9 rounded-full border border-border object-cover"
            />
            <button
              type="button"
              onClick={handleRemoveImage}
              disabled={pending}
              aria-label={t("aiSearch.removePhoto")}
              className="absolute -top-1 -right-1 flex size-4.5 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-50"
            >
              <XIcon className="size-2.5" strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <label
            aria-label={t("aiSearch.attachPhoto")}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50"
          >
            <CameraIcon className="size-4.5" />
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={pending}
              onChange={handleFileChange}
              className="sr-only"
            />
          </label>
        )}

        <input
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setResults(null);
          }}
          placeholder={placeholder ?? t("aiSearch.placeholder")}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          disabled={pending}
          className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />

        <button
          type="submit"
          disabled={!canSearch || pending}
          aria-label={t("aiSearch.label")}
          className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <SearchIcon className="size-3.5 sm:hidden" />
          <span className="hidden sm:inline">{pending ? t("common.searching") : t("common.search")}</span>
        </button>
      </form>

      {showOptionalHint && (
        <p className="px-1 text-xs text-muted-foreground">
          {t("aiSearch.hint")}
        </p>
      )}
      {hasImageTypeConflict && (
        <p className="px-1 text-xs text-warning">
          {t("aiSearch.typeConflict")}
        </p>
      )}

      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      {results !== null && (
        <div className="flex flex-col gap-3">
          {results.length > 0 && (
            <p className="rounded-lg bg-primary-muted px-3 py-2 text-xs text-primary">
              {t("aiSearch.resultNotice")}
            </p>
          )}
          {results.length === 0 ? (
            <div className="flex flex-col gap-4">
              <EmptyState title={t("aiSearch.empty.title")} description={t("aiSearch.empty.description")} />
              <Lost112Notice />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {results.map((post) => (
                <PostCard key={`${post.type}-${post.id}`} post={post} scoreLabel={t("post.score.ai")} scoreDisplay="decimal" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
