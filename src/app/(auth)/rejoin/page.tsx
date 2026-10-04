import { redirect } from "next/navigation";

import { getCurrentUser, getRejoinIdentityId } from "@/lib/auth/session";
import { getRejoinState } from "@/lib/auth/rejoin";
import { RejoinForm } from "@/components/auth/RejoinForm";
import { AlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { leaveRejoinAction, startNewAccountAction } from "./actions";

// 회원탈퇴: shown instead of creating an account when a Google account that
// was withdrawn with a sanction matter still open signs in again (see
// auth/user.ts::resolveSignIn). The old account is never restored: an
// approved request only lets the next sign-in create a brand-new account.
export default async function RejoinPage() {
  if (await getCurrentUser()) redirect("/");
  const identityId = await getRejoinIdentityId();
  if (!identityId) redirect("/login");
  const state = await getRejoinState(identityId);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="flex w-full max-w-md flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-muted text-foreground">
            <AlertIcon className="size-7" />
          </span>
          <h1 className="text-xl font-semibold text-foreground">재가입 요청이 필요합니다</h1>
          <p className="text-sm text-muted-foreground">
            이 Google 계정은 이용 제한 또는 처리 중인 신고·제재 절차가 있는 상태에서 회원탈퇴했습니다. 관리자가
            요청을 승인하면 새 계정으로 가입할 수 있습니다. 이전 계정과 게시글·댓글·채팅은 복구되거나 새 계정에
            연결되지 않습니다.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 text-sm">
          {state === null || state.kind === "approved" ? (
            state === null ? (
              <p className="text-muted-foreground">
                보류가 해제되었거나 요청 상태를 확인할 수 없습니다. 로그아웃한 뒤 다시 로그인하면 새 계정으로 가입할 수
                있습니다.
              </p>
            ) : (
              <>
                <p className="rounded-card border border-primary/30 bg-primary-muted px-4 py-3 text-primary">
                  재가입 요청이 승인되었습니다. 다시 로그인하면 새 계정이 만들어집니다.
                </p>
                <form action={startNewAccountAction}>
                  <Button type="submit" className="w-full">
                    Google 계정으로 새로 가입하기
                  </Button>
                </form>
              </>
            )
          ) : state.kind === "none" ? (
            <RejoinForm />
          ) : state.kind === "pending" ? (
            <p className="rounded-card border border-primary/30 bg-primary-muted px-4 py-3 text-primary">
              재가입 요청을 보냈습니다. 관리자 검토를 기다려주세요.
            </p>
          ) : (
            <p className="rounded-card border border-destructive/30 bg-destructive-muted px-4 py-3 text-destructive">
              재가입 요청이 거절되었습니다. 이 Google 계정으로는 가입할 수 없습니다.
            </p>
          )}
        </div>

        <form action={leaveRejoinAction} className="self-center">
          <button type="submit" className="text-sm text-muted-foreground underline hover:text-foreground">
            로그아웃
          </button>
        </form>
      </div>
    </div>
  );
}
