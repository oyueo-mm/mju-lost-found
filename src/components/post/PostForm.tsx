"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CATEGORIES } from "@/lib/posts/schema";
import type { PostType } from "@/lib/posts/schema";
import { uploadPostImage } from "@/lib/images/client";
import { ImageUploader } from "./ImageUploader";
import { Button } from "@/components/ui/Button";

const FIELD_CLASS =
  "rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground disabled:opacity-60";

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

type PostFormValues = {
  title: string;
  description: string;
  category: string;
  location: string;
  dateValue: string; // <input type="datetime-local"> value
  imageUrl: string | null;
};

type PostFormProps = {
  type: PostType;
  postId?: number; // present in edit mode
  initialValues?: PostFormValues;
};

const DATE_FIELD = { lost: "lostAt", found: "foundAt" } as const;
const DATE_LABEL = { lost: "분실 일시", found: "습득 일시" } as const;
const TITLE_PLACEHOLDER = {
  lost: "예: 학생회관 앞에서 검정색 우산을 잃어버렸어요",
  found: "예: 도서관 열람실에서 우산을 주웠어요",
} as const;
const DESCRIPTION_PLACEHOLDER = {
  lost: "색상, 브랜드, 특징 등을 자세히 적어주시면 찾는 데 도움이 돼요.",
  found: "색상, 브랜드, 특징 등을 자세히 적어주시면 주인을 찾는 데 도움이 돼요.",
} as const;

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not UTC -- same
// conversion the edit page already does for an existing post's date
// (post/[id]/edit/page.tsx's toDateTimeLocalValue), duplicated here rather
// than shared since one is a Server Component helper and this one only
// ever needs "now" (create mode has no post to read a date from yet).
function nowAsDateTimeLocalValue(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

// 캠퍼스 선택은 순수 UI 힌트일 뿐 -- 어떤 <input>/<select>의 값도 되지 않고,
// handleSubmit의 FormData에도 전혀 등장하지 않는다 (name 속성이 없는 plain
// <button>이라 폼 제출에 포함될 수 없음). `location`은 완전히 별개의 자유
// 입력 필드로 남아 있어, 이 선택이 DB/API로 전달되는 값에 영향을 주지 않는다.
const CAMPUS_OPTIONS = ["자연캠", "인문캠"] as const;
type Campus = (typeof CAMPUS_OPTIONS)[number];

export function PostForm({ type, postId, initialValues }: PostFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  // Not persisted anywhere (see comment on CAMPUS_OPTIONS above), so an
  // edit-mode post has no prior campus to restore here -- it always starts
  // unselected, same as a brand-new post.
  const [campus, setCampus] = useState<Campus | null>(null);

  async function applyImageChange(id: number): Promise<string | null> {
    if (selectedFile) {
      try {
        const uploaded = await uploadPostImage(type, id, selectedFile);
        const res = await fetch(`/api/posts/${id}/image?type=${type}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(uploaded),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          return json.error ?? "이미지를 게시물에 연결하지 못했습니다.";
        }
      } catch {
        return "이미지 업로드에 실패했습니다.";
      }
      return null;
    }

    if (removeExisting) {
      const res = await fetch(`/api/posts/${id}/image?type=${type}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return json.error ?? "이미지를 삭제하지 못했습니다.";
      }
    }

    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const body = {
      type,
      title: formData.get("title"),
      description: formData.get("description"),
      category: formData.get("category"),
      location: formData.get("location"),
      [DATE_FIELD[type]]: formData.get("date"),
    };

    const url = postId ? `/api/posts/${postId}?type=${type}` : "/api/posts";
    const method = postId ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "요청을 처리하지 못했습니다.");
        setPending(false);
        return;
      }

      const id = postId ?? json.data.id;

      const imageError = await applyImageChange(id);
      if (imageError) {
        // The post itself was already saved successfully -- only the
        // image step failed, so this isn't treated as a full failure.
        // The user can retry the image from the edit page.
        setError(`게시물은 저장되었습니다. 다만 ${imageError} 게시물 페이지에서 다시 시도해주세요.`);
        setPending(false);
        return;
      }

      router.push(`/post/${id}?type=${type}`);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">기본 정보</h2>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">
            제목
            <RequiredMark />
          </span>
          <input
            name="title"
            type="text"
            required
            maxLength={200}
            placeholder={TITLE_PLACEHOLDER[type]}
            defaultValue={initialValues?.title}
            disabled={pending}
            className={FIELD_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">
            설명
            <RequiredMark />
          </span>
          <textarea
            name="description"
            required
            rows={5}
            maxLength={5000}
            placeholder={DESCRIPTION_PLACEHOLDER[type]}
            defaultValue={initialValues?.description}
            disabled={pending}
            className={FIELD_CLASS}
          />
        </label>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">분류 및 장소</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground">
              카테고리
              <RequiredMark />
            </span>
            <select
              name="category"
              required
              defaultValue={initialValues?.category ?? CATEGORIES[0]}
              disabled={pending}
              className={FIELD_CLASS}
            >
              {/* An existing post's category can be a value from before this
                  fixed list existed (or set directly via the API) -- rather
                  than silently dropping it (which would submit a different
                  category than the one shown), it's kept as an extra
                  selectable option instead of being erased. */}
              {initialValues?.category && !(CATEGORIES as readonly string[]).includes(initialValues.category) && (
                <option value={initialValues.category}>{initialValues.category}</option>
              )}
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5 text-sm">
            {/* Plain <span>, not a <label> -- these buttons don't label or
                control any single form field (see the CAMPUS_OPTIONS
                comment above), so there's nothing for a <label> to target.
                Keeps the same "buttons never nested inside a <label>"
                accessibility fix as before: each renders with a real
                "button" role, and aria-pressed reports which one (if any)
                is selected. */}
            <span className="font-medium text-foreground">
              캠퍼스 <span className="font-normal text-muted-foreground">(선택, 추천용)</span>
            </span>
            <div className="flex gap-1.5" role="group" aria-label="캠퍼스 선택">
              {CAMPUS_OPTIONS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant={campus === c ? "primary" : "secondary"}
                  size="sm"
                  aria-pressed={campus === c}
                  disabled={pending}
                  onClick={() => setCampus((prev) => (prev === c ? null : c))}
                  className="h-8 px-3 text-xs"
                >
                  {c}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">
            위치
            <RequiredMark />
          </span>
          <input
            name="location"
            type="text"
            required
            maxLength={200}
            placeholder="예: 학생회관 3층 카페"
            defaultValue={initialValues?.location}
            disabled={pending}
            className={FIELD_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">
            {DATE_LABEL[type]}
            <RequiredMark />
          </span>
          <input
            name="date"
            type="datetime-local"
            required
            defaultValue={initialValues?.dateValue ?? nowAsDateTimeLocalValue()}
            disabled={pending}
            className={FIELD_CLASS}
          />
        </label>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">
          사진 <span className="font-normal text-muted-foreground">(선택)</span>
        </h2>
        <ImageUploader
          existingImageUrl={initialValues?.imageUrl ?? null}
          disabled={pending}
          onFileSelected={setSelectedFile}
          onRemoveExisting={setRemoveExisting}
        />
      </section>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:self-start">
        {pending ? "저장 중..." : postId ? "수정하기" : "등록하기"}
      </Button>
    </form>
  );
}
