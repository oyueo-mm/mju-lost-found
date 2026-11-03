import { requireReadyUser } from "@/lib/auth/session";
import { listReceivedThankNotes } from "@/lib/thanks/service";
import { ReceivedThankNotes } from "@/components/thanks/ReceivedThankNotes";

const day = (d: Date) => new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(d);

// 받은 감사 쪽지 (only the receiver's own notes).
export default async function MyThankNotesPage() {
  const user = await requireReadyUser("mypost", "/me/thanks");

  let notes;
  try {
    notes = await listReceivedThankNotes(user.id);
  } catch (error) {
    console.error("Failed to load thank notes", error);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">받은 감사 쪽지</h1>
        <p className="text-xs leading-relaxed text-muted-foreground">
          물건을 돌려받은 분이 보낸 쪽지예요. 기본은 나만 보기이며, 공개하면 보낸 분 없이 내 프로필에 표시돼요. 게시글의 완료 표시를 바탕으로 한 쪽지라 실제 반환을 서비스가 확인한 것은 아니에요.
        </p>
      </div>
      {!notes ? (
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">쪽지를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>
      ) : (
        <ReceivedThankNotes notes={notes} dateLabels={Object.fromEntries(notes.map((n) => [n.id, day(n.createdAt)]))} />
      )}
    </div>
  );
}
