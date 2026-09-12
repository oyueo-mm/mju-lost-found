import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { markAllNotificationsRead } from "@/lib/notif-actions";
import { groupNotifications } from "@/lib/notif-group";
import NotificationList from "@/components/NotificationList";
import { getT } from "@/i18n/server";

export const metadata = { title: "알림 · 명지 분실물 센터" };

export default async function NotificationsPage() {
  const { user } = await requireUser();
  const t = await getT();
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const list = groupNotifications(items || []);
  const hasUnread = list.some((n) => n.unread);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold">{t("notif.title")}</h1>
        {hasUnread && (
          <form action={markAllNotificationsRead}>
            <button
              type="submit"
              className="btn px-3 py-1.5 text-sm text-ink-soft hover:bg-sunken"
            >
              {t("notif.readAll")}
            </button>
          </form>
        )}
      </div>

      <p className="mt-1 text-xs text-ink-faint">{t("notif.hint")}</p>

      <div className="mt-4">
        <NotificationList items={list} userId={user.id} />
      </div>
    </div>
  );
}
