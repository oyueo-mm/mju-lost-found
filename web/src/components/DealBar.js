"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDeal } from "@/lib/chat-actions";
import { createClient } from "@/lib/supabase/client";
import Icon from "./Icon";

export default function DealBar({ roomId, meIsA, completed, mine, other }) {
  const router = useRouter();
  const [state, setState] = useState({ completed, mine, other });
  const [err, setErr] = useState(null);
  const [pending, startTransition] = useTransition();

  // 상대가 '거래 완료' 를 누르면 내 화면도 바로 갱신
  useEffect(() => {
    const supabase = createClient();
    let channel;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
      channel = supabase
        .channel(`deal-${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "chat_rooms",
            filter: `id=eq.${roomId}`,
          },
          (p) => {
            const row = p.new;
            const nextCompleted = !!row.deal_completed_at;
            setState({
              completed: nextCompleted,
              mine: meIsA ? row.deal_confirmed_a : row.deal_confirmed_b,
              other: meIsA ? row.deal_confirmed_b : row.deal_confirmed_a,
            });
            if (nextCompleted) router.refresh();
          },
        )
        .subscribe();
    })();
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId, meIsA, router]);

  function act() {
    setErr(null);
    startTransition(async () => {
      const r = await confirmDeal(roomId);
      if (r?.error) {
        setErr(r.error);
        return;
      }
      // 내가 방금 눌렀으니 mine = true
      setState((s) => ({ ...s, mine: true, completed: !!r.completed }));
      if (r.completed) router.refresh(); // 헤더 명지도 갱신
    });
  }

  if (state.completed) {
    return (
      <div className="shrink-0 border-b border-line-soft bg-emerald-50 px-4 py-2 text-center text-xs font-semibold text-emerald-700">
        <Icon name="check" size={13} className="mr-1 inline" />
        거래가 완료됐어요 · 서로 명지도 +0.5%p
      </div>
    );
  }

  // 내가 이미 눌렀고 상대 대기 중
  if (state.mine && !state.other) {
    return (
      <div className="shrink-0 border-b border-line-soft bg-surface px-4 py-2 text-center text-xs text-ink-faint">
        거래 완료 요청함 · 상대가 확인하면 서로 명지도가 올라가요
      </div>
    );
  }

  // 상대가 먼저 눌렀음 → 내 확인 필요 (강조)
  if (state.other && !state.mine) {
    return (
      <div className="shrink-0 border-b border-line-soft bg-brand-tint px-4 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-brand-deep">
            상대가 거래 완료를 눌렀어요. 확인할까요?
          </span>
          <button
            type="button"
            onClick={act}
            disabled={pending}
            className="btn btn-primary shrink-0 px-3 py-1 text-xs"
          >
            {pending ? "처리 중…" : "거래 완료 확인"}
          </button>
        </div>
        {err && <p className="mt-1 text-xs text-brand-deep">{err}</p>}
      </div>
    );
  }

  // 아직 아무도 안 누름
  return (
    <div className="shrink-0 border-b border-line-soft bg-surface px-4 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-faint">
          물건을 주고받았다면 서로 확인해 주세요
        </span>
        <button
          type="button"
          onClick={act}
          disabled={pending}
          className="btn btn-ghost shrink-0 px-3 py-1 text-xs font-semibold"
        >
          {pending ? "처리 중…" : "거래 완료"}
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-brand-deep">{err}</p>}
    </div>
  );
}
