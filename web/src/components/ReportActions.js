"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { handleReport } from "@/lib/admin-actions";

export default function ReportActions({ reportId, hasAuthor }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (action, confirmMsg) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    startTransition(async () => {
      await handleReport(reportId, action);
      router.push("/admin/reports");
      router.refresh();
    });
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              "delete_target",
              "신고된 대상을 삭제/숨김 처리하고 신고를 인용할까요? 대상 사용자의 명지도가 3%p 내려가요.",
            )
          }
          className="btn btn-primary px-3.5 py-1.5 text-xs"
        >
          대상 삭제 + 처리
        </button>
        {hasAuthor && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                "suspend_author",
                "작성자를 7일 정지할까요? 명지도도 3%p 내려가요.",
              )
            }
            className="btn px-3.5 py-1.5 text-xs text-brand-deep hover:bg-brand-tint"
          >
            작성자 7일 정지
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              "resolve",
              "신고를 인용 처리할까요? 대상 사용자의 명지도가 3%p 내려가요.",
            )
          }
          className="btn btn-ghost px-3.5 py-1.5 text-xs"
        >
          인용 (처리 완료)
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run("dismiss")}
          className="btn px-3.5 py-1.5 text-xs text-ink-faint hover:bg-sunken"
        >
          기각
        </button>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        기각을 제외한 처리는 “신고 인용”으로 간주되어 대상 사용자의 명지도가
        3%p 내려가요.
      </p>
    </div>
  );
}
