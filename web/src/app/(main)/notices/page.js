import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import Icon from "@/components/Icon";

export const metadata = { title: "공지사항 · 명지 분실물 센터" };

export default async function NoticesPage() {
  await requireUser();
  const admin = createAdminClient();
  const { data: notices } = await admin
    .from("notices")
    .select("id, title, body, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="text-xl font-extrabold">공지사항</h1>

      <div className="mt-4">
        {!notices || notices.length === 0 ? (
          <div className="card-dashed p-12 text-center text-ink-faint">
            <Icon name="bell" size={26} className="mx-auto" strokeWidth={1.6} />
            <p className="mt-3 text-sm">등록된 공지가 없어요.</p>
          </div>
        ) : (
          <ul className="card divide-y divide-line-soft overflow-hidden">
            {notices.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/notices/${n.id}`}
                  className="flex items-start gap-3 px-4 py-4 transition hover:bg-sunken"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{n.title}</p>
                    {n.body && (
                      <p className="mt-1 line-clamp-2 text-[13px] text-ink-faint">
                        {n.body}
                      </p>
                    )}
                    <p className="num mt-1.5 text-xs text-ink-faint">
                      {formatDate(n.created_at)}
                    </p>
                  </div>
                  <Icon
                    name="arrowRight"
                    size={15}
                    className="mt-0.5 shrink-0 text-ink-faint"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
