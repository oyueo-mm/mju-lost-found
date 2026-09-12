"use client";

import Link from "next/link";
import { KIND_CONFIG } from "@/lib/constants";
import { locationDisplay } from "@/lib/campus";
import { useT } from "@/i18n/client";
import StatusBadge from "./StatusBadge";
import KindTag from "./KindTag";
import Icon from "./Icon";
import TimeAgo from "./TimeAgo";

// 게시판 그리드용 타일 — 사진이 먼저, 글은 아래. 테두리 없이 이미지 모서리만 둥글게.
// 목록(헤어라인)이 필요한 곳은 PostCard 를 그대로 쓴다.
export default function PostTile({ post, kind, showKind = false }) {
  const t = useT();
  const cfg = KIND_CONFIG[kind];
  const images = Array.isArray(post.image_urls)
    ? post.image_urls
    : post.image_url
      ? [post.image_url]
      : [];

  return (
    <Link href={`/${kind}/${post.id}`} className="group block min-w-0">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] border border-line bg-sunken">
        {images.length > 0 ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={images[0]}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-ink-faint">
            <Icon name={cfg.icon} size={28} strokeWidth={1.5} />
          </div>
        )}

        <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
          {showKind && <KindTag kind={kind} />}
          <StatusBadge status={post.status} />
        </div>

        {images.length > 1 && (
          <span className="num absolute bottom-1.5 right-1.5 rounded bg-solid/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
            <Icon name="image" size={10} className="mr-0.5 inline-block align-[-1px]" />
            {images.length}
          </span>
        )}
      </div>

      <div className="mt-2 min-w-0">
        <p className="line-clamp-2 text-[14px] font-semibold leading-snug tracking-[-0.01em] transition group-hover:text-brand">
          {post.title}
        </p>
        <p className="mt-1 truncate text-[12px] text-ink-soft">
          <span className="font-medium">{t(`cat.${post.category}`)}</span>
          <span aria-hidden> · </span>
          {locationDisplay(post.campus, post.location)}
        </p>
        <p className="num mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
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
              <span className="truncate">{post.author.nickname}</span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}
