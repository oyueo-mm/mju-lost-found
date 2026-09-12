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
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { LOCALE_INTL_TAG, type Locale } from "@/lib/i18n/config";

// 다국어(i18n) Phase: 하드코딩된 "ko-KR" 대신 현재 언어의 Intl 태그.
// 타임존은 언제나 Asia/Seoul 그대로다. NOTIFICATION_TYPE_LABELS(알림
// 유형 라벨)는 서비스 계층이 소유한 한국어 문구라 이번 범위 밖이다 --
// 알림 제목/본문 자체도 DB에 저장된 한국어 문장이므로 함께 남는다.
function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_INTL_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireReadyUser("notification", "/notifications"); // redirects to /login or /onboarding as needed

  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
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
        <h1 className="text-xl font-semibold text-foreground">{t("notification.title")}</h1>
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          {t("notification.loadError")}
        </div>
      </div>
    );
  }

  const items = await Promise.all(
    result.items.map(async (n) => ({
      ...n,
      typeLabel: NOTIFICATION_TYPE_LABELS[n.type] ?? n.type,
      createdAtLabel: formatDate(n.createdAt, locale),
      href: await resolveHref(user.id, n.type, n.relatedType, n.relatedId),
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">
          {t("notification.unreadHeading", { count: unreadCount })}
        </h1>
        <MarkAllReadButton disabled={unreadCount === 0} />
      </div>

      {items.length === 0 ? (
        <EmptyState title={t("notification.empty")} />
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
