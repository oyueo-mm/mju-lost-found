import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyPostsAll } from "@/lib/posts";
import Icon from "@/components/Icon";
import MannerScore from "@/components/MannerScore";
import ProfileInfoForm from "@/components/ProfileInfoForm";
import NicknameChangeForm from "@/components/NicknameChangeForm";
import ThemePanel from "@/components/ThemePanel";
import KonamiReveal from "@/components/KonamiReveal";

export const metadata = { title: "내 정보 · 명지 분실물 센터" };

function InfoRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <span className="shrink-0 text-sm text-ink-faint">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-semibold">
        {value || "-"}
      </span>
    </div>
  );
}

export default async function MyPage() {
  const { user, profile } = await requireUser();
  const supabase = await createClient();

  const myPosts = await listMyPostsAll(supabase, user.id);
  const total = myPosts.length;

  const menu = [
    { href: "/my/posts", icon: "text", label: "내 게시글", sub: `${total}건` },
    { href: "/my/matches", icon: "link", label: "내 매칭" },
    { href: "/chat", icon: "chat", label: "내 채팅" },
    { href: "/notifications", icon: "bell", label: "알림" },
    { href: "/my/inquiries", icon: "chat", label: "1:1 문의" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-extrabold">내 정보</h1>

      <section className="card p-5">
        <div className="flex items-center gap-3.5">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand text-xl font-extrabold text-white">
            {profile?.nickname?.[0] || "명"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold">
              {profile?.nickname}
            </p>
            <p className="truncate text-sm text-ink-faint">{user.email}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line-soft pt-4">
          <div>
            <p className="text-sm font-semibold">명지도</p>
            <p className="text-[11px] text-ink-faint">
              거래를 완료할수록 올라가요 (최대 100%)
            </p>
          </div>
          <MannerScore score={profile?.trust_score ?? 50} bar />
        </div>

        <KonamiReveal />

        <div className="mt-2 border-t border-line-soft pt-1">
          <InfoRow label="닉네임" value={profile?.nickname} />
          <InfoRow label="학과" value={profile?.major} />
          <InfoRow label="학번" value={profile?.student_id} />
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 border-t border-line-soft pt-3">
          <NicknameChangeForm
            current={profile?.nickname}
            changedAt={profile?.nickname_changed_at}
          />
          <ProfileInfoForm studentId={profile?.student_id} />
        </div>
      </section>

      <section className="card divide-y divide-line-soft">
        {menu.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="flex items-center gap-3 px-5 py-4 transition hover:bg-sunken"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
              <Icon name={m.icon} size={17} />
            </span>
            <span className="flex-1 font-semibold">{m.label}</span>
            {m.sub && (
              <span className="text-sm text-ink-faint">{m.sub}</span>
            )}
            <Icon name="arrowRight" size={16} className="text-ink-faint" />
          </Link>
        ))}
      </section>

      <ThemePanel />

      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="btn btn-ghost w-full py-3 text-sm text-ink-soft"
        >
          로그아웃
        </button>
      </form>

      <Link
        href="/my/delete"
        className="block py-1 text-center text-xs text-ink-faint underline"
      >
        회원 탈퇴
      </Link>
    </div>
  );
}
