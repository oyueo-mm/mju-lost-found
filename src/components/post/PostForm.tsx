"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { CAMPUSES, CATEGORIES, DEFAULT_CAMPUS } from "@/lib/posts/schema";
import type { PostType } from "@/lib/posts/schema";
import { getLocationSuggestions } from "@/lib/posts/campusLocations";
import { uploadPostImage } from "@/lib/images/client";
import { MAX_IMAGES_PER_POST } from "@/lib/images/config";
import {
  formatPartialUploadFailureMessage,
  resolveFinalImageIds,
  selectNewImages,
  type GalleryItem,
} from "@/lib/images/galleryState";
import { PostImageManager } from "./PostImageManager";
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
  // Phase P-5: null means the poster marked this as unknown -- see
  // schema.prisma's own comment on LostPost.location/lostAt. Never an
  // empty string or a "미상" placeholder.
  location: string | null;
  campus: string;
  dateValue: string | null; // <input type="datetime-local"> value, or null if unknown
  // Phase 11-4D: replaces the old single `imageUrl` -- an existing post's
  // current PostImage rows, already ordered by displayOrder (index 0 is
  // primary) by getLostPost/getFoundPost. Empty array for a post with no
  // image, same as before (never a broken-image placeholder).
  images: { id: number; imageUrl: string }[];
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

// Phase H-5-3: in edit mode, only include a field in the PATCH body when it
// actually differs from the value the form was seeded with -- this is what
// lets the server's own EMBEDDING_INPUT_FIELDS.some(field => field in rest)
// check (src/lib/posts/aiService.ts's updateLostPost/updateFoundPost)
// actually skip re-embedding for an edit that didn't touch title/
// description/category/location, instead of always re-triggering it just
// because those keys were always present in the request body regardless of
// whether their values changed. In create mode (isEdit=false, no
// initialValues to compare against), every field is always included --
// exactly the existing behavior, unchanged. updateLostPostSchema/
// updateFoundPostSchema (createXPostSchema.partial()) already accept a
// partial body server-side, so omitting an unchanged field here needs no
// API/schema change.
function fieldIfChanged<T>(isEdit: boolean, key: string, current: T, initial: T | undefined) {
  if (!isEdit || initial === undefined || current !== initial) {
    return { [key]: current };
  }
  return {};
}

export function PostForm({ type, postId, initialValues }: PostFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Phase 11-4D: replaces selectedFile/removeExisting -- one ordered list
  // covering both the post's surviving existing images (edit mode) and any
  // new files picked in this session, array order == displayOrder, index 0
  // == primary. See src/lib/images/galleryState.ts's own comment for the
  // full design (why existing-image deletion is immediate but new-file
  // upload/attach/reorder are deferred to submit).
  const [items, setItems] = useState<GalleryItem[]>(
    () => initialValues?.images.map((img) => ({ kind: "existing" as const, id: img.id, url: img.imageUrl })) ?? [],
  );
  // Set only by the up/down reorder buttons -- lets applyImageChanges skip
  // the reorder API call entirely on the (very common) unmodified-order
  // submit, instead of unconditionally re-sending the current order every
  // time regardless of whether it changed.
  const [reordered, setReordered] = useState(false);
  // In-flight indicator for one existing image's own immediate DELETE
  // call -- PostImageManager disables just that item's controls while set,
  // not the whole gallery.
  const [deletingExistingId, setDeletingExistingId] = useState<number | null>(null);
  // Mirrors `items` for the unmount-cleanup effect further down, which
  // must read the *latest* items (not the empty array from this
  // component's very first render) without re-running on every items
  // change -- see that effect's own comment. Synced in its own effect
  // (never written during render -- React refs must only be read/written
  // from an effect or event handler, never render itself).
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // Phase G-2: set only once the post row itself is confirmed saved (right
  // before applyImageChanges runs) -- lets the error banner below offer a
  // concrete "다시 시도"/게시물로 이동 action instead of just prose, since at
  // that point the post already exists at a real id/url regardless of
  // whether the image step succeeds.
  const [savedPostId, setSavedPostId] = useState<number | null>(null);
  // Phase H-3: 위치 stays an uncontrolled native input (read via FormData
  // in handleSubmit, unchanged) -- this ref only lets a suggestion chip
  // write into it directly, the same way a user's own typing would,
  // without turning the field into controlled state just for this.
  const locationInputRef = useRef<HTMLInputElement>(null);
  // Phase I section 5: the popover this ref anchors replaces the old
  // always-visible chip row below the input -- see the "위치" label's own
  // comment further down for the full rationale.
  const locationMenuRef = useRef<HTMLDivElement>(null);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  // Phase 31: required, unlike the earlier decorative version of this
  // control -- always starts on a real value (the existing post's campus
  // in edit mode, DEFAULT_CAMPUS for a brand-new one), and the toggle
  // buttons below no longer allow deselecting back to "none".
  const [campus, setCampus] = useState<string>(initialValues?.campus ?? DEFAULT_CAMPUS);
  // Phase P-5: "미상" toggles -- initialized from whether the existing post
  // (edit mode) actually has a null location/date, never guessed from an
  // empty string. Create mode has no initialValues at all, so both default
  // to false (알고 있음), matching the form's pre-P-5 behavior exactly when
  // never touched.
  const [locationUnknown, setLocationUnknown] = useState(initialValues?.location === null);
  const [dateUnknown, setDateUnknown] = useState(initialValues?.dateValue === null);

  // Same outside-click-to-close mechanism PostManageMenu already
  // established (Phase H-6) -- plain useState + a document listener, no
  // new dependency, no setState-inside-useEffect for the open/close state
  // itself (only this cleanup-driven close does, which is the same
  // already-accepted pattern PostManageMenu uses).
  useEffect(() => {
    if (!locationMenuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (locationMenuRef.current && !locationMenuRef.current.contains(event.target as Node)) {
        setLocationMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [locationMenuOpen]);

  // Revokes every remaining "new" item's blob: preview URL on unmount --
  // reads itemsRef (kept in sync every render above) rather than `items`
  // itself, since a cleanup-only effect with `[]` deps must not re-run (and
  // so must not close over a stale, possibly-empty `items`) every time the
  // gallery changes; it only needs the *latest* value once, at the one
  // point it actually runs (true unmount).
  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        if (item.kind === "new") URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  function handleFilesSelected(files: File[]) {
    setError(null);
    const { accepted, rejectedForCount, validationError } = selectNewImages(files, items.length);

    if (accepted.length > 0) {
      setItems((prev) => [
        ...prev,
        ...accepted.map((file) => ({
          kind: "new" as const,
          localId: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ]);
    }

    if (rejectedForCount > 0) {
      setError(`최대 ${MAX_IMAGES_PER_POST}장까지 등록할 수 있어요. ${rejectedForCount}장은 추가되지 않았습니다.`);
    } else if (validationError) {
      setError(validationError);
    }
  }

  function handleRemoveNewImage(localId: string) {
    setItems((prev) => {
      const target = prev.find((item) => item.kind === "new" && item.localId === localId);
      if (target?.kind === "new") URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => !(item.kind === "new" && item.localId === localId));
    });
  }

  // Phase 11-4D section 9: an *existing* image's delete uses the real
  // per-image endpoint immediately (unlike a newly-picked file, which is
  // just removed from local preview state) -- this always has a real,
  // already-saved post to call it against, since existing items only ever
  // come from initialValues.images (edit mode). Never sends a bare DELETE
  // /api/posts/[id]/image (that clears every image the post has, not just
  // this one) -- `imageId` is what picks the individual-delete behavior
  // instead (see that route's own comment for why this is a query param
  // rather than a separate /images/[imageId] route -- the Hobby plan's
  // 12-Serverless-Function cap, hit by a real Preview deploy).
  async function handleDeleteExistingImage(imageId: number) {
    if (postId === undefined) return;
    setError(null);
    setDeletingExistingId(imageId);
    try {
      const res = await fetch(`/api/posts/${postId}/image?type=${type}&imageId=${imageId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "이미지를 삭제하지 못했습니다.");
        return;
      }
      setItems((prev) => prev.filter((item) => !(item.kind === "existing" && item.id === imageId)));
    } catch {
      setError("이미지를 삭제하지 못했습니다.");
    } finally {
      setDeletingExistingId(null);
    }
  }

  function handleMoveItem(index: number, direction: -1 | 1) {
    setItems((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setReordered(true);
  }

  // Phase 11-4D: runs the whole deferred image step against the
  // already-saved post -- uploads every not-yet-attached "new" item
  // (parallel, partial-failure-tolerant per this phase's own spec section
  // 11), attaches whichever of those succeeded in one batched call (the
  // Phase 11-4C `paths` shape), converts each newly-attached item to
  // "existing" in place (so a retry after a partial failure never
  // re-uploads an already-succeeded file), and finally -- only if the user
  // actually touched reorder -- persists the gallery's current order via
  // the reorder endpoint. Existing-image deletion already happened
  // immediately (handleDeleteExistingImage above), so there's nothing left
  // to do for those here.
  async function applyImageChanges(id: number): Promise<string | null> {
    const newItems = items.filter((item): item is Extract<GalleryItem, { kind: "new" }> => item.kind === "new");
    const attachedByLocalId = new Map<string, { id: number; imageUrl: string }>();
    let uploadFailedCount = 0;

    if (newItems.length > 0) {
      const uploadResults = await Promise.allSettled(
        newItems.map(async (item) => ({ localId: item.localId, ...(await uploadPostImage(type, id, item.file)) })),
      );

      const succeeded: { localId: string; path: string }[] = [];
      for (const result of uploadResults) {
        if (result.status === "fulfilled") succeeded.push(result.value);
        else uploadFailedCount++;
      }

      if (succeeded.length > 0) {
        try {
          const res = await fetch(`/api/posts/${id}/image?type=${type}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: succeeded.map((s) => s.path) }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            return json.error ?? "이미지를 게시물에 연결하지 못했습니다.";
          }
          const json = await res.json();
          const createdImages: { id: number; imageUrl: string }[] = json.data.images;
          succeeded.forEach((s, i) => attachedByLocalId.set(s.localId, createdImages[i]));
        } catch {
          return "이미지를 게시물에 연결하지 못했습니다.";
        }
      }

      setItems((prev) =>
        prev.map((item) => {
          if (item.kind !== "new") return item;
          const attached = attachedByLocalId.get(item.localId);
          if (!attached) return item;
          URL.revokeObjectURL(item.previewUrl);
          return { kind: "existing" as const, id: attached.id, url: attached.imageUrl };
        }),
      );
    }

    if (reordered) {
      const finalIds = resolveFinalImageIds(items, attachedByLocalId);
      if (finalIds.length >= 2) {
        try {
          // Same endpoint as attach/delete above -- see .../image/route.ts's
          // own comment for why reorder is PATCH here instead of a
          // separate /images route (the Hobby plan's 12-Serverless-Function
          // cap, hit by a real Preview deploy).
          const res = await fetch(`/api/posts/${id}/image?type=${type}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds: finalIds }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            return json.error ?? "이미지 순서를 저장하지 못했습니다.";
          }
        } catch {
          return "이미지 순서를 저장하지 못했습니다.";
        }
      }
      setReordered(false);
    }

    return formatPartialUploadFailureMessage(newItems.length, uploadFailedCount);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "");
    const description = String(formData.get("description") ?? "");
    const category = String(formData.get("category") ?? "");
    // Phase P-5: null (never an empty string or a "미상" placeholder) when
    // the poster toggled 위치/시간 미상 -- read from this component's own
    // toggle state, not from the (disabled, so browser-excluded anyway)
    // form field, so this is correct regardless of that native behavior.
    const location = locationUnknown ? null : String(formData.get("location") ?? "");
    const dateValue = dateUnknown ? null : String(formData.get("date") ?? "");

    const isEdit = postId !== undefined;
    const dateField = DATE_FIELD[type];

    const body = {
      type,
      ...fieldIfChanged(isEdit, "title", title, initialValues?.title),
      ...fieldIfChanged(isEdit, "description", description, initialValues?.description),
      ...fieldIfChanged(isEdit, "category", category, initialValues?.category),
      ...fieldIfChanged(isEdit, "location", location, initialValues?.location),
      // Not a form field (see the toggle-button group below, same reason
      // `type` itself is added directly rather than read from FormData) --
      // tracked in this component's own `campus` state instead.
      ...fieldIfChanged(isEdit, "campus", campus, initialValues?.campus),
      ...fieldIfChanged(isEdit, dateField, dateValue, initialValues?.dateValue),
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
      setSavedPostId(id);

      const imageError = await applyImageChanges(id);
      if (imageError) {
        // The post itself was already saved successfully -- only the
        // image step failed, so this isn't treated as a full failure.
        // savedPostId being set now is what makes the error banner below
        // render the "다시 시도"/게시물로 이동 actions instead of plain text.
        setError(imageError);
        setPending(false);
        return;
      }

      // Phase 11-2: `created=1` only on an actual creation (postId is the
      // component's own prop, undefined in create mode, set in edit mode)
      // -- see post/[id]/page.tsx's own comment on what this turns on
      // (the "게시글이 등록되었습니다" banner + PendingRecommendations
      // polling), both purely cosmetic and both skipped on an edit.
      router.push(`/post/${id}?type=${type}${postId === undefined ? "&created=1" : ""}`);
      router.refresh();
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setPending(false);
    }
  }

  // Phase G-2: re-runs just the image step against the already-saved post
  // (savedPostId), reusing whatever's still left in `items` -- no need to
  // resubmit title/description/etc, which are already saved. Phase 11-4D:
  // any "new" item that already got uploaded+attached on a previous attempt
  // was already converted to "existing" in place (see applyImageChanges),
  // so a retry only re-uploads the files that actually failed last time --
  // never a Storage object that's already sitting on the post. On success,
  // proceeds exactly like a normal submit (navigate to the post); on
  // failure, the same error banner + retry stays up so the user can try
  // again or leave via the link below without losing their place.
  async function handleRetryImage() {
    if (savedPostId === null) return;
    setPending(true);
    setError(null);

    const imageError = await applyImageChanges(savedPostId);
    if (imageError) {
      setError(imageError);
      setPending(false);
      return;
    }

    router.push(`/post/${savedPostId}?type=${type}${postId === undefined ? "&created=1" : ""}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error &&
        (savedPostId === null ? (
          <p className="rounded-card border border-destructive/30 bg-destructive-muted px-4 py-2.5 text-sm text-destructive">
            {error}
          </p>
        ) : (
          // Phase G-2: the post row itself is already saved at this point
          // (only the image step failed) -- this replaces the old
          // one-sentence-of-prose banner with the two things the user
          // actually needs: what to do right now (재시도, reusing the same
          // file already selected below) and where to go instead if they'd
          // rather not (게시물 페이지로 이동, where PostImageManager is
          // available again on the edit form).
          <div className="flex flex-col gap-2 rounded-card border border-destructive/30 bg-destructive-muted px-4 py-3 text-sm text-destructive">
            <p>게시물은 정상적으로 저장되었습니다. 다만 {error}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={handleRetryImage} disabled={pending}>
                {pending ? "다시 시도하는 중..." : "사진 다시 시도"}
              </Button>
              <Link href={`/post/${savedPostId}/edit?type=${type}`} className="text-sm font-medium underline">
                게시물 수정 페이지로 이동
              </Link>
            </div>
          </div>
        ))}

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
                control a native form field, `campus` is submitted directly
                from this component's own state (see handleSubmit) instead
                of via FormData. Each button still renders with a real
                "button" role, and aria-pressed reports which one is
                selected -- exactly one, always (no deselect-to-none), now
                that campus is required. */}
            <span className="font-medium text-foreground">
              캠퍼스
              <RequiredMark />
            </span>
            <div className="flex gap-1.5" role="group" aria-label="캠퍼스 선택">
              {CAMPUSES.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant={campus === c ? "primary" : "secondary"}
                  size="sm"
                  aria-pressed={campus === c}
                  disabled={pending}
                  onClick={() => setCampus(c)}
                  className="h-8 px-3 text-xs"
                >
                  {c}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              위치
              {!locationUnknown && <RequiredMark />}
            </span>
            {/* Phase P-5: a single toggle, not a two-button segmented
                group (unlike 캠퍼스 above) -- there's only one meaningful
                action from either state ("switch to the other one"), so
                one button whose own label names that action is enough;
                aria-pressed still reports which state is current for
                assistive tech. Toggling to 모름 disables/unrequires the
                input below and clears any popover open state, but never
                erases whatever the poster already typed -- switching back
                restores it exactly (the input itself is untouched, see
                defaultValue below). */}
            <button
              type="button"
              onClick={() => {
                setLocationUnknown((unknown) => !unknown);
                setLocationMenuOpen(false);
              }}
              aria-pressed={locationUnknown}
              disabled={pending}
              className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
            >
              {locationUnknown ? "위치를 알고 있어요" : "위치를 몰라요"}
            </button>
          </span>
          {/* Phase P-2: the popover now follows the `campus` toggle above
              (getLocationSuggestions(campus)) instead of always listing
              every campus's buildings under its own heading -- switching
              캠퍼스 immediately changes what this shows, since campus is
              plain React state read fresh on every render, no extra effect
              needed. Free-text entry is untouched: the input itself is
              unchanged (same name/required/maxLength/ref), so typing
              directly still works exactly as before whether or not the
              popover is ever opened, and an already-typed value is never
              cleared by a campus change. */}
          <div ref={locationMenuRef} className="relative flex gap-2">
            <input
              ref={locationInputRef}
              name="location"
              type="text"
              required={!locationUnknown}
              maxLength={200}
              placeholder={locationUnknown ? "위치 미상으로 등록돼요" : "예: 학생회관 3층 카페"}
              defaultValue={initialValues?.location ?? undefined}
              disabled={pending || locationUnknown}
              className={`${FIELD_CLASS} flex-1`}
            />
            <button
              type="button"
              disabled={pending || locationUnknown}
              onClick={() => setLocationMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={locationMenuOpen}
              aria-label={`${campus} 추천 장소 목록 열기`}
              className="shrink-0 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              추천 장소
            </button>

            {locationMenuOpen && (
              <div
                role="menu"
                className="absolute top-full right-0 z-10 mt-1 max-h-80 w-64 overflow-y-auto rounded-card border border-border bg-card p-3 shadow-lg"
              >
                <span className="mb-1.5 block text-xs font-semibold text-foreground">{campus}</span>
                <div className="flex flex-wrap gap-1.5">
                  {getLocationSuggestions(campus).map((place) => (
                    <button
                      key={place}
                      type="button"
                      onClick={() => {
                        if (locationInputRef.current) {
                          locationInputRef.current.value = place;
                          locationInputRef.current.focus();
                        }
                        setLocationMenuOpen(false);
                      }}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      {place}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {DATE_LABEL[type]}
              {!dateUnknown && <RequiredMark />}
            </span>
            {/* Phase P-5: same single-toggle pattern as 위치 above. */}
            <button
              type="button"
              onClick={() => setDateUnknown((unknown) => !unknown)}
              aria-pressed={dateUnknown}
              disabled={pending}
              className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-60"
            >
              {dateUnknown ? "시간을 알고 있어요" : "시간을 몰라요"}
            </button>
          </span>
          <input
            name="date"
            type="datetime-local"
            required={!dateUnknown}
            defaultValue={initialValues?.dateValue ?? nowAsDateTimeLocalValue()}
            disabled={pending || dateUnknown}
            className={FIELD_CLASS}
          />
        </label>
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">
          사진 <span className="font-normal text-muted-foreground">(선택)</span>
        </h2>
        <PostImageManager
          items={items}
          disabled={pending}
          deletingExistingId={deletingExistingId}
          onFilesSelected={handleFilesSelected}
          onRemoveNew={handleRemoveNewImage}
          onDeleteExisting={handleDeleteExistingImage}
          onMove={handleMoveItem}
        />
      </section>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:self-start">
        {pending ? "저장 중..." : postId ? "수정하기" : "등록하기"}
      </Button>
    </form>
  );
}
