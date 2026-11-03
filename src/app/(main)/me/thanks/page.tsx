import { requireReadyUser } from "@/lib/auth/session";
import { listReceivedThankNotes } from "@/lib/thanks/service";
import { ReceivedThankNotes } from "@/components/thanks/ReceivedThankNotes";
import { getTranslator } from "@/lib/i18n/server";
import { LOCALE_INTL_TAG } from "@/lib/i18n/config";


// 받은 감사 쪽지 (only the receiver's own notes).
export default async function MyThankNotesPage() {
  const user = await requireReadyUser("mypost", "/me/thanks");
  const t = await getTranslator();
  const day = (d: Date) => new Intl.DateTimeFormat(LOCALE_INTL_TAG[t.locale], { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(d);

  let notes;
  try {
    notes = await listReceivedThankNotes(user.id);
  } catch (error) {
    console.error("Failed to load thank notes", error);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t("thanks.page.title")}</h1>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("thanks.page.intro")}</p>
      </div>
      {!notes ? (
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">{t("thanks.page.loadFailed")}</div>
      ) : (
        <ReceivedThankNotes notes={notes} dateLabels={Object.fromEntries(notes.map((n) => [n.id, day(n.createdAt)]))} />
      )}
    </div>
  );
}
