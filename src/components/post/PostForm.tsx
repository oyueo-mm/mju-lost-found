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
import { PostAsSelector } from "@/components/organization/PostAsSelector";
import { useI18n } from "@/lib/i18n/client";
import { campusLabelKey, categoryLabelKey } from "@/lib/i18n/labels";
import type { TranslationKey } from "@/lib/i18n/translate";

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
  // Phase 12-7 §4: null for a personal post -- the post's current
  // attribution, only ever read in edit mode to seed the 게시 주체
  // selector's initial value.
  organizationId: number | null;
  // Only meaningful alongside organizationId -- lets the selector show the
  // post's *current* organization even if the editor is no longer an
  // ACTIVE member of it (so myOrganizations, fetched fresh, wouldn't
  // otherwise include it as a selectable option).
  organizationName: string | null;
};

type PostFormProps = {
  type: PostType;
  postId?: number; // present in edit mode
  initialValues?: PostFormValues;
  // Phase 12-5 §13/§14, Phase 12-7 §4: the current user's own
  // ACTIVE-organization memberships, fetched server-side (see lost/new,
  // found/new, post/[id]/edit page.tsx) -- never built from client state.
  // Passed in both create and edit mode now (Phase 12-7 reverses Phase
  // 12-5's "fixed at creation" policy) -- edit mode also lets the poster
  // move a post between 개인/단체 A/단체 B.
  myOrganizations?: { organizationId: number; organizationName: string }[];
};

const DATE_FIELD = { lost: "lostAt", found: "foundAt" } as const;
// 다국어(i18n) Phase: 폼이 서버로 보내는 필드 이름(DATE_FIELD)은 그대로
// 두고, 사람이 읽는 라벨/placeholder만 번역 키로 바꿨다.
const DATE_LABEL_KEY: Record<PostType, TranslationKey> = { lost: "post.lostAt", found: "post.foundAt" };
const TITLE_PLACEHOLDER_KEY: Record<PostType, TranslationKey> = {
  lost: "form.lost.titlePlaceholder",
  found: "form.found.titlePlaceholder",
};
const DESCRIPTION_PLACEHOLDER_KEY: Record<PostType, TranslationKey> = {
  lost: "form.lost.descriptionPlaceholder",
  found: "form.found.descriptionPlaceholder",
};

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

export function PostForm({ type, postId, initialValues, myOrganizations = [] }: PostFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Phase 12-5 §13: "개인" (null) or one of myOrganizations's ids -- only
  // ever read in create mode (see handleSubmit below, gated on !isEdit),
  // so this has no effect on an edit submission regardless of its value.
  const [organizationId, setOrganizationId] = useState<number | null>(initialValues?.organizationId ?? null);
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
  // 다국어(i18n) Phase: 폼이 실제로 제출하는 값은 항상 위 `campus` 원문
  // (DB/zod가 아는 한국어 문자열)이고, 이 키는 화면에 보여줄 라벨을
  // 고를 때만 쓴다.
  const campusKey = campusLabelKey(campus);
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
      setError(t("form.imageLimit", { max: MAX_IMAGES_PER_POST, rejected: rejectedForCount }));
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
        setError(json.error ?? t("form.imageDeleteFailed"));
        return;
      }
      setItems((prev) => prev.filter((item) => !(item.kind === "existing" && item.id === imageId)));
    } catch {
      setError(t("form.imageDeleteFailed"));
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
            return json.error ?? t("form.imageAttachFailed");
          }
          const json = await res.json();
          const createdImages: { id: number; imageUrl: string }[] = json.data.images;
          succeeded.forEach((s, i) => attachedByLocalId.set(s.localId, createdImages[i]));
        } catch {
          return t("form.imageAttachFailed");
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
            return json.error ?? t("form.imageOrderFailed");
          }
        } catch {
          return t("form.imageOrderFailed");
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
      // Phase 12-7 §4: now genuinely editable -- same fieldIfChanged
      // pattern as every other field above, so an edit that didn't touch
      // 게시 주체 omits organizationId entirely (server-side: "leave
      // attribution unchanged", see updateLostPost/updateFoundPost's own
      // comment) rather than re-validating membership on every unrelated
      // edit.
      ...fieldIfChanged(isEdit, "organizationId", organizationId, initialValues?.organizationId),
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
        setError(json.error ?? t("form.requestFailed"));
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
      setError(t("common.networkError"));
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
            <p>{t("form.savedButImageFailed", { error })}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={handleRetryImage} disabled={pending}>
                {pending ? t("form.retrying") : t("form.retryPhotos")}
              </Button>
              <Link href={`/post/${savedPostId}/edit?type=${type}`} className="text-sm font-medium underline">
                {t("form.goToEdit")}
              </Link>
            </div>
          </div>
        ))}

      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">{t("form.basicInfo")}</h2>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">
            {t("form.title")}
            <RequiredMark />
          </span>
          <input
            name="title"
            type="text"
            required
            maxLength={200}
            placeholder={t(TITLE_PLACEHOLDER_KEY[type])}
            defaultValue={initialValues?.title}
            disabled={pending}
            className={FIELD_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">
            {t("form.description")}
            <RequiredMark />
          </span>
          <textarea
            name="description"
            required
            rows={5}
            maxLength={5000}
            placeholder={t(DESCRIPTION_PLACEHOLDER_KEY[type])}
            defaultValue={initialValues?.description}
            disabled={pending}
            className={FIELD_CLASS}
          />
        </label>

        {/* LOST112 연계 Phase §8: 습득물 작성 화면 전용 -- 필수 입력 필드나
            별도 인증 절차를 추가하지 않고, 설명란 바로 아래에 순수 안내
            문구만 덧붙인다. 새로운 "비공개 사진"/"소유권 인증" 기능은
            없다 -- 습득자가 스스로 어떤 특징을 설명에서 빼둘지 판단하도록
            돕는 텍스트일 뿐이다. */}
        {type === "found" && (
          <p className="rounded-lg bg-primary-muted px-3.5 py-3 text-xs text-primary">
            {t("form.foundNotice")}
          </p>
        )}
      </section>

      {/* Phase 12-8 §1: 개인/단체 토글 + (단체 선택 시) 대표 단체 드롭다운 --
          shown in both create and edit mode (Phase 12-7 already allows
          editing 게시 주체; this phase only changes the selector's shape).
          A user with no ACTIVE-organization membership (and, in edit
          mode, whose post isn't currently attributed to some other
          organization) sees nothing new here -- PostAsSelector itself
          renders null in that case. */}
      {(myOrganizations.length > 0 || initialValues?.organizationId != null) && (
        <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">{t("form.attribution")}</h2>
          <PostAsSelector
            organizations={myOrganizations}
            value={organizationId}
            onChange={setOrganizationId}
            disabled={pending}
            currentOrganizationIfUnlisted={
              initialValues?.organizationId != null
                ? { organizationId: initialValues.organizationId, organizationName: initialValues.organizationName ?? t("form.unknownOrganization") }
                : null
            }
          />
        </section>
      )}

      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">{t("form.classification")}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-foreground">
              {t("form.category")}
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
              {CATEGORIES.map((c) => {
                const key = categoryLabelKey(c);
                return (
                  <option key={c} value={c}>
                    {key ? t(key) : c}
                  </option>
                );
              })}
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
              {t("form.campus")}
              <RequiredMark />
            </span>
            <div className="flex gap-1.5" role="group" aria-label={t("form.campusSelect")}>
              {CAMPUSES.map((c) => {
                const key = campusLabelKey(c);
                return (
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
                    {key ? t(key) : c}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {t("form.location")}
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
              {locationUnknown ? t("form.locationKnown") : t("form.locationUnknown")}
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
              placeholder={locationUnknown ? t("form.locationUnknownPlaceholder") : t("form.locationPlaceholder")}
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
              aria-label={t("form.suggestedPlacesOpen", { campus: campusKey ? t(campusKey) : campus })}
              className="shrink-0 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              {t("form.suggestedPlaces")}
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
              {t(DATE_LABEL_KEY[type])}
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
              {dateUnknown ? t("form.timeKnown") : t("form.timeUnknown")}
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
          {t("form.photos")} <span className="font-normal text-muted-foreground">{t("form.photosOptional")}</span>
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
        {pending ? t("form.saving") : postId ? t("form.update") : t("form.create")}
      </Button>
    </form>
  );
}
