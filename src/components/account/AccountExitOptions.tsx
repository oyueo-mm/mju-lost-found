import { WithdrawButton } from "@/app/(main)/me/withdraw/WithdrawButton";
import { AlertIcon } from "@/components/icons";

// 회원탈퇴: the two ways to leave, side by side so the difference is clear.
// Used by /me/withdraw and by /suspended (a suspended account can't reach
// /me, but may still leave). Every line describes what the code actually
// does: auth/user.ts::withdrawUser (deactivation) and
// auth/withdrawal.ts::withdrawAccount (회원탈퇴).
export function AccountExitOptions() {
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-5 text-sm text-foreground">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">계정 비활성화 (복구 가능)</h2>
          <p className="text-muted-foreground">잠시 쉬고 싶을 때 선택하세요.</p>
        </div>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>닉네임, 게시글, 댓글, 채팅 등 계정 데이터는 삭제되지 않고 그대로 보존됩니다.</li>
          <li>알림은 함께 삭제됩니다.</li>
          <li>
            같은 Google 계정으로 다시 로그인하면 이 계정이 그대로{" "}
            <span className="font-medium text-foreground">재활성화</span>되어 기존 데이터를 이어서 사용할 수 있습니다.
          </li>
        </ul>
        <WithdrawButton mode="deactivate" />
      </section>

      <section className="flex flex-col gap-4 rounded-card border border-destructive/40 bg-card p-5 text-sm text-foreground">
        <div className="flex items-center gap-1.5 font-semibold">
          <AlertIcon className="size-4.5 text-destructive" />
          회원탈퇴 (복구 불가)
        </div>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
          <li>
            이메일, Google 계정 정보, 이름, 닉네임, 동의 기록, 최근 로그인 기록이 삭제되며{" "}
            <span className="font-medium text-foreground">계정을 다시 복구할 수 없습니다.</span>
          </li>
          <li>
            다시 이용하려면 새 계정으로 가입해야 하며, 이전 게시글·댓글·채팅은 새 계정과 연결되지 않습니다.
          </li>
          <li>
            게시글과 이미지는 삭제됩니다. 다른 이용자의 댓글이 달린 게시글은 내용과 이미지를 지운 비공개 상태로
            남습니다.
          </li>
          <li>
            댓글은 삭제되며, 다른 이용자의 답글이 달린 댓글은 &lsquo;삭제된 댓글&rsquo;로 표시됩니다.
          </li>
          <li>
            주고받은 채팅 메시지는 상대방의 대화 기록이므로 &lsquo;탈퇴한 사용자&rsquo;로 표시된 채 남고, 보낸 사진은
            삭제됩니다.
          </li>
          <li>알림, 키워드 알림, 단체 구성원 정보, 외부 관계자 승인은 삭제됩니다.</li>
          <li>
            처리 중인 신고의 대상 콘텐츠, 신고·제재·이의신청 기록은 운영상 필요한 범위에서 계정 식별정보 없이
            보관됩니다.
          </li>
          <li>
            이용 정지 중이거나 처리 중인 신고·제재·이의신청이 있는 상태에서 탈퇴하면, 같은 Google 계정으로 다시
            가입할 때 관리자 승인이 필요합니다.
          </li>
        </ul>
        <WithdrawButton mode="delete" />
      </section>
    </div>
  );
}
