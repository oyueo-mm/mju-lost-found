"use client";

import { useEffect, useRef } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

// Phase N: subscribes to the same `chat-room-{id}` Broadcast channel
// chat/realtimeAdmin.ts's server-side broadcastChatEvent() sends to -- see
// that file's own comment for why every event payload is content-free
// (numeric ids only) and what that does and doesn't protect against.
// ChatThread.tsx is the only caller; this hook owns nothing about *how*
// each event is handled, only the subscribe/cleanup lifecycle, so the
// three handlers below can each stay a plain, easily-testable function on
// the caller's side.
type ChatRoomRealtimeHandlers = {
  onMessage?: () => void;
  onReaction?: () => void;
  onRead?: (payload: { userId: number; lastReadMessageId: number }) => void;
};

export function useChatRoomRealtime(chatRoomId: number, handlers: ChatRoomRealtimeHandlers): void {
  // Ref, not a dependency-array entry: the subscribe effect below should
  // only ever re-subscribe when chatRoomId itself changes (a new room was
  // opened), never merely because a new render passed new function
  // identities for the same three handlers (ChatThread doesn't memoize
  // them, and shouldn't have to just to satisfy this hook). Written in
  // its own effect (never during render) -- React 19's react-hooks/refs
  // rule flags a plain `ref.current = x` assignment in the render body.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`chat-room-${chatRoomId}`)
      .on("broadcast", { event: "message" }, () => handlersRef.current.onMessage?.())
      .on("broadcast", { event: "reaction" }, () => handlersRef.current.onReaction?.())
      .on("broadcast", { event: "read" }, ({ payload }) => handlersRef.current.onRead?.(payload))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatRoomId]);
}
