import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailPermitted } from "@/lib/auth";

// 구글 로그인 후 돌아오는 곳. 인증 코드를 세션으로 교환하고
// @mju.ac.kr 계정인지 확인한 뒤 홈으로 보낸다.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const providerError =
    searchParams.get("error_description") || searchParams.get("error");
  const next = searchParams.get("next") || "/";

  if (providerError) {
    console.error("[auth/callback] provider error:", providerError);
    return NextResponse.redirect(
      `${origin}/login?error=exchange&d=${encodeURIComponent(providerError)}`,
    );
  }

  if (!code) {
    console.error("[auth/callback] code 없음. 전체 URL:", request.url);
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] 교환 실패:", error.message);
    return NextResponse.redirect(
      `${origin}/login?error=exchange&d=${encodeURIComponent(error.message)}`,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isEmailPermitted(user.email))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
