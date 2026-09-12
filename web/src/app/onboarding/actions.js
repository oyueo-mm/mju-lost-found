"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isEmailPermitted, getOwnProfile } from "@/lib/auth";
import { majorFromName } from "@/lib/profile";

const NICK_RE = /^[가-힣a-zA-Z0-9]{2,20}$/;

export async function setNickname(_prevState, formData) {
  const nickname = (formData.get("nickname") || "").toString().trim();

  if (!NICK_RE.test(nickname)) {
    return { error: "닉네임은 한글/영문/숫자 2~20자여야 해요." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isEmailPermitted(user.email)))
    redirect("/login?error=domain");

  // 본인 프로필은 service_role 로 (phase-32: authenticated 는 4개 컬럼만 읽음)
  const profile = await getOwnProfile(user.id);
  if (profile?.nickname) redirect("/");

  // 학과는 구글 계정 이름에서 자동 추출
  const detectedMajor =
    profile?.major ||
    majorFromName(
      user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        profile?.name,
    );

  const { error } = await supabase
    .from("profiles")
    .update({ nickname, major: detectedMajor || null })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "이미 사용 중인 닉네임이에요." };
    }
    return { error: "저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  redirect("/");
}
