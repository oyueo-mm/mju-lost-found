"use client";

import Link from "next/link";
import { KIND_CONFIG } from "@/lib/constants";
import { locationDisplay } from "@/lib/campus";
import { useT } from "@/i18n/client";
import StatusBadge from "./StatusBadge";
import KindTag from "./KindTag";
import Icon from "./Icon";
import TimeAgo from "./TimeAgo";

// 게시글 한 줄. .card divide-y 컨테이너 안에 넣어 헤어라인 리스트로 쓴다.
export default function PostCard({ post, kind, badge, hideKind = false }) {
  const t = useT();
  const cfg = KIND_CONFIG[kind];
  const images = Array.isArray(post.image_urls)
    ? post.image_urls
    : post.image_url
      ? [post.image_url]
      : [];

  return (
    <Link
      href={`/${kind}/${post.id}`}
      className="flex gap-3.5 px-4 py-3.5 transition first:rounded-t-[calc(var(--radius)-1px)] last:rounded-b-[calc(var(--radius)-1px)] hover:bg-sunken"
    >
      {images.length > 0 ? (
        <div className="relative shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[0]}
            alt=""
            className="h-[60px] w-[60px] rounded-[10px] border border-line object-cover"
          />
          {images.length > 1 && (
            <span className="num absolute bottom-1 right-1 rounded bg-solid/70 px-1 text-[10px] font-bold text-white">
              +{images.length - 1}
            </span>
          )}
        </div>
      ) : (
        <div className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-[10px] bg-sunken text-ink-faint">
          <Icon name={cfg.icon} size={22} strokeWidth={1.7} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {!hideKind && <KindTag kind={kind} />}
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">
            {post.title}
          </span>
          {badge || <StatusBadge status={post.status} />}
        </div>
        <p className="mt-1 line-clamp-1 text-[13px] text-ink-soft">
          {post.description}
        </p>
        <p className="num mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-ink-faint">
          <span className="font-medium text-ink-soft">{t(`cat.${post.category}`)}</span>
          <span aria-hidden>·</span>
          <span className="min-w-0 break-all">
            {locationDisplay(post.campus, post.location)}
          </span>
          <span aria-hidden>·</span>
          <TimeAgo value={post[cfg.dateField] || post.created_at} />
          {post.view_count > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5">
                <Icon name="eye" size={11} /> {post.view_count}
              </span>
            </>
          )}
          {post.author?.nickname && (
            <>
              <span aria-hidden>·</span>
              <span>{post.author.nickname}</span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}
