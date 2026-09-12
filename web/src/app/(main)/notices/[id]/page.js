import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import Icon from "@/components/Icon";

export const metadata = { title: "공지사항 · 명지 분실물 센터" };

export default async function NoticeDetailPage({ params }) {
  await requireUser();
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();

  const admin = createAdminClient();
  const { data: notice } = await admin
    .from("notices")
    .select("id, title, body, link, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!notice) notFound();

  return (
    <article className="mx-auto max-w-2xl">
      <Link
        href="/notices"
        className="inline-flex items-center gap-1 text-[13px] text-ink-faint transition hover:text-ink"
      >
        <Icon name="back" size={14} /> 공지사항
      </Link>

      <div className="card mt-4 p-5 sm:p-6">
        <p className="num text-xs text-ink-faint">
          {formatDateTime(notice.created_at)}
        </p>
        <h1 className="mt-1.5 break-words text-[22px] font-extrabold leading-snug">
          {notice.title}
        </h1>

        {notice.body ? (
          <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-[1.75] text-ink-soft">
            {notice.body}
          </p>
        ) : null}

        {notice.link && (
          <Link
            href={notice.link}
            className="btn btn-ghost mt-5 gap-1 px-4 py-2 text-sm"
          >
            자세히 보기
            <Icon name="arrowRight" size={14} />
          </Link>
        )}
      </div>
    </article>
  );
}
