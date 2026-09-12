import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// 서버(서버 컴포넌트 / 서버 액션 / 라우트 핸들러)에서 쓰는 Supabase 클라이언트.
// Next 16 에서 cookies() 는 비동기라 await 필요.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // 서버 컴포넌트에서 호출된 경우 쿠키를 쓸 수 없다.
            // 세션 갱신은 proxy.js 가 담당하므로 무시해도 안전.
          }
        },
      },
    },
  );
}
