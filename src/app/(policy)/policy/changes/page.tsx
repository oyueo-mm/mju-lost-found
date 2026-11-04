import Link from "next/link";

import { LATEST_PRIVACY_POLICY_REVISION } from "@/lib/policy/privacyPolicy";
import { TERMS_REVISIONS } from "@/lib/policy/termsRevisions";
import { getTranslator } from "@/lib/i18n/server";

// 변경 내용 확인 (the policy-revision notification's link): what changed in the
// latest revision of each document, its 시행일, and links to the current text
// and the earlier versions. The documents themselves stay Korean, as before;
// this short summary page follows the reader's language.
export default async function PolicyChangesPage() {
  const t = await getTranslator();
  const terms = TERMS_REVISIONS[0];
  const privacy = LATEST_PRIVACY_POLICY_REVISION;
  const item = (title: string, date: string, summary: string, current: string, history: string) => (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-card p-5">
      <h2 className="font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted-foreground">
        {t("policyChanges.effective")}: <time dateTime={date}>{date}</time>
      </p>
      <p className="text-foreground [overflow-wrap:anywhere]">{summary}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href={current} className="font-medium text-primary hover:opacity-80">
          {t("policyChanges.viewCurrent")}
        </Link>
        <Link href={history} className="font-medium text-primary hover:opacity-80">
          {t("policyChanges.viewPrevious")}
        </Link>
      </div>
    </section>
  );
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 text-sm leading-relaxed">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-foreground">{t("policyChanges.title")}</h1>
        <p className="text-muted-foreground">{t("policyChanges.intro")}</p>
      </div>
      {item(t("policyChanges.terms"), terms.date, terms.summary, "/policy/terms", "/policy/terms/history")}
      {item(t("policyChanges.privacy"), privacy.date, privacy.summary, "/policy/privacy", "/policy/privacy/history")}
      <p className="text-xs text-muted-foreground">{t("policyChanges.note")}</p>
    </div>
  );
}
