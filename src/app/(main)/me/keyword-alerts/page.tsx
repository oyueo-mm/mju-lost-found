import { requireReadyUser } from "@/lib/auth/session";
import { listKeywordAlerts } from "@/lib/keywordAlert/service";
import { KeywordAlertManager } from "@/components/keywordAlert/KeywordAlertManager";
import { getTranslator } from "@/lib/i18n/server";

// 키워드 알림 Phase: "mypost" LoginReason 재사용 -- /me/comments와 동일한
// 이유(src/lib/auth/session.ts의 LoginReason은 새 페이지마다 늘리지
// 않는다는 기존 관례, 그 파일 자신의 주석 참고). userId는 언제나 세션에서
// 만 오므로, 다른 사용자의 알림 규칙을 URL로 볼 수 있는 경로가 없다.
export default async function KeywordAlertsPage() {
  const user = await requireReadyUser("mypost", "/me/keyword-alerts");
  const t = await getTranslator();

  let alerts;
  try {
    alerts = await listKeywordAlerts(user);
  } catch (error) {
    console.error("Failed to load keyword alerts", error);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t("keywordAlert.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("keywordAlert.description")}</p>
      </div>

      {!alerts ? (
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          {t("common.networkError")}
        </div>
      ) : (
        <KeywordAlertManager alerts={alerts} />
      )}
    </div>
  );
}
