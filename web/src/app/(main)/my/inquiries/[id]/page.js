import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Icon from "@/components/Icon";
import InquiryThread from "@/components/InquiryThread";
import InquiryReplyForm from "@/components/InquiryReplyForm";
import InquiryRealtime from "@/components/InquiryRealtime";

export const metadata = { title: "1:1 문의 · 명지 분실물 센터" };

const STATUS = {
  open: { label: "답변 대기", cls: "bg-sunken text-ink-soft" },
  answered: { label: "답변 완료", cls: "bg-brand-tint text-brand-deep" },
  closed: { label: "종료", cls: "bg-sunken text-ink-faint" },
};

export default async function MyInquiryDetailPage({ params }) {
  const { user } = await requireUser();
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();

  const supabase = await createClient();
  const { data: inq } = await supabase
    .from("inquiries")
    .select("id, category, status, created_at, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!inq || inq.user_id !== user.id) notFound();

  const { data: messages } = await supabase
    .from("inquiry_messages")
    .select("id, staff, body, created_at")
    .eq("inquiry_id", id)
    .order("created_at", { ascending: true });

  const st = STATUS[inq.status] || STATUS.open;

  return (
    <div className="mx-auto max-w-2xl">
      <InquiryRealtime inquiryId={inq.id} />
      <div className="flex items-center gap-2">
        <Link
          href="/my/inquiries"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="min-w-0 truncate text-lg font-extrabold">
          {inq.category}
        </h1>
        <span className={`chip shrink-0 ${st.cls}`}>{st.label}</span>
      </div>

      <div className="mt-4 card p-4 sm:p-5">
        <InquiryThread messages={messages} meRight />

        {inq.status === "closed" ? (
          <p className="mt-4 rounded-lg bg-sunken p-3 text-center text-xs text-ink-faint">
            종료된 문의예요. 새로운 내용은 새 문의로 남겨주세요.
          </p>
        ) : (
          <InquiryReplyForm inquiryId={inq.id} />
        )}
      </div>
    </div>
  );
}
