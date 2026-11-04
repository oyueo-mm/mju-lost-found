"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { completeFromChat, type CompleteFromChatResult } from "@/lib/posts/returns";
import { hideThankNote, sendThankNote, setThankNotePublished, type PublishResult, type SendThankResult } from "@/lib/thanks/service";

// 감사 쪽지 and 채팅방 찾음 완료. The acting account is always the session's
// (requireUser); the client names only the post or the room and the text --
// never a sender, a receiver or a return partner.

export async function sendThankNoteAction(input: { postType: string; postId: number; body: string; tags?: string[] }): Promise<SendThankResult> {
  const user = await requireUser();
  if ((input.postType !== "lost" && input.postType !== "found") || !Number.isInteger(input.postId)) return { ok: false, error: "not_eligible" };
  const result = await sendThankNote(user.id, { postType: input.postType, postId: input.postId, body: input.body, tags: input.tags });
  if (result.ok) revalidatePath(`/post/${input.postId}`);
  return result;
}

export async function setThankNotePublishedAction(noteId: number, published: boolean): Promise<PublishResult> {
  const user = await requireUser();
  if (!Number.isInteger(noteId)) return { ok: false, reason: "not_found" };
  const result = await setThankNotePublished(user.id, noteId, published === true);
  if (result.ok) revalidatePath("/me/thanks");
  return result;
}

export async function hideThankNoteAction(noteId: number): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!Number.isInteger(noteId)) return { ok: false };
  const ok = await hideThankNote(user.id, noteId);
  if (ok) revalidatePath("/me/thanks");
  return { ok };
}

export async function completeFromChatAction(chatRoomId: number): Promise<CompleteFromChatResult["kind"]> {
  const user = await requireUser();
  if (!Number.isInteger(chatRoomId)) return "not_found";
  const result = await completeFromChat(user, chatRoomId);
  if (result.kind === "ok") revalidatePath(`/chat/${chatRoomId}`);
  return result.kind;
}
