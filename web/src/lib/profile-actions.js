"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";

const SID_RE = /^[0-9]{4,12}$/;
const NICK_RE = /^[가-힣a-zA-Z0-9]{2,20}$/;
const CHANGE_COOLDOWN_DAYS = 30;
const CHANGE_COOLDOWN_MS = CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export async function updateStudentId(_prev, formData) {
  const studentId = (formData.get("student_id") || "").toString().trim();
  if (!SID_RE.test(studentId)) {
    return { error: "학번은 숫자 4~12자리로 입력해 주세요." };
  }

  const { user, supabase } = await requireUser();
  const { error } = await supabase
    .from("profiles")
    .update({ student_id: studentId })
    .eq("id", user.id);

  if (error) return { error: "저장에 실패했어요." };
  revalidatePath("/my");
  return { ok: true };
}

export async function changeNickname(_prev, formData) {
  const nickname = (formData.get("nickname") || "").toString().trim();
  if (!NICK_RE.test(nickname)) {
    return { error: "닉네임은 한글/영문/숫자 2~20자여야 해요." };
  }

  const { user, supabase } = await requireUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname, nickname_changed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.nickname === nickname) {
    return { error: "지금 닉네임과 같아요." };
  }

  const last = profile?.nickname_changed_at
    ? new Date(profile.nickname_changed_at).getTime()
    : 0;
  const remain = last + CHANGE_COOLDOWN_MS - Date.now();
  if (remain > 0) {
    const days = Math.ceil(remain / (24 * 60 * 60 * 1000));
    return {
      error: `닉네임은 ${CHANGE_COOLDOWN_DAYS}일에 한 번만 바꿀 수 있어요. ${days}일 후에 다시 변경할 수 있어요.`,
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ nickname, nickname_changed_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "이미 사용 중인 닉네임이에요." };
    return { error: "변경에 실패했어요." };
  }
  revalidatePath("/my");
  revalidatePath("/", "layout");
  return { ok: true };
}
