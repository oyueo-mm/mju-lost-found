"use client";

import { useState, useSyncExternalStore } from "react";

import { ThankReviewDialog } from "@/components/thanks/ThankReviewDialog";
import { useI18n } from "@/lib/i18n/client";

const subscribeStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

// 물건 반환이 완료되었습니다 (Phase 3-B): the system card where this room's
// return was recorded, placed in the conversation at that time. To the one
// who got the item back (and may thank -- the server decided) it adds
// 감사 후기 남기기 / 나중에 하기. 나중에 하기 only folds the choice into a
// small link, remembered for this return on this device; nothing about the
// completion changes either way.
export function ReturnCompletedCard({
  time,
  returnId,
  thank,
}: {
  time: string;
  returnId: number;
  thank: { postType: "lost" | "found"; postId: number; receiverName: string | null; postTitle: string; postImageUrl: string | null } | null;
}) {
  const { t } = useI18n();
  const laterKey = `mju-find:thanks-later:${returnId}`;
  const [laterNow, setLater] = useState(false);
  const laterStored = useSyncExternalStore(subscribeStorage, () => window.localStorage.getItem(laterKey) === "1", () => false);
  const later = laterNow || laterStored;

  return (
    <div className="my-3 flex justify-center" data-return-completed>
      <section role="status" className="flex w-full max-w-sm flex-col items-center gap-2.5 rounded-card border border-success/30 bg-success-muted px-4 py-3 text-center text-sm">
        <p className="font-semibold text-success">{t("chat.returned.title")}</p>
        <p className="-mt-1.5 text-xs text-muted-foreground">{time}</p>
        {thank &&
          (later ? (
            <ThankReviewDialog {...thank} triggerLabel={t("thanks.review.open")} triggerStyle="link" />
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              <ThankReviewDialog {...thank} triggerLabel={t("thanks.review.open")} />
              <button
                type="button"
                onClick={() => {
                  window.localStorage.setItem(laterKey, "1");
                  setLater(true);
                }}
                className="min-h-9 rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
              >
                {t("thanks.review.later")}
              </button>
            </div>
          ))}
      </section>
    </div>
  );
}
