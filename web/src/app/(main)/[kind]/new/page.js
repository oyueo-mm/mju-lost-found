import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { KIND_CONFIG } from "@/lib/constants";
import { isCampus, campusLabel } from "@/lib/campus";
import { createPost } from "@/lib/post-actions";
import PostForm from "@/components/PostForm";
import CampusPicker from "@/components/CampusPicker";
import Icon from "@/components/Icon";

export default async function NewPostPage({ params, searchParams }) {
  const { kind } = await params;
  const cfg = KIND_CONFIG[kind];
  if (!cfg) notFound();
  await requireUser({ mustBeActive: true });

  const sp = await searchParams;
  const campus = isCampus(sp.campus) ? sp.campus : null;
  if (!campus) {
    return <CampusPicker kind={kind} basePath={`/${kind}/new`} />;
  }

  const isLost = kind === "lost";

  return (
    <div>
      <div className="flex items-center gap-2">
        <Link
          href={isLost ? "/" : `/${kind}?campus=${campus}`}
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">
          {isLost ? "분실물 등록" : "습득물 등록"}
          <span className="ml-2 text-sm font-medium text-ink-faint">
            {campusLabel(campus)}
          </span>
        </h1>
      </div>

      {isLost && (
        <p className="mt-3 rounded-lg bg-sunken px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
          잃어버린 물건을 자세히 적어주세요. 등록하면 AI가 지금까지 올라온
          습득물과 매칭해 보여드리고, 없으면 비슷한 습득물이 새로 올라올 때
          알림을 드려요.
        </p>
      )}

      <div className="mt-4">
        <PostForm
          kind={kind}
          campus={campus}
          action={createPost.bind(null, kind)}
        />
      </div>
    </div>
  );
}
