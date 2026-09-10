"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  appointAdminAction,
  removeAdminAction,
  removeMemberAction,
} from "@/app/(main)/organizations/[id]/settings/actions";
import { Button } from "@/components/ui/Button";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(date);
}

type Member = {
  id: number;
  role: "leader" | "admin" | "member";
  joinedAt: Date;
  user: { id: number; nickname: string | null; publicId: string };
};

const ROLE_LABELS = { leader: "대표 관리자", admin: "관리자", member: "구성원" } as const;

// Phase 12-4 §16-19: 각 행의 버튼은 여기서 "보여줄지 말지"만 결정하고,
// 실제 허용 여부는 각 Server Action -> service 함수의 canAppointAdmin/
// canRemoveMember가 다시 판정한다(이 컴포넌트가 잘못 계산해도 서버가
// 최종 방어선). 매트릭스(§17-19)를 그대로 반영:
//   - LEADER: MEMBER를 ADMIN으로 임명, ADMIN을 MEMBER로 해임, MEMBER/ADMIN
//     모두 강제 제거 가능.
//   - ADMIN: MEMBER만 강제 제거 가능(ADMIN 임명/해임 불가, 다른 ADMIN 제거 불가).
//   - 본인 행에는 어떤 액션 버튼도 보여주지 않는다(자진 탈퇴는 단체
//     프로필의 OrganizationJoinControls 전용).
export function OrganizationMemberManagement({
  organizationId,
  members,
  myRole,
  myUserId,
}: {
  organizationId: number;
  members: Member[];
  myRole: "leader" | "admin";
  myUserId: number;
}) {
  const router = useRouter();
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ error: string } | { ok: true }>, targetUserId: number) {
    setPendingUserId(targetUserId);
    setError(null);
    const result = await action();
    setPendingUserId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const isSelf = member.user.id === myUserId;
          const busy = pendingUserId === member.user.id;

          const canAppoint = myRole === "leader" && member.role === "member" && !isSelf;
          const canDemote = myRole === "leader" && member.role === "admin" && !isSelf;
          const canRemove =
            !isSelf &&
            member.role !== "leader" &&
            (myRole === "leader" ? true : member.role === "member");

          return (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">
                  {member.user.nickname ?? "닉네임 미설정"} {isSelf && <span className="text-muted-foreground">(나)</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ROLE_LABELS[member.role]} · 가입일 {formatDate(member.joinedAt)}
                </span>
              </div>

              {(canAppoint || canDemote || canRemove) && (
                <div className="flex gap-2">
                  {canAppoint && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => appointAdminAction(organizationId, member.user.id), member.user.id)}
                    >
                      ADMIN 임명
                    </Button>
                  )}
                  {canDemote && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => removeAdminAction(organizationId, member.user.id), member.user.id)}
                    >
                      ADMIN 해임
                    </Button>
                  )}
                  {canRemove && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`${member.user.nickname ?? "이 구성원"}을(를) 단체에서 제거하시겠습니까?`)) return;
                        run(() => removeMemberAction(organizationId, member.user.id), member.user.id);
                      }}
                    >
                      제거
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
