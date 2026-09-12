"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, isSuspended, SUSPENDED_MSG } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";

// AI 매칭 후보를 "확정" — matches 테이블에 기록.
// lost/found 중 한쪽이라도 본인 게시글이어야 한다.
export async function confirmMatch(lostPostId, foundPostId, score) {
  const { user, profile } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };
  const admin = createAdminClient();

  const [{ data: lost }, { data: found }] = await Promise.all([
    admin.from("lost_posts").select("id, user_id").eq("id", lostPostId).maybeSingle(),
    admin.from("found_posts").select("id, user_id").eq("id", foundPostId).maybeSingle(),
  ]);
  if (!lost || !found) return { error: "게시글을 찾을 수 없어요." };
  if (lost.user_id !== user.id && found.user_id !== user.id) {
    return { error: "내 게시글에 대해서만 매칭을 확정할 수 있어요." };
  }

  const { data: existing } = await admin
    .from("matches")
    .select("id")
    .eq("lost_post_id", lostPostId)
    .eq("found_post_id", foundPostId)
    .maybeSingle();

  if (!existing) {
    const { error } = await admin.from("matches").insert({
      lost_post_id: lostPostId,
      found_post_id: foundPostId,
      score: typeof score === "number" ? score : 0,
    });
    if (error && error.code !== "23505") {
      return { error: "매칭 확정에 실패했어요." };
    }

    // 매칭 확정 시 두 게시글 상태 자동 정리
    await Promise.all([
      admin
        .from("lost_posts")
        .update({ status: "찾음", updated_at: new Date().toISOString() })
        .eq("id", lostPostId),
      admin
        .from("found_posts")
        .update({ status: "완료", updated_at: new Date().toISOString() })
        .eq("id", foundPostId),
    ]);

    const otherId = lost.user_id === user.id ? found.user_id : lost.user_id;
    if (otherId && otherId !== user.id) {
      await createNotification(
        otherId,
        "match",
        "매칭이 확정됐어요",
        "상대가 회원님의 게시글과 매칭을 확정했어요. 게시글은 완료 처리되고 채팅으로 이어져요.",
        `/${found.user_id === user.id ? "lost" : "found"}/${found.user_id === user.id ? lostPostId : foundPostId}`,
      );
    }
  }

  revalidatePath("/my/matches");
  revalidatePath("/my/posts");
  revalidatePath(`/lost/${lostPostId}`);
  revalidatePath(`/found/${foundPostId}`);
  redirect("/my/matches");
}

export async function cancelMatch(matchId) {
  const { user } = await requireUser();
  const admin = createAdminClient();

  const { data: m } = await admin
    .from("matches")
    .select("id, lost:lost_posts(user_id), found:found_posts(user_id)")
    .eq("id", matchId)
    .maybeSingle();
  if (!m) return { error: "매칭을 찾을 수 없어요." };
  if (m.lost?.user_id !== user.id && m.found?.user_id !== user.id) {
    return { error: "권한이 없어요." };
  }

  await admin.from("matches").delete().eq("id", matchId);
  revalidatePath("/my/matches");
}

// 되찾음 마무리 — 매칭을 완료 처리하고 두 게시글을 마감.
export async function completeMatch(matchId) {
  const { user } = await requireUser();
  const admin = createAdminClient();

  const { data: m } = await admin
    .from("matches")
    .select(
      "id, completed_at, lost_post_id, found_post_id, lost:lost_posts(user_id), found:found_posts(user_id)",
    )
    .eq("id", matchId)
    .maybeSingle();
  if (!m) return { error: "매칭을 찾을 수 없어요." };
  if (m.lost?.user_id !== user.id && m.found?.user_id !== user.id) {
    return { error: "권한이 없어요." };
  }
  if (m.completed_at) return { ok: true };

  const now = new Date().toISOString();
  await Promise.all([
    admin.from("matches").update({ completed_at: now }).eq("id", matchId),
    admin
      .from("lost_posts")
      .update({ status: "찾음", updated_at: now })
      .eq("id", m.lost_post_id),
    admin
      .from("found_posts")
      .update({ status: "완료", updated_at: now })
      .eq("id", m.found_post_id),
  ]);

  const otherId =
    m.lost?.user_id === user.id ? m.found?.user_id : m.lost?.user_id;
  if (otherId && otherId !== user.id) {
    await createNotification(
      otherId,
      "match",
      "물건을 무사히 전달했어요 🎉",
      "상대가 되찾음을 확인했어요. 이용해 주셔서 감사합니다!",
      "/my/matches",
    );
  }

  revalidatePath("/my/matches");
  revalidatePath("/my/posts");
  return { ok: true };
}
