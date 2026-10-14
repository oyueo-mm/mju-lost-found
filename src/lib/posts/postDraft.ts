// 게시글 임시저장 (등록 폼만). Kept in this browser's localStorage, per
// account and per board, so it survives a refresh or leaving the page.
//
// Shared-PC safety: a draft is tied to the signed-in account id (another
// account on the same browser never sees it), expires after DRAFT_TTL_MS,
// and every draft is removed when the browser is next seen signed out or
// signed in as someone else (see DraftJanitor). Photos are never stored --
// they are large and can carry personal details; only how many there were,
// so the form can say they need picking again. Every storage access is
// wrapped: a private window or a full quota just means "no draft".

export const DRAFT_PREFIX = "mju-find:post-draft:v1:";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type DraftBoard = "lost" | "found";

export type PostDraft = {
  savedAt: number;
  title: string;
  description: string;
  categoryCode: string | null;
  subcategory: string | null;
  campus: string;
  location: string;
  locationUnknown: boolean;
  date: string;
  time: string;
  dateUnknown: boolean;
  exactTime: boolean;
  organizationId: number | null;
  photoCount: number;
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function draftKey(userId: number, board: DraftBoard): string {
  return `${DRAFT_PREFIX}${userId}:${board}`;
}

// Only something worth coming back for is kept: the toggles and defaults
// alone are not a draft.
export function hasDraftContent(draft: Omit<PostDraft, "savedAt">): boolean {
  return draft.title.trim() !== "" || draft.description.trim() !== "" || (!draft.locationUnknown && draft.location.trim() !== "");
}

const isString = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function parseDraft(raw: string | null): PostDraft | null {
  if (!raw) return null;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const ok =
    typeof d.savedAt === "number" &&
    [d.title, d.description, d.campus, d.location, d.date, d.time].every(isString) &&
    [d.locationUnknown, d.dateUnknown, d.exactTime].every(isBool) &&
    (d.categoryCode === null || isString(d.categoryCode)) &&
    (d.subcategory === null || isString(d.subcategory)) &&
    (d.organizationId === null || typeof d.organizationId === "number") &&
    typeof d.photoCount === "number";
  return ok ? (d as PostDraft) : null;
}

export function readDraft(storage: DraftStorage | null, key: string, now = Date.now()): PostDraft | null {
  if (!storage) return null;
  try {
    const draft = parseDraft(storage.getItem(key));
    if (!draft || now - draft.savedAt > DRAFT_TTL_MS || now < draft.savedAt - 60_000) {
      storage.removeItem(key);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

// Writes the draft, or removes it when there is nothing worth keeping.
// Returns whether a draft is now stored.
export function writeDraft(storage: DraftStorage | null, key: string, draft: PostDraft): boolean {
  if (!storage) return false;
  try {
    if (!hasDraftContent(draft)) {
      storage.removeItem(key);
      return false;
    }
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage: DraftStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing else to do: storage is unavailable.
  }
}

// Removes every draft except those of `keepUserId` (none when signed out),
// and any of that account's drafts that have expired.
export function sweepDrafts(storage: DraftStorage | null, keepUserId: number | null, now = Date.now()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const owner = Number(key.slice(DRAFT_PREFIX.length).split(":")[0]);
      if (keepUserId === null || owner !== keepUserId) storage.removeItem(key);
      else readDraft(storage, key, now); // drops it if expired or malformed
    }
  } catch {
    // Storage unavailable -- nothing stored to sweep.
  }
}

export function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
