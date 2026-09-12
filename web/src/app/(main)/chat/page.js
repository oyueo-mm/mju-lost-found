import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listRooms } from "@/lib/chat";
import { timeAgo } from "@/lib/format";
import Icon from "@/components/Icon";

export const metadata = { title: "채팅 · 명지 분실물 센터" };

export default async function ChatListPage() {
  const { user } = await requireUser();
  const supabase = await createClient();
  const rooms = await listRooms(supabase, user.id);

  return (
    <div>
      <h1 className="text-xl font-extrabold">채팅</h1>

      <div className="mt-4">
        {rooms.length === 0 ? (
          <div className="card-dashed p-10 text-center text-ink-faint">
            <Icon name="chat" size={28} className="mx-auto" strokeWidth={1.6} />
            <p className="mt-3 text-sm">
              아직 채팅이 없어요.
              <br />
              게시글 상세에서 “작성자와 채팅”을 눌러보세요.
            </p>
          </div>
        ) : (
          <div className="card divide-y divide-line-soft overflow-hidden">
            {rooms.map((r) => (
              <Link
                key={r.id}
                href={`/chat/${r.id}`}
                className="flex items-center gap-3.5 px-4 py-3.5 transition hover:bg-sunken"
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-tint font-bold text-brand-deep">
                  {r.other?.nickname?.[0] || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-bold">
                      {r.other?.nickname || "알 수 없음"}
                    </span>
                    {r.lastMessage && (
                      <span className="num shrink-0 text-xs text-ink-faint">
                        {timeAgo(r.lastMessage.created_at)}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-ink-soft">
                    {r.lastMessage?.content ||
                      (r.lastMessage?.image_url ? "사진" : null) ||
                      r.context_title ||
                      "새 채팅"}
                  </p>
                </div>
                {r.unread > 0 && (
                  <span className="num chip shrink-0 bg-brand text-white">
                    {r.unread}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
