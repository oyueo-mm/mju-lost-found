"use client";

import { useState, useTransition } from "react";
import {
  setUserSuspension,
  liftSuspension,
  setUserRole,
  adminDeleteUser,
} from "@/lib/admin-actions";
import { SUSPENSION_REASONS } from "@/lib/constants";

const DURATIONS = [
  ["1", "1일"],
  ["3", "3일"],
  ["7", "7일"],
  ["30", "30일"],
  ["0", "영구"],
];

export default function AdminUserControls({
  userId,
  role,
  isSuspended,
  self,
  isOwner = false,
  allowDelete = false,
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState(SUSPENSION_REASONS[0]);

  if (isOwner) {
    return (
      <p className="mt-2 text-xs text-ink-faint">
        총관리자 계정은 정지·강등·삭제할 수 없어요. 권한 변경은 데이터베이스에서만
        가능해요.
      </p>
    );
  }

  const call = (fn) =>
    startTransition(async () => {
      setErr(null);
      const r = await fn();
      if (r?.error) setErr(r.error);
      else setOpen(false);
    });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {isSuspended ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => call(() => liftSuspension(userId))}
          className="btn btn-ghost px-3 py-1 text-xs"
        >
          정지 해제
        </button>
      ) : open ? (
        <div className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-line bg-sunken p-2">
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none"
          >
            {DURATIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none"
          >
            {SUSPENSION_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                confirm(
                  `${days === "0" ? "영구" : days + "일"} 정지할까요?\n사유: ${reason}`,
                )
              )
                call(() => setUserSuspension(userId, days, reason));
            }}
            className="btn btn-primary px-3 py-1 text-xs"
          >
            적용
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn btn-ghost px-2 py-1 text-xs"
          >
            취소
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending || self}
          onClick={() => setOpen(true)}
          className="btn btn-ghost px-3 py-1 text-xs"
        >
          정지…
        </button>
      )}

      {!self && !open && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            call(() =>
              setUserRole(userId, role === "admin" ? "user" : "admin"),
            )
          }
          className="btn btn-ghost px-3 py-1 text-xs"
        >
          {role === "admin" ? "관리자 해제" : "관리자로 지정"}
        </button>
      )}

      {allowDelete && !self && !open && role !== "admin" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (
              confirm(
                "이 계정을 완전히 삭제할까요?\n게시글·사진·댓글·채팅이 모두 사라지고 되돌릴 수 없어요.\n(제재 목적이면 '영구 정지'를 쓰세요.)",
              )
            )
              call(() => adminDeleteUser(userId));
          }}
          className="btn px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
        >
          계정 삭제
        </button>
      )}

      {err && <span className="text-xs text-brand-deep">{err}</span>}
    </div>
  );
}
