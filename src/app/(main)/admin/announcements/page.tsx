import { requireAdmin } from "@/lib/auth/session";
import { listAnnouncementsForAdmin } from "@/lib/announcement/service";
import { CreateAnnouncementForm } from "@/components/admin/CreateAnnouncementForm";
import { AnnouncementRow } from "@/components/admin/AnnouncementRow";
import { Pagination } from "@/components/search/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { BellIcon } from "@/components/icons";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(date);
}

const PAGE_SIZE = 20;

// Phase M: admin-only management page for announcements -- reached from
// the "관리자 센터" dashboard tile, not from main nav (this phase's own
// spec: "새로운 탭을 추가하지 않는다"). Same page-level requireAdmin() gate
// every other /admin/* page uses; listAnnouncementsForAdmin() re-checks
// isAdmin() itself regardless (see that function's own comment), and every
// mutation below goes through actions.ts's own requireAdmin() re-check --
// never trusts this page's gate alone.
export default async function AdminAnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const admin = await requireAdmin();

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const result = await listAnnouncementsForAdmin(admin, { page, limit: PAGE_SIZE });
  const { items, total, totalPages } = result.kind === "ok" ? result.data : { items: [], total: 0, totalPages: 1 };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <BellIcon className="size-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">공지사항 관리</h1>
      </div>

      <CreateAnnouncementForm />

      <p className="text-sm text-muted-foreground">전체 {total}건</p>

      {items.length === 0 ? (
        <EmptyState title="등록된 공지사항이 없어요." description="위에서 새 공지사항을 작성해보세요." />
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {items.map((a) => (
            <AnnouncementRow
              key={a.id}
              id={a.id}
              title={a.title}
              content={a.content}
              createdAtLabel={formatDate(a.createdAt)}
              updatedAtLabel={formatDate(a.updatedAt)}
              wasEdited={a.updatedAt.getTime() !== a.createdAt.getTime()}
              authorNickname={a.createdByNickname}
            />
          ))}
        </div>
      )}

      <Pagination basePath="/admin/announcements" currentSearchParams={{}} page={page} totalPages={totalPages} />
    </div>
  );
}
