"use client";

import { useState } from "react";

import type { PostType } from "@/lib/posts/schema";
import type { PostDTO } from "@/lib/posts/service";
import { PostCard } from "@/components/post/PostCard";
import { Button } from "@/components/ui/Button";
import { SearchIcon } from "@/components/icons";

type ImageSimilaritySectionProps = {
  postType: PostType;
  postId: number;
};

// Raw JSON has no Date type -- createdAt/updatedAt/lostAt/foundAt come
// back as ISO strings and must be revived into real Date objects, same as
// src/lib/posts/searchApiClient.ts's reviveDates() (PostCard's own
// formatDate() requires an actual Date, not a string).
function reviveDates(raw: Record<string, unknown>): PostDTO {
  const revived: Record<string, unknown> = {
    ...raw,
    createdAt: new Date(raw.createdAt as string),
    updatedAt: new Date(raw.updatedAt as string),
  };
  if (raw.type === "lost") revived.lostAt = new Date(raw.lostAt as string);
  else revived.foundAt = new Date(raw.foundAt as string);
  return revived as unknown as PostDTO;
}

// This phase: the same "button click, not automatic" treatment
// MatchPanel.tsx got in Phase 23 -- findSimilarPostsByImageForDisplay()
// used to run synchronously in the post detail page's own server render
// for every post with an image, blocking the whole page behind a real
// SigLIP vector search on every single visit (see this phase's own
// performance report). Public, no auth gate -- same policy as this
// feature always had (Phase 15-2), unchanged here; only *when* it runs
// changed, not who can see it or how accurate it is.
export function ImageSimilaritySection({ postType, postId }: ImageSimilaritySectionProps) {
  const [results, setResults] = useState<PostDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFindSimilar() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/similar-images?type=${postType}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "비슷한 게시물을 찾지 못했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      setResults((json.data as Record<string, unknown>[]).map(reviveDates));
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground">이 사진과 비슷한 게시물</h2>
        <p className="text-xs text-muted-foreground">
          비슷한 물건까지 자동으로 찾아드려요. 실제 동일 물건 여부를 보장하지는 않아요.
        </p>
      </div>

      {results === null ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleFindSimilar}
          disabled={loading}
          className="self-start"
        >
          <SearchIcon className="size-4" />
          {loading ? "비슷한 게시물을 찾는 중..." : "이 사진과 비슷한 게시물 찾기"}
        </Button>
      ) : null}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results !== null && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground">비슷한 게시물을 찾지 못했어요.</p>
      )}

      {results !== null && results.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {results.map((p) => (
            <PostCard key={`${p.type}-${p.id}`} post={p} scoreLabel="이미지 유사도" />
          ))}
        </div>
      )}
    </div>
  );
}
