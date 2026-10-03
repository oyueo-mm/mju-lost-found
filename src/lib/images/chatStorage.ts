import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";

import { CHAT_IMAGES_BUCKET, CHAT_IMAGE_URL_TTL_SECONDS } from "./config";
import { parseChatImagePathname } from "./pathname";

// Server-only access to the private chat-images bucket (service role). The
// app never builds a public URL for a chat image: callers pass the object
// path that Message.imagePath stores, and only paths shaped like
// chat/{roomId}/{uuid}.{ext} (parseChatImagePathname) are ever touched.

function bucket() {
  return getSupabaseAdminClient().storage.from(CHAT_IMAGES_BUCKET);
}

export async function createChatImageUploadUrl(path: string): Promise<{ path: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Failed to create chat image upload URL: ${error?.message ?? "unknown error"}`);
  return { path: data.path, token: data.token };
}

// True only if the object was actually uploaded -- sendMessage() refuses an
// imagePath that doesn't exist, so a message never points at nothing.
export async function chatImageExists(path: string): Promise<boolean> {
  const { data, error } = await bucket().exists(path);
  if (error) return false;
  return data;
}

// A signed URL valid for CHAT_IMAGE_URL_TTL_SECONDS. Only call after the
// viewer's access to the message's room has been checked
// (chat/service.ts::getChatImageForViewer).
export async function createChatImageSignedUrl(path: string): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(path, CHAT_IMAGE_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`Failed to sign chat image URL: ${error?.message ?? "unknown error"}`);
  return data.signedUrl;
}

// Best-effort, never rejects: runs after the DB change has committed (from
// after()), so a Storage failure is only logged and can be found later by
// scripts/reportChatImageOrphans.ts. Deletes exactly the one path given.
export async function deleteChatImageSafely(path: string): Promise<void> {
  if (!parseChatImagePathname(path)) {
    console.error("Refusing to delete: not a chat image path", path);
    return;
  }
  try {
    const { error } = await bucket().remove([path]);
    if (error) throw error;
  } catch (error) {
    console.error("Failed to delete chat image:", path, error);
  }
}
