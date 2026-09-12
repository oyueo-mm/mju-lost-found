import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import Icon from "@/components/Icon";
import AdminInquiryItem from "@/components/admin/AdminInquiryItem";

export const metadata = { title: "문의 관리 · 관리자" };

const TABS = [
  ["open", "미답변"],
  ["answered", "답변 완료"],
  ["closed", "종료"],
  ["all", "전체"],
];

export default async function AdminInquiriesPage({ searchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp?.tab) ? sp.tab : "open";

  const admin = createAdminClient();
  let q = admin
    .from("inquiries")
    .select(
      "id, category, status, created_at, last_message_at, author:profiles!user_id(nickname)",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (tab !== "all") q = q.eq("status", tab);
  const { data: rows } = await q;

  const ids = (rows || []).map((r) => r.id);
  let byInquiry = new Map();
  if (ids.length > 0) {
    const { data: msgs } = await admin
      .from("inquiry_messages")
      .select("id, inquiry_id, staff, body, created_at")
      .in("inquiry_id", ids)
      .order("created_at", { ascending: true });
    for (const m of msgs || []) {
      if (!byInquiry.has(m.inquiry_id)) byInquiry.set(m.inquiry_id, []);
      byInquiry.get(m.inquiry_id).push(m);
    }
  }

  const list = (rows || []).map((r) => ({
    id: r.id,
    category: r.category,
    status: r.status,
    authorNickname: r.author?.nickname,
    createdText: formatDateTime(r.created_at),
    messages: byInquiry.get(r.id) || [],
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/admin"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">문의 관리</h1>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={`/admin/inquiries?tab=${k}`}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
              tab === k
                ? "bg-brand text-white"
                : "bg-sunken text-ink-soft hover:text-ink"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="card p-5 text-sm text-ink-faint">해당하는 문의가 없어요.</p>
      ) : (
        <ul className="space-y-2.5">
          {list.map((q) => (
            <AdminInquiryItem key={q.id} inquiry={q} />
          ))}
        </ul>
      )}
    </div>
  );
}
