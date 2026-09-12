"use client";

import { useState } from "react";
import { CAMPUSES } from "@/lib/campus";
import { resizeImage } from "@/lib/image-client";
import PostCard from "./PostCard";

export default function ImageSearchPanel() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function onPick(e) {
    const picked = e.target.files?.[0];
    if (!picked) {
      setFile(null);
      setPreview(null);
      return;
    }
    // 비전 모델엔 1024px 이면 충분 — 업로드가 훨씬 빨라짐
    const f = await resizeImage(picked, { maxEdge: 1024, quality: 0.85 });
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!file) {
      setError("사진을 선택해 주세요.");
      return;
    }
    const form = new FormData(e.currentTarget);
    form.set("image", file);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/image-search", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) setError(json.error || "검색에 실패했어요.");
      else setData(json);
    } catch {
      setError("검색에 실패했어요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="card space-y-3 p-4">
        <p className="text-sm text-ink-soft">
          물건 사진을 올리면 AI가 무엇인지 파악해 비슷한 게시글을 찾아드려요.
        </p>
        <input
          type="file"
          name="image"
          accept="image/jpeg,image/png,image/webp"
          required
          onChange={onPick}
          className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-32 w-32 rounded-lg object-cover" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            name="campus"
            defaultValue=""
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">전체 캠퍼스</option>
            {Object.values(CAMPUSES).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary ml-auto shrink-0 px-5 py-2 text-sm"
          >
            {loading ? "분석 중…" : "사진으로 검색"}
          </button>
        </div>
      </form>

      {loading && (
        <p className="card-dashed p-8 text-center text-sm text-ink-faint">
          AI가 사진을 분석하고 있어요…
        </p>
      )}
      {error && (
        <p className="card-dashed p-6 text-center text-sm text-brand-deep">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="card p-4">
            <p className="text-xs font-semibold text-ink-faint">AI가 인식한 특징</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {String(data.description || "")
                .split(/[,·]/)
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t, i) => (
                  <span key={i} className="chip bg-sunken text-ink-soft">
                    {t}
                  </span>
                ))}
            </div>
            {data.warning && (
              <p className="mt-2 text-xs text-brand-deep">{data.warning}</p>
            )}
          </div>
          {data.results.length === 0 ? (
            <p className="card-dashed p-10 text-center text-sm text-ink-faint">
              비슷한 게시글이 없어요.
            </p>
          ) : (
            <div>
              <p className="num mb-2 text-[13px] text-ink-faint">
                비슷한 게시글 {data.results.length}건
              </p>
              <div className="card divide-y divide-line-soft overflow-hidden">
                {data.results.map(({ kind, post, pct }) => (
                  <PostCard
                    key={`${kind}-${post.id}`}
                    post={post}
                    kind={kind}
                    badge={
                      typeof pct === "number" && pct > 0 ? (
                        <span className="num chip shrink-0 bg-brand text-white">
                          {pct}%
                        </span>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
