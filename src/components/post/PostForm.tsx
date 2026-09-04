"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { PostType } from "@/lib/posts/schema";
import { uploadPostImage } from "@/lib/images/client";
import { ImageUploader } from "./ImageUploader";

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

export function PostForm({ type, postId, initialValues }: PostFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        제목
        <input
          name="title"
          type="text"
          required
          maxLength={200}
          defaultValue={initialValues?.title}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        설명
        <textarea
          name="description"
          required
          rows={5}
          maxLength={5000}
          defaultValue={initialValues?.description}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          카테고리
          <input
            name="category"
            type="text"
            required
            maxLength={100}
            defaultValue={initialValues?.category}
            disabled={pending}
            className="rounded-md border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          위치
          <input
            name="location"
            type="text"
            required
            maxLength={200}
            defaultValue={initialValues?.location}
            disabled={pending}
            className="rounded-md border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        {DATE_LABEL[type]}
        <input
          name="date"
          type="datetime-local"
          required
          defaultValue={initialValues?.dateValue}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-3 py-2 disabled:opacity-60 dark:border-zinc-700 dark:bg-transparent"
        />
      </label>

      <ImageUploader
        existingImageUrl={initialValues?.imageUrl ?? null}
        disabled={pending}
        onFileSelected={setSelectedFile}
        onRemoveExisting={setRemoveExisting}
      />

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {pending ? "저장 중..." : postId ? "수정하기" : "등록하기"}
      </button>
    </form>
  );
}
