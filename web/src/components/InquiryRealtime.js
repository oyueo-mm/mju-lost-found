"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// 문의 스레드 상세를 실시간 갱신 — 관리자 답변·상태 변경 시 바로 반영.
export default function InquiryRealtime({ inquiryId }) {
  const router = useRouter();

  useEffect(() => {
    if (!inquiryId) return;
    const supabase = createClient();
    let channel;
    let timer;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      channel = supabase
        .channel(`inq-${inquiryId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "inquiry_messages",
            filter: `inquiry_id=eq.${inquiryId}`,
          },
          bump,
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "inquiries",
            filter: `id=eq.${inquiryId}`,
          },
          bump,
        )
        .subscribe();
    })();

    return () => {
      clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [inquiryId, router]);

  return null;
}
