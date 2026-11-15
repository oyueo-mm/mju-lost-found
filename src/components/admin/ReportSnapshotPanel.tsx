import { ko } from "@/lib/i18n/messages/ko";
import type { ReportSnapshot } from "@/lib/report/snapshot";
import type { EvidenceImageView } from "@/lib/report/evidenceView";

// Release C (M-1): 신고 당시 내용 -- the report's snapshot as it was filed,
// beside the live target above it. Server component; images are
// short-lived signed URLs from getReportEvidenceImages (reports.view).

function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
}

const IMAGE_STATUS_TEXT = {
  failed: "사진 사본을 만들지 못했습니다 (신고 시점에 원본을 복사할 수 없었음)",
  unsupported: "이전 저장소의 사진이라 사본을 만들 수 없었습니다",
} as const;

export function ReportSnapshotPanel({
  snapshot,
  images,
}: {
  snapshot: { takenAt: Date | null; purgedAt: Date | null; data: ReportSnapshot | null } | null | undefined;
  images: EvidenceImageView[] | null;
}) {
  if (!snapshot) {
    return <p className="text-sm text-muted-foreground">이 신고는 신고 시점 기록 기능 이전에 접수되어 당시 내용이 없습니다. 위의 현재 상태만 확인할 수 있습니다.</p>;
  }
  if (snapshot.purgedAt) {
    return <p className="text-sm text-muted-foreground">보관 기간(처리 후 1년)이 지나 {formatDate(snapshot.purgedAt)}에 신고 당시 내용과 사진 사본을 삭제했습니다.</p>;
  }
  const data = snapshot.data;
  if (!data) return <p className="text-sm text-warning">신고 당시 내용을 읽을 수 없습니다.</p>;
  const t = data.target;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="text-xs text-muted-foreground">기록 시각: {snapshot.takenAt ? formatDate(snapshot.takenAt) : "-"} · 이후 수정·삭제되어도 이 내용은 바뀌지 않습니다.</span>
      {t.kind === "post" ? (
        <>
          <span className="font-medium text-foreground">
            {t.postKind === "lost" ? "찾아요(분실물)" : "찾았어요(습득물)"} · {t.title}
          </span>
          <span className="whitespace-pre-line text-muted-foreground">{t.description}</span>
          <span className="text-xs text-muted-foreground">
            작성자: {t.authorNickname ?? "알 수 없음"} · {t.category} · {t.campus} · {t.location ?? "위치 미상"} · 상태: {t.status} · 작성일: {formatDate(t.createdAt)} · 마지막 수정: {formatDate(t.updatedAt)}
          </span>
        </>
      ) : t.kind === "message" ? (
        <>
          <span className="font-medium text-foreground">메시지{t.hidden ? " (신고 당시 이미 숨김 상태)" : ""}</span>
          <span className="whitespace-pre-line text-muted-foreground">{t.content || "(내용 없음 — 사진만 보냄)"}</span>
          <span className="text-xs text-muted-foreground">
            작성자: {t.senderNickname ?? "알 수 없음"} · 작성일: {formatDate(t.createdAt)}
            {t.editedAt ? ` · 수정됨 ${formatDate(t.editedAt)}` : ""}
          </span>
        </>
      ) : t.kind === "comment" ? (
        <>
          <span className="font-medium text-foreground">댓글{t.parentId !== null ? " (답글)" : ""}</span>
          <span className="whitespace-pre-line text-muted-foreground">{t.content}</span>
          <span className="text-xs text-muted-foreground">
            작성자: {t.authorNickname ?? "알 수 없음"} · 작성일: {formatDate(t.createdAt)} · 마지막 수정: {formatDate(t.updatedAt)}
          </span>
        </>
      ) : t.kind === "thank_note" ? (
        <>
          <span className="font-medium text-foreground">감사 후기</span>
          {t.tags.length > 0 && (
            <span className="text-xs text-primary">칭찬 태그: {t.tags.map((code) => ko[`thanks.tag.${code}` as keyof typeof ko] ?? code).join(", ")}</span>
          )}
          <span className="whitespace-pre-line text-muted-foreground">{t.body || "(감사 메시지 없음 — 칭찬 태그만 보냄)"}</span>
          <span className="text-xs text-muted-foreground">
            보낸 사람: {t.senderNickname ?? "알 수 없음"} · 받은 사람: {t.receiverNickname ?? "알 수 없음"} · 작성일: {formatDate(t.createdAt)}
          </span>
        </>
      ) : t.kind === "user" ? (
        <span className="text-muted-foreground">닉네임: {t.nickname ?? "알 수 없음"}</span>
      ) : (
        <span className="text-warning">알 수 없는 형식의 기록입니다.</span>
      )}
      {images && images.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-foreground">신고 당시 사진 ({images.length}장, 관리자 권한 확인 후 표시)</span>
          <div className="flex flex-wrap gap-2">
            {images.map((image) =>
              image.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, never optimized or cached
                <img
                  key={image.index}
                  src={image.url}
                  alt={`신고 당시 사진 ${image.index + 1}`}
                  referrerPolicy="no-referrer"
                  className="size-32 rounded-lg border border-border object-cover"
                />
              ) : (
                <span key={image.index} className="max-w-48 rounded-lg border border-border bg-muted p-2 text-xs text-muted-foreground">
                  사진 {image.index + 1}: {image.status === "copied" ? "사진 링크를 만들지 못했습니다" : IMAGE_STATUS_TEXT[image.status]}
                </span>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
