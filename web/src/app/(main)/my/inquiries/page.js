import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/format";
import Icon from "@/components/Icon";
import InquiryForm from "@/components/InquiryForm";

export const metadata = { title: "1:1 문의 · 명지 분실물 센터" };

const STATUS = {
  open: { label: "답변 대기", cls: "bg-sunken text-ink-soft" },
  answered: { label: "답변 완료", cls: "bg-brand-tint text-brand-deep" },
  closed: { label: "종료", cls: "bg-sunken text-ink-faint" },
};

export default async function MyInquiriesPage() {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("inquiries")
    .select("id, category, message, status, created_at, last_message_at")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/my"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">1:1 문의</h1>
      </div>

      <p className="text-sm text-ink-soft">
        FAQ(
        <Link href="/help" className="text-brand-strong underline">
          고객센터
        </Link>
        )에서 해결되지 않는 문제나 개선 아이디어를 보내주세요. 답변은 알림으로
        와요.
      </p>

      <InquiryForm />

      <section>
        <h2 className="mb-2 text-sm font-bold">내 문의 내역</h2>
        {!list || list.length === 0 ? (
          <p className="card p-5 text-sm text-ink-faint">
            아직 보낸 문의가 없어요.
          </p>
        ) : (
          <ul className="card divide-y divide-line-soft overflow-hidden">
            {list.map((q) => {
              const st = STATUS[q.status] || STATUS.open;
              return (
                <li key={q.id}>
                  <Link
                    href={`/my/inquiries/${q.id}`}
                    className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-sunken"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-ink-soft">
                          {q.category}
                        </span>
                        <span className={`chip ${st.cls}`}>{st.label}</span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-sm">{q.message}</p>
                      <p className="num mt-1 text-xs text-ink-faint">
                        {timeAgo(q.last_message_at || q.created_at)}
                      </p>
                    </div>
                    <Icon
                      name="arrowRight"
                      size={15}
                      className="mt-0.5 shrink-0 text-ink-faint"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
