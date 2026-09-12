import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import Icon from "@/components/Icon";
import NoticeForm from "@/components/admin/NoticeForm";
import DeleteNoticeButton from "@/components/admin/DeleteNoticeButton";

export const metadata = { title: "공지 보내기 · 관리자" };

export default async function AdminNoticePage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: notices } = await admin
    .from("notices")
    .select("id, title, body, link, recipient_count, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/admin"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">공지 보내기</h1>
      </div>

      <p className="text-sm text-ink-soft">
        전체 사용자의 알림함으로 공지가 전송돼요. 되돌릴 수 없으니 신중히
        보내주세요.
      </p>

      <NoticeForm />

      <section>
        <h2 className="mb-2 text-sm font-bold">보낸 공지</h2>
        {!notices || notices.length === 0 ? (
          <p className="card p-5 text-sm text-ink-faint">
            아직 보낸 공지가 없어요.
          </p>
        ) : (
          <ul className="card divide-y divide-line-soft overflow-hidden">
            {notices.map((n) => (
              <li key={n.id} className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/notices/${n.id}`}
                    className="min-w-0 flex-1 truncate font-semibold hover:text-brand"
                  >
                    {n.title}
                  </Link>
                  <span className="num shrink-0 text-xs text-ink-faint">
                    {formatDateTime(n.created_at)}
                  </span>
                </div>
                {n.body && (
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-ink-soft">
                    {n.body}
                  </p>
                )}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="num text-xs text-ink-faint">
                    {n.recipient_count}명 발송
                    {n.link ? ` · ${n.link}` : ""}
                  </p>
                  <DeleteNoticeButton id={n.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
