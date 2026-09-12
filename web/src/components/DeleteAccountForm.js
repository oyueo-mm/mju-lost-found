"use client";

import { useActionState } from "react";
import { deleteMyAccount } from "@/lib/account-actions";

export default function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteMyAccount, null);

  return (
    <form action={action} className="space-y-3">
      <div className="rounded-lg border border-line bg-sunken p-4 text-sm leading-relaxed text-ink-soft">
        탈퇴하면 다음 데이터가 <b className="text-ink">즉시·영구 삭제</b>되고
        되돌릴 수 없어요.
        <ul className="mt-2 space-y-1 text-[13px]">
          <li>· 프로필(닉네임·학과·명지도)</li>
          <li>· 등록한 분실물·습득물 게시글과 사진</li>
          <li>· 작성한 댓글</li>
          <li>· 참여한 채팅방과 대화 내용 (상대방 화면에서도 사라져요)</li>
          <li>· 매칭·알림·신고 기록</li>
        </ul>
        <p className="mt-2 text-[13px]">
          같은 Google 계정으로 다시 가입할 수 있지만, 이전 데이터는 복구되지
          않아요.
        </p>
      </div>

      <label className="block text-sm">
        <span className="font-semibold">
          확인을 위해 <b className="text-brand">탈퇴</b> 를 입력하세요
        </span>
        <input
          name="confirm"
          autoComplete="off"
          placeholder="탈퇴"
          className="field mt-1"
        />
      </label>

      {state?.error && (
        <p className="text-sm text-brand-deep">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn w-full bg-rose-500 py-3 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:opacity-60"
      >
        {pending ? "처리 중…" : "회원 탈퇴"}
      </button>
    </form>
  );
}
