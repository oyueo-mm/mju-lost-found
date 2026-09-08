"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import { createAnnouncement, deleteAnnouncement, updateAnnouncement } from "@/lib/announcement/service";
import { createAnnouncementSchema, updateAnnouncementSchema } from "@/lib/announcement/schema";

export type AnnouncementActionState = { error: string } | { ok: true };

// requireAdmin() re-verifies both "logged in" and "DB-flagged admin" from a
// fresh session read on every call -- same gate every other admin Server
// Action in this app uses (see /admin/sanctions/actions.ts's own comment),
// never trusts anything client-side about who's calling this. A non-admin
// (or logged-out) caller is redirected before any of the input below is
// even parsed.

export async function createAnnouncementAction(input: {
  title: string;
  content: string;
}): Promise<AnnouncementActionState> {
  const admin = await requireAdmin();

  const parsed = createAnnouncementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await createAnnouncement(admin, parsed.data);
  if (result.kind !== "ok") return { error: "공지사항을 등록하지 못했습니다." };

  revalidatePath("/admin/announcements");
  return { ok: true };
}

export async function updateAnnouncementAction(
  id: number,
  input: { title: string; content: string },
): Promise<AnnouncementActionState> {
  const admin = await requireAdmin();

  const parsed = updateAnnouncementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const result = await updateAnnouncement(admin, id, parsed.data);
  if (result.kind === "not_found") return { error: "공지사항을 찾을 수 없습니다." };
  if (result.kind !== "ok") return { error: "공지사항을 수정하지 못했습니다." };

  revalidatePath("/admin/announcements");
  // The public detail page a notification links to (see resolveHref.ts) --
  // revalidated too, so an edit shows up there immediately, not just in
  // the admin list.
  revalidatePath(`/announcements/${id}`);
  return { ok: true };
}

export async function deleteAnnouncementAction(id: number): Promise<AnnouncementActionState> {
  const admin = await requireAdmin();

  const result = await deleteAnnouncement(admin, id);
  if (result.kind === "not_found") return { error: "공지사항을 찾을 수 없습니다." };
  if (result.kind !== "ok") return { error: "공지사항을 삭제하지 못했습니다." };

  revalidatePath("/admin/announcements");
  return { ok: true };
}
