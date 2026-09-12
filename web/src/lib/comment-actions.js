"use server";

import { revalidatePath } from "next/cache";
import { requireUser, isSuspended, SUSPENDED_MSG } from "@/lib/auth";
import { rateLimited } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { KIND_CONFIG } from "@/lib/constants";

export async function addComment(postType, postId, _prev, formData) {
  const cfg = KIND_CONFIG[postType];
  if (!cfg) return { error: "잘못된 요청이에요." };

  const content = (formData.get("content") || "").toString().trim();
  if (!content) return { error: "내용을 입력해 주세요." };
  if (content.length > 500) return { error: "댓글은 500자 이하로 써주세요." };

  const { user, profile, supabase } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };
  const limited = await rateLimited(user.id, "comment");
  if (limited) return { error: limited };

  const { error } = await supabase.from("comments").insert({
    post_type: postType,
    post_id: Number(postId),
    user_id: user.id,
    content,
  });
  if (error) return { error: "댓글 등록에 실패했어요." };

  // 게시글 작성자에게 알림 (본인 글이면 생략)
  try {
    const admin = createAdminClient();
    const { data: post } = await admin
      .from(cfg.table)
      .select("user_id, title")
      .eq("id", postId)
      .maybeSingle();
    if (post && post.user_id !== user.id) {
      await createNotification(
        post.user_id,
        "comment",
        "내 게시글에 댓글이 달렸어요",
        `${profile.nickname}: ${content.slice(0, 40)}`,
        `/${postType}/${postId}`,
      );
    }
  } catch {
    /* noop */
  }

  revalidatePath(`/${postType}/${postId}`);
  return { ok: true };
}

export async function deleteComment(commentId, postType, postId) {
  const { user, supabase } = await requireUser();
  await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)
    .eq("user_id", user.id);
  revalidatePath(`/${postType}/${postId}`);
}
