// Phase 11-4D: pure, framework-free helpers for PostForm's multi-image
// gallery state -- pulled out of the component itself so the actual
// decision logic (max-5 enforcement, partial-upload-failure wording, final
// display-order resolution) is unit-testable under Vitest's plain Node
// environment. This project has no jsdom/@testing-library (checked before
// this phase started), so anything that needs real DOM/React rendering
// stays untested here and is verified by hand/Playwright instead -- see
// this phase's own final report.
import { validateImageFile } from "./client";
import { MAX_IMAGES_PER_POST } from "./config";

// The gallery's one ordered list -- array order IS displayOrder, index 0 IS
// the primary image. `existing` entries are PostImage rows the post already
// had (edit mode only; deleting one calls DELETE /api/posts/[id]/images/
// [imageId] immediately and removes it from this list -- see PostForm's own
// handleDeleteExistingImage). `new` entries are files picked in this
// editing session that haven't been uploaded/attached yet.
export type GalleryItem =
  | { kind: "existing"; id: number; url: string }
  | { kind: "new"; localId: string; file: File; previewUrl: string };

export type SelectNewImagesResult = {
  accepted: File[];
  rejectedForCount: number;
  // Only the first validation failure's message -- same "one message at a
  // time" UX validateImageFile's own single caller (ImageUploader, before
  // this phase) already used.
  validationError: string | null;
};

// Applied when the user picks one or more files to add to the gallery.
// Files beyond the post's remaining slots (MAX_IMAGES_PER_POST minus
// however many the gallery already holds) are rejected for count, checked
// *before* per-file validation so a mixed batch (some invalid, some just
// over the limit) always reports the count rejection first -- consistent
// with this phase's own spec framing ("현재 4장 + 2장 선택 -> 6장 -> 5장
// 초과 안내"). This is UX-only: the server re-enforces MAX_IMAGES_PER_POST
// itself against a fresh DB count regardless (see attachPostImages).
export function selectNewImages(
  files: File[],
  currentCount: number,
  maxCount: number = MAX_IMAGES_PER_POST,
): SelectNewImagesResult {
  const remainingSlots = Math.max(0, maxCount - currentCount);
  const accepted: File[] = [];
  let rejectedForCount = 0;
  let validationError: string | null = null;

  for (const file of files) {
    if (accepted.length >= remainingSlots) {
      rejectedForCount++;
      continue;
    }
    const error = validateImageFile(file);
    if (error) {
      validationError ??= error.message;
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejectedForCount, validationError };
}

// "5장 중 3장 업로드 완료. 2장은 업로드하지 못했습니다." -- null when nothing
// failed (the success case needs no banner at all).
export function formatPartialUploadFailureMessage(total: number, failedCount: number): string | null {
  if (failedCount <= 0) return null;
  const succeeded = total - failedCount;
  return `${total}장 중 ${succeeded}장 업로드 완료. ${failedCount}장은 업로드하지 못했습니다.`;
}

// The gallery's final, real (server-known) image ids in display order --
// existing items already have one; a "new" item only has one once its
// upload+attach succeeded (looked up by `attachedByLocalId`, keyed by the
// item's own localId). A "new" item that never got attached (upload
// failed, or wasn't part of this submit's batch) is silently dropped from
// the result -- it isn't a real PostImage row, so it can't be part of an
// order list naming one.
export function resolveFinalImageIds(
  items: GalleryItem[],
  attachedByLocalId: ReadonlyMap<string, { id: number }>,
): number[] {
  const ids: number[] = [];
  for (const item of items) {
    if (item.kind === "existing") {
      ids.push(item.id);
    } else {
      const attached = attachedByLocalId.get(item.localId);
      if (attached) ids.push(attached.id);
    }
  }
  return ids;
}
