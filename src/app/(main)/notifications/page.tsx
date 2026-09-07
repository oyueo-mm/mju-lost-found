import { requireReadyUser } from "@/lib/auth/session";
import {
  getUnreadNotificationCount,
  listNotifications,
  NOTIFICATION_TYPE_LABELS,
} from "@/lib/notification/service";
import { resolveHref } from "./resolveHref";
import { NotificationItem } from "@/components/notification/NotificationItem";
import { MarkAllReadButton } from "@/components/notification/MarkAllReadButton";
import { Pagination } from "@/components/search/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/notification/schema";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireReadyUser("notification", "/notifications"); // redirects to /login or /onboarding as needed

  const raw = await searchParams;
  const pageParam = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : DEFAULT_PAGE;

  let unreadCount = 0;
  let result;
  let loadError = false;
  try {
    [unreadCount, result] = await Promise.all([
      getUnreadNotificationCount(user.id),
      listNotifications(user.id, { page, limit: DEFAULT_LIMIT }),
    ]);
  } catch (error) {
    console.error("Failed to load notifications", error);
    loadError = true;
  }

  if (loadError || !result) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">알림</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          알림을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  const items = await Promise.all(
    result.items.map(async (n) => ({
      ...n,
      typeLabel: NOTIFICATION_TYPE_LABELS[n.type] ?? n.type,
      createdAtLabel: formatDate(n.createdAt),
      href: await resolveHref(user.id, n.type, n.relatedType, n.relatedId),
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">
          읽지 않은 알림 {unreadCount}개
        </h1>
        <MarkAllReadButton disabled={unreadCount === 0} />
      </div>

      {items.length === 0 ? (
        <EmptyState title="새로운 알림이 없어요." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((n) => (
            <NotificationItem
              key={n.id}
              id={n.id}
              type={n.type}
              title={n.title}
              content={n.content}
              typeLabel={n.typeLabel}
              isRead={n.isRead}
              createdAt={n.createdAtLabel}
              href={n.href}
            />
          ))}
        </div>
      )}

      <Pagination
        basePath="/notifications"
        currentSearchParams={{}}
        page={result.page}
        totalPages={result.totalPages}
      />
    </div>
  );
}
