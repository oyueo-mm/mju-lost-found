"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser, isSuspended, SUSPENDED_MSG } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { KIND_CONFIG } from "@/lib/constants";
import { createNotification } from "@/lib/notifications";
import { rateLimited } from "@/lib/ratelimit";
import { sniffImage } from "@/lib/image-sniff";

async function getOrCreateRoom({ me, other, lostPostId, foundPostId, title }) {
  const admin = createAdminClient();
  const [user_a, user_b] = [me, other].sort();

  let query = admin
    .from("chat_rooms")
    .select("id")
    .eq("user_a", user_a)
    .eq("user_b", user_b);
  query = lostPostId
    ? query.eq("lost_post_id", lostPostId)
    : query.is("lost_post_id", null);
  query = foundPostId
    ? query.eq("found_post_id", foundPostId)
    : query.is("found_post_id", null);

  const { data: existing } = await query.maybeSingle();
  if (existing) return { id: existing.id, created: false };

  const { data, error } = await admin
    .from("chat_rooms")
    .insert({
      user_a,
      user_b,
      lost_post_id: lostPostId || null,
      found_post_id: foundPostId || null,
      context_title: title || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, created: true };
}

// 게시글 작성자에게 바로 채팅 걸기
export async function openDirectChat(postKind, postId) {
  const cfg = KIND_CONFIG[postKind];
  if (!cfg) throw new Error("bad kind");
  const { user, profile } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };
  const limited = await rateLimited(user.id, "chat_open");
  if (limited) return { error: limited };
  const admin = createAdminClient();

  const { data: post } = await admin
    .from(cfg.table)
    .select("id, user_id, title")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "게시글을 찾을 수 없어요." };
  if (post.user_id === user.id)
    return { error: "본인 게시글에는 채팅할 수 없어요." };

  const room = await getOrCreateRoom({
    me: user.id,
    other: post.user_id,
    lostPostId: postKind === "lost" ? post.id : null,
    foundPostId: postKind === "found" ? post.id : null,
    title: post.title,
  });

  if (room.created) {
    await createNotification(
      post.user_id,
      "chat",
      "새 채팅 요청",
      `${profile.nickname}님이 “${post.title}” 관련 대화를 시작했어요.`,
      `/chat/${room.id}`,
    );
  }
  redirect(`/chat/${room.id}`);
}

const CHAT_IMAGE_MAX = 5 * 1024 * 1024;

async function uploadChatImage(file, userId) {
  if (file.size > CHAT_IMAGE_MAX) {
    throw new Error("이미지는 5MB 이하만 보낼 수 있어요.");
  }
  const kind = await sniffImage(file);
  if (!kind) throw new Error("JPG, PNG, WEBP 이미지만 보낼 수 있어요.");
  const path = `chat/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${kind.ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("post-images")
    .upload(path, file, { contentType: kind.type });
  if (error) throw new Error("이미지 업로드에 실패했어요.");
  return admin.storage.from("post-images").getPublicUrl(path).data.publicUrl;
}

export async function sendMessage(roomId, _prev, formData) {
  const content = (formData.get("content") || "").toString().trim();
  const imageFile = formData.get("image");
  const hasImage =
    imageFile && typeof imageFile !== "string" && imageFile.size > 0;

  if (!content && !hasImage) return { error: "메시지를 입력해 주세요." };
  if (content.length > 1000) return { error: "메시지가 너무 길어요." };

  const { user, profile, supabase } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };
  const limited = await rateLimited(user.id, "chat");
  if (limited) return { error: limited };

  let imageUrl = null;
  if (hasImage) {
    try {
      imageUrl = await uploadChatImage(imageFile, user.id);
    } catch (e) {
      return { error: e.message || "이미지 업로드에 실패했어요." };
    }
  }

  // 방 조회 + 메시지 삽입만 대기 (가장 빠른 경로)
  const [{ data: room }, { data: inserted, error }] = await Promise.all([
    supabase
      .from("chat_rooms")
      .select("id, user_a, user_b")
      .eq("id", roomId)
      .maybeSingle(),
    supabase
      .from("messages")
      .insert({
        room_id: roomId,
        sender_id: user.id,
        content,
        image_url: imageUrl,
      })
      .select("id, sender_id, content, image_url, created_at, read_at")
      .single(),
  ]);
  if (!room) return { error: "채팅방을 찾을 수 없어요." };
  if (error) return { error: "전송에 실패했어요." };

  // 목록 갱신은 응답 후 백그라운드로.
  // 메시지 알림은 채팅 안읽음 뱃지(unreadMessageCount)가 담당하므로
  // 알림 벨(notifications)에는 쌓지 않는다.
  after(async () => {
    try {
      const admin = createAdminClient();
      await admin
        .from("chat_rooms")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", roomId);
      revalidatePath("/chat");
    } catch {
      /* noop */
    }
  });

  return { ok: true, message: inserted };
}

const ALLOWED_EMOJI = ["👍", "❤️", "😂", "😮", "😢"];

// 이모지 반응 토글 (있으면 제거, 없으면 추가)
export async function toggleReaction(messageId, emoji) {
  if (!ALLOWED_EMOJI.includes(emoji)) return { error: "지원하지 않는 이모지예요." };
  const { user, supabase } = await requireUser();

  const { data: existing } = await supabase
    .from("message_reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    await supabase.from("message_reactions").delete().eq("id", existing.id);
  } else {
    await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, user_id: user.id, emoji });
  }
  return { ok: true };
}

// 메시지 신고
export async function reportMessage(messageId, reason) {
  const { user, profile, supabase } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };
  const limited = await rateLimited(user.id, "report");
  if (limited) return { error: limited };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: "message",
    target_id: String(messageId),
    reason: reason || "부적절한 메시지",
  });
  if (error) {
    if (error.code === "23505") return { error: "이미 신고한 메시지예요." };
    return { error: "신고 접수에 실패했어요." };
  }
  return { ok: true };
}

// 거래 완료 동의 (양측 동의 시 양쪽 명지도 +5%p)
export async function confirmDeal(roomId) {
  const { user, profile, supabase } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };

  const { data, error } = await supabase.rpc("confirm_deal", {
    p_room_id: roomId,
  });
  if (error) return { error: "처리에 실패했어요." };
  if (data?.error) return { error: data.error };

  after(async () => {
    try {
      const admin = createAdminClient();
      const { data: room } = await admin
        .from("chat_rooms")
        .select("user_a, user_b, lost_post_id, found_post_id")
        .eq("id", roomId)
        .maybeSingle();
      if (!room) return;
      const other = room.user_a === user.id ? room.user_b : room.user_a;

      if (data.completed && !data.already) {
        // 연결된 게시물을 완료 처리 → 목록·검색에서 내려감
        if (room.lost_post_id) {
          await admin
            .from("lost_posts")
            .update({ status: "찾음", updated_at: new Date().toISOString() })
            .eq("id", room.lost_post_id)
            .eq("status", "찾는 중");
        }
        if (room.found_post_id) {
          await admin
            .from("found_posts")
            .update({ status: "완료", updated_at: new Date().toISOString() })
            .eq("id", room.found_post_id)
            .eq("status", "보관 중");
        }
        for (const uid of [user.id, other]) {
          await createNotification(
            uid,
            "deal",
            "거래 완료",
            `명지도가 +${data.award}%p 올랐어요.`,
            `/chat/${roomId}`,
          );
        }
      } else if (!data.completed) {
        await createNotification(
          other,
          "deal",
          "거래 완료 확인 요청",
          `${profile.nickname}님이 거래 완료를 눌렀어요. 확인해 주세요.`,
          `/chat/${roomId}`,
        );
      }
      revalidatePath(`/chat/${roomId}`);
      revalidatePath("/my");
      revalidatePath("/");
    } catch {
      /* noop */
    }
  });

  return { ok: true, ...data };
}

// 채팅방 삭제 — 참여자면 누구나. 메시지·반응까지 cascade 로 함께 삭제됨.
export async function deleteRoom(roomId) {
  const { user } = await requireUser();
  const admin = createAdminClient();

  const { data: room } = await admin
    .from("chat_rooms")
    .select("user_a, user_b")
    .eq("id", roomId)
    .maybeSingle();
  if (!room) return { error: "채팅방을 찾을 수 없어요." };
  if (room.user_a !== user.id && room.user_b !== user.id) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin.from("chat_rooms").delete().eq("id", roomId);
  if (error) return { error: "삭제에 실패했어요." };

  revalidatePath("/chat");
  return { ok: true };
}

// 이전 메시지 더 불러오기 — RLS 로 참여자만 읽힌다 (user 클라이언트)
export async function loadOlderMessages(roomId, beforeIso) {
  const { supabase } = await requireUser();
  if (!/^\d{1,15}$/.test(String(roomId))) return { messages: [], hasMore: false };
  const before = new Date(beforeIso);
  if (Number.isNaN(before.getTime())) return { messages: [], hasMore: false };
  const { listMessages } = await import("@/lib/chat");
  return listMessages(supabase, roomId, { before: before.toISOString() });
}

export async function markRoomRead(roomId) {
  const { user, supabase } = await requireUser();
  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .neq("sender_id", user.id)
    .is("read_at", null);
  revalidatePath("/chat");
}
