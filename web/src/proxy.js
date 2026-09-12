import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

// Next 16 에서 미들웨어는 "proxy" 로 이름이 바뀜 (동작은 동일).
// 매 요청마다 Supabase 세션 쿠키를 갱신하고, 비로그인 사용자를 로그인으로 보낸다.

// 비로그인도 접근 가능한 경로. 약관·개인정보는 로그인 필요(로그인+미동의 유저는 볼 수 있음).
const PUBLIC_PATHS = ["/", "/login", "/help", "/credits"];

export async function proxy(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/manifest") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
