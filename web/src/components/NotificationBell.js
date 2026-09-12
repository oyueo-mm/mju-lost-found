"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { unreadGroupCount } from "@/lib/notif-group";
import Icon from "./Icon";

export default function NotificationBell({ userId, initialCount = 0 }) {
  const [count, setCount] = useState(initialCount);

  // 레이아웃이 refresh 되면(RealtimeRefresher 등) 새 값으로 동기화
  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  useEffect(() => {
    const supabase = createClient();
    let channel;

    async function refresh() {
      const { data } = await supabase
        .from("notifications")
        .select("id, type, link, is_read, created_at")
        .eq("user_id", userId)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(100);
      setCount(unreadGroupCount(data || []));
    }

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      channel = supabase
        .channel(`notif-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          refresh,
        )
        .subscribe();
    })();

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);

    return () => {
      if (channel) supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [userId]);

  return (
    <Link
      href="/notifications"
      className="relative grid h-9 w-9 place-items-center rounded-full text-ink-soft transition hover:bg-sunken hover:text-ink"
      aria-label="알림"
    >
      <Icon name="bell" size={19} />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-4 text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
