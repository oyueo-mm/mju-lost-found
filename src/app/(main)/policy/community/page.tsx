// Phase 9: grounded in the actual moderation system already implemented
// -- REPORT_REASONS (src/lib/report/schema.ts), ModerationActionType
// (prisma/schema.prisma: DELETE_POST/HIDE_MESSAGE/DELETE_COMMENT/
// SUSPEND_USER), and SuspensionAppeal. Nothing here describes a process
// this app doesn't actually run.
type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "1. 목적",
    body: "이 운영정책은 명지 스마트 분실물 센터를 모든 이용자가 안전하게 이용할 수 있도록, 금지행위와 신고·조치 절차를 안내합니다.",
  },
  {
    title: "2. 금지행위",
    body: (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>사기 또는 허위 정보 게시</li>
        <li>부적절한 내용의 게시물·댓글·메시지 작성</li>
        <li>욕설·비방 등 다른 이용자에 대한 공격적인 표현</li>
        <li>본인 또는 타인의 개인정보를 부적절하게 노출하는 행위</li>
        <li>도배·스팸성 게시물 반복 작성</li>
      </ul>
    ),
  },
  {
    title: "3. 신고",
    body: (
      <>
        게시물, 댓글, 채팅 메시지, 사용자를 각각 신고할 수 있습니다. 신고 시 사유를 선택하고 상세
        내용을 함께 남길 수 있습니다. 동일한 대상에 대한 반복적인 중복 신고는 제한될 수 있습니다.
      </>
    ),
  },
  {
    title: "4. 처리 절차",
    body: (
      <>
        접수된 신고는 관리자가 검토하여 처리 대기, 반려, 조치 완료 중 하나의 상태로 처리합니다.
        조치가 필요하다고 판단되면 다음 중 하나가 적용될 수 있습니다.
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>게시물 삭제</li>
          <li>채팅 메시지 숨김</li>
          <li>댓글 삭제</li>
          <li>계정 정지</li>
        </ul>
      </>
    ),
  },
  {
    title: "5. 계정 정지 및 이의신청",
    body: "위반이 반복되거나 심각하다고 판단되는 경우 계정이 정지될 수 있습니다. 정지 기간이 정해질 수도, 정해지지 않을 수도 있습니다. 정지된 이용자는 서비스 내 이의신청 기능을 통해 소명할 수 있으며, 관리자가 이를 검토합니다.",
  },
  {
    title: "6. 콘텐츠에 대한 책임",
    body: "게시물, 댓글, 채팅 메시지 등 이용자가 작성한 콘텐츠에 대한 책임은 작성자 본인에게 있으며, 관리자의 조치는 서비스 이용 환경을 보호하기 위한 것입니다.",
  },
];

export default function CommunityPolicyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">정책</p>
        <h1 className="text-xl font-semibold text-foreground">운영정책</h1>
      </div>

      <div className="flex flex-col gap-5 rounded-card border border-border bg-card p-5 text-sm text-foreground">
        {SECTIONS.map((section, i) => (
          <section
            key={section.title}
            className={`flex flex-col gap-1.5 ${i > 0 ? "border-t border-border pt-5" : ""}`}
          >
            <h2 className="font-semibold">{section.title}</h2>
            <div className="text-muted-foreground">{section.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
