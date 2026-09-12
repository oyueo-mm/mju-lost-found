"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// 로그인 유저용 전역 실시간 새로고침.
// 새 알림 / 받은 메시지 / (관리자면) 새 신고·문의 가 생기면 라우트를 refresh 해서
// 헤더 벨·채팅 뱃지·관리자 뱃지·목록을 최신화한다. (디바운스)
export default function RealtimeRefresher({ userId, staff }) {
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let channel;
    let timer;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 600);
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }

      let ch = supabase
        .channel(`rt-refresh-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          bump,
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (p) => {
            if (p.new?.sender_id && p.new.sender_id !== userId) bump();
          },
        );

      if (staff) {
        ch = ch
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "reports" },
            bump,
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "inquiries" },
            bump,
          )
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "inquiry_messages" },
            bump,
          );
      }

      channel = ch.subscribe();
    })();

    return () => {
      clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId, staff, router]);

  return null;
}
