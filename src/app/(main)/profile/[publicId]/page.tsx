import { notFound } from "next/navigation";

import { getPublicProfile } from "@/lib/user/service";
import { UserIcon, BoxIcon, ClockIcon } from "@/components/icons";

function formatJoinDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(date);
}

// Phase H-7: public by design ("다른 사용자의 프로필을 볼 수 있도록 한다") -- no
// requireUser()/requireReadyUser() gate, same as /post/[id] and /search
// already being viewable while logged out. getPublicProfile() itself only
// ever returns nickname/publicId/createdAt/postCount (see its own
// comment) -- never email/googleId/isAdmin/isSuspended, regardless of who
// is viewing.
export default async function ProfilePage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const profile = await getPublicProfile(publicId);
  if (!profile) notFound();

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center gap-4 rounded-card border border-border bg-card p-5">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
          <UserIcon className="size-8" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate text-xl font-semibold text-foreground">{profile.nickname ?? "알 수 없음"}</h1>
          {/* Phase H-7: "공개 사용자 ID" -- the opaque publicId itself, shown
              as-is (not the internal numeric id, never exposed). */}
          <span className="truncate text-xs text-muted-foreground">ID: {profile.publicId}</span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center gap-1.5 rounded-card border border-border bg-card p-4 text-center">
          <BoxIcon className="size-5 text-muted-foreground" />
          <span className="text-lg font-semibold text-foreground">{profile.postCount}</span>
          <span className="text-xs text-muted-foreground">공개 게시글</span>
        </div>
        <div className="flex flex-col items-center gap-1.5 rounded-card border border-border bg-card p-4 text-center">
          <ClockIcon className="size-5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{formatJoinDate(profile.createdAt)}</span>
          <span className="text-xs text-muted-foreground">가입일</span>
        </div>
      </section>
    </div>
  );
}
