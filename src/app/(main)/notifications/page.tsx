import { requireReadyUser } from "@/lib/auth/session";
import {
  getUnreadNotificationCount,
  listNotifications,
  NOTIFICATION_TYPE_LABELS,
} from "@/lib/notification/service";
import { getOwnedPostRefForMatch } from "@/lib/match/service";
import { NotificationItem } from "@/components/notification/NotificationItem";
import { MarkAllReadButton } from "@/components/notification/MarkAllReadButton";
import { Pagination } from "@/components/search/Pagination";
import { DEFAULT_LIMIT, DEFAULT_PAGE } from "@/lib/notification/schema";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// Resolves a notification's relatedType/relatedId into a link to
// navigate to, when there's something to link to. Composed here at the
// page level (not inside the notification service, see Phase 9 spec
// section 16) so that service stays free of any dependency on the match
// domain. A missing/deleted related resource (or a type this app doesn't
// yet build a page for, e.g. "message" -- chat isn't implemented) simply
// yields no link; the notification itself still renders normally either
// way.
async function resolveHref(
  userId: number,
  relatedType: string | null,
  relatedId: number | null,
): Promise<string | null> {
  if (relatedType !== "match" || relatedId === null) return null;
  const ref = await getOwnedPostRefForMatch(relatedId, userId);
  return ref ? `/post/${ref.id}?type=${ref.type}` : null;
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireReadyUser(); // redirects to /login or /onboarding as needed

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
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">알림</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          알림을 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.
        </div>
      </div>
    );
  }

  const items = await Promise.all(
    result.items.map(async (n) => ({
      ...n,
      typeLabel: NOTIFICATION_TYPE_LABELS[n.type] ?? n.type,
      createdAtLabel: formatDate(n.createdAt),
      href: await resolveHref(user.id, n.relatedType, n.relatedId),
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          읽지 않은 알림 {unreadCount}개
        </h1>
        <MarkAllReadButton disabled={unreadCount === 0} />
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          새로운 알림이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((n) => (
            <NotificationItem
              key={n.id}
              id={n.id}
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
