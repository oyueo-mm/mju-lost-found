import { notFound } from "next/navigation";

import { getAnnouncement } from "@/lib/announcement/service";
import { BellIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

// Phase M: the page an announcement's notification links to (see
// resolveHref.ts's "announcement" branch) -- deliberately not in main nav
// (this phase's own spec: "새로운 탭을 추가하지 않는다") and not linked from
// any list either; reached only via a notification click or a direct URL.
// Public by design, same posture as /post/[id] and /profile/[publicId] --
// getAnnouncement() has no auth check of its own, so a logged-out visitor
// who somehow has the link can still read it.
export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const announcement = await getAnnouncement(id);
  if (!announcement) notFound();

  const wasEdited = announcement.updatedAt.getTime() !== announcement.createdAt.getTime();

  return (
    <div className="flex flex-col gap-4">
      {/* Same BellIcon the notification list already uses for this type
          (see NotificationItem's own comment on why "announcement" relies
          on that fallback rather than a dedicated icon) -- kept visually
          consistent with where the reader clicked in from. */}
      <div className="flex items-center gap-2 text-xs font-medium text-primary">
        <BellIcon className="size-4" />
        공지사항
      </div>
      <h1 className="text-xl font-semibold text-foreground md:text-2xl">{announcement.title}</h1>
      <p className="text-xs text-muted-foreground">
        {formatDate(announcement.createdAt)}
        {wasEdited && ` · 수정됨: ${formatDate(announcement.updatedAt)}`}
      </p>
      <div className="whitespace-pre-wrap rounded-card border border-border bg-card p-5 text-sm leading-relaxed text-foreground">
        {announcement.content}
      </div>
    </div>
  );
}
