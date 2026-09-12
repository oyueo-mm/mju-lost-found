import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getRoom, listMessages } from "@/lib/chat";
import { KIND_CONFIG } from "@/lib/constants";
import ChatRoomView from "@/components/ChatRoomView";
import StatusBadge from "@/components/StatusBadge";
import MannerScore from "@/components/MannerScore";
import DealBar from "@/components/DealBar";
import DeleteRoomButton from "@/components/DeleteRoomButton";
import Icon from "@/components/Icon";

export default async function ChatRoomPage({ params }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const { user } = await requireUser();
  const supabase = await createClient();

  const room = await getRoom(supabase, id, user.id);
  if (!room) notFound();
  const messages = await listMessages(supabase, id);

  return (
    // 메인 레이아웃 여백을 상쇄하고 화면을 꽉 채우는 채팅 화면
    <div
      className="-mx-4 -mt-6 -mb-24 flex flex-col overflow-hidden sm:-mx-0 sm:-mb-8 sm:rounded-2xl sm:border sm:border-line"
      style={{ height: "calc(100dvh - 4rem)" }}
    >
      <div className="flex items-center gap-2.5 border-b border-line-soft bg-surface px-4 py-2.5">
        <Link
          href="/chat"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-bold text-brand-deep">
          {room.other?.nickname?.[0] || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold leading-tight">
            {room.other?.nickname || "알 수 없음"}
          </p>
          <div className="truncate text-xs text-ink-faint">
            {room.other?.trust_score != null ? (
              <MannerScore score={room.other.trust_score} />
            ) : (
              !room.contextPost && room.context_title
            )}
          </div>
        </div>

        <DeleteRoomButton roomId={id} />
      </div>

      {room.contextPost && <ContextPostBar post={room.contextPost} />}

      {room.deal.available && (
        <DealBar
          roomId={id}
          meIsA={room.user_a === user.id}
          completed={room.deal.completed}
          mine={room.deal.mine}
          other={room.deal.other}
        />
      )}

      <ChatRoomView roomId={id} meId={user.id} initialMessages={messages} />
    </div>
  );
}

function ContextPostBar({ post }) {
  const cfg = KIND_CONFIG[post.kind];
  const thumb = Array.isArray(post.image_urls)
    ? post.image_urls[0]
    : post.image_url || null;

  return (
    <div className="shrink-0 border-b border-line-soft bg-surface px-3 py-2">
      <Link
        href={`/${post.kind}/${post.id}`}
        className="group flex items-center gap-2.5 rounded-lg border border-line bg-sunken px-2.5 py-2 transition hover:border-brand-soft hover:bg-surface"
      >
        <span
          className={`w-1 shrink-0 self-stretch rounded-full ${cfg.dot}`}
          aria-hidden="true"
        />
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover"
          />
        ) : (
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line ${cfg.tint} ${cfg.tintText}`}
          >
            <Icon name={cfg.icon} size={17} strokeWidth={1.8} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            <span className={`chip ${cfg.tint} ${cfg.tintText} px-1.5 py-0`}>
              {cfg.label}
            </span>
            이 물건에 대한 대화
          </p>
          <p className="truncate text-sm font-semibold leading-tight text-ink">
            {post.title}
          </p>
        </div>
        <StatusBadge status={post.status} />
        <Icon
          name="arrowRight"
          size={15}
          className="shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-brand"
        />
      </Link>
    </div>
  );
}
