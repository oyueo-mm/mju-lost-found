"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRoom } from "@/lib/chat-actions";
import Icon from "./Icon";

export default function DeleteRoomButton({ roomId }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !confirm(
        "이 채팅방을 삭제할까요? 대화 내용이 모두 사라지고 상대방 채팅방에서도 삭제돼요.",
      )
    )
      return;
    startTransition(async () => {
      const r = await deleteRoom(roomId);
      if (r?.error) {
        alert(r.error);
        return;
      }
      router.push("/chat");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label="채팅방 삭제"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint transition hover:bg-sunken hover:text-brand-deep disabled:opacity-50"
    >
      <Icon name="trash" size={16} />
    </button>
  );
}
