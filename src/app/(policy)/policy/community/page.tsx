// Phase 9: grounded in the actual moderation system already implemented
// -- REPORT_REASONS (src/lib/report/schema.ts), ModerationActionType
// (prisma/schema.prisma: DELETE_POST/HIDE_MESSAGE/DELETE_COMMENT/
// SUSPEND_USER), and SuspensionAppeal. Nothing here describes a process
// this app doesn't actually run.
//
// 운영정책 보강 Phase: 아래 각 섹션을 실제 코드와 다시 대조해서 손봤다 --
// report/service.ts::createReport()의 @@unique([reporterUserId,
// targetType, targetId]) 제약은 "같은 신고자가 같은 대상을 다시 신고할 수
// 없다"는 사실이지 "제한될 수 있다"는 모호한 가능성이 아니고(3번), 신고
// 접수 자체가 콘텐츠를 자동/임시로 숨기는 코드는 이 앱에 없으며(4번,
// moderation/service.ts::applyReportAction()은 관리자가 실제로 조치를
// 적용해야만 삭제/숨김/정지가 일어난다), 정지는 admin/users.ts::
// updateUserByAdmin()과 applyReportAction() 둘 다 suspendDurationDays가
// 있으면 그 날짜만큼, 없으면 suspendedUntil: null(영구)로 남긴다(5번).
// moderation/appeals.ts::submitSuspensionAppeal()/
// markSuspensionAppealReviewed()는 승인/거절 상태가 없는 "제출 -> 검토됨"
// 뿐인 구조이고, 실제 정지 해제는 그와 별도로 admin/users.ts의 기존
// "정지 해제" 토글을 관리자가 따로 눌러야 일어난다(6번) -- 정책 문구가 이
// 구조와 다르게 "자동 해제"나 "승인/기각 결정"을 암시하지 않도록 했다.
//
// 신고·임시 숨김 반영: 신고 사유는 report/schema.ts::REPORT_REASONS 그대로,
// 긴급 신고는 isUrgentReportReason()(관리자 목록 최상단·[긴급] 알림), 임시
// 숨김은 moderation/service.ts의 temp_hide_post/temp_hide_comment(권리침해
// 사유 4가지 + 게시물·댓글만, 관리자 처리로만 적용, 삭제 아님 -- 작성자·
// 관리자는 계속 볼 수 있음)와 tempHiddenNotice()의 안내 문구('서비스 개선
// 제안'), 해제는 restoreTempHiddenContent()(RESTORE_* 기록 + 작성자 알림)를
// 따른다. 조치·해제 기록은 ModerationAction(조치 종류·관리자·사유·일시).
type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "1. 목적",
    body: "이 운영정책은 MYONGJI L&F를 모든 이용자가 안전하게 이용할 수 있도록, 금지행위와 신고·조치 절차를 안내합니다.",
  },
  {
    title: "2. 금지행위",
    body: (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>존재하지 않는 분실물·습득물을 등록하거나 고의로 사실과 다른 정보를 게시하는 행위</li>
        <li>타인의 물건을 자신의 물건이라고 주장하는 등 허위 또는 부정한 소유권 주장을 통해 물건을 취득하려는 행위</li>
        <li>물건 반환을 빌미로 부당한 금전 또는 대가를 요구하거나 다른 이용자를 부당하게 압박하는 행위</li>
        <li>욕설, 비방, 괴롭힘 등 다른 이용자에 대한 공격적인 행위</li>
        <li>음란·폭력적이거나 서비스 목적에 현저히 부적절한 콘텐츠 게시</li>
        <li>본인 또는 타인의 개인정보를 부적절하게 노출하는 행위</li>
        <li>도배·스팸·서비스 목적과 무관한 반복적인 홍보</li>
        <li>고의로 사실과 다른 신고를 제출하거나 신고 기능을 악용하는 행위</li>
        <li>서비스의 정상적인 운영을 방해하는 행위</li>
        <li>관련 법령을 위반하거나 서비스의 안전한 이용 환경을 현저하게 해치는 행위</li>
      </ul>
    ),
  },
  {
    title: "3. 신고",
    body: (
      <>
        게시물, 댓글, 채팅 메시지, 사용자를 각각 신고할 수 있습니다. 신고 시 아래 사유 중 하나를
        선택하고 상세 내용을 함께 남길 수 있습니다.
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>사기/허위 정보</li>
          <li>부적절한 내용</li>
          <li>욕설/비방</li>
          <li>개인정보 노출</li>
          <li>사생활 침해</li>
          <li>명예훼손</li>
          <li>불법 성적 콘텐츠(불법촬영물·성착취물 등)</li>
          <li>도배/스팸</li>
          <li>기타</li>
        </ul>
        <p className="mt-2">
          불법촬영물·성착취물 등 불법 성적 콘텐츠 신고는 긴급 신고로 분류되어 관리자에게 긴급
          알림으로 전달되고, 관리자 신고 목록에서 다른 신고보다 먼저 표시되어 우선 처리됩니다.
        </p>
        <p className="mt-2">
          같은 이용자는 이미 신고한 동일한 대상을 다시 신고할 수 없습니다. 사실과 다른 신고를
          고의로 제출하거나 신고 기능을 악용하는 행위는 금지행위에 해당하며, 필요한 경우 계정 제재
          대상이 될 수 있습니다.
        </p>
      </>
    ),
  },
  {
    title: "4. 처리 절차",
    body: (
      <>
        접수된 신고는 관리자가 검토하여 처리 대기, 반려, 조치 완료 중 하나의 상태로 처리합니다.
        신고가 접수되었다는 사실만으로 콘텐츠가 자동으로 숨겨지거나 제한되지는 않으며, 조치가
        필요하다고 판단되면 다음 중 하나가 적용될 수 있습니다.
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>게시물 삭제</li>
          <li>게시물 임시 숨김</li>
          <li>채팅 메시지 숨김</li>
          <li>댓글 삭제</li>
          <li>댓글 임시 숨김</li>
          <li>계정 정지</li>
        </ul>
        <p className="mt-2">
          관리자는 위반 내용과 정도, 반복 여부, 고의성, 다른 이용자에게 발생했거나 발생할 수 있는
          피해, 서비스 이용 환경에 미치는 영향 등을 종합적으로 고려하여 조치 여부와 수준을
          판단하며, 모든 위반에 동일한 조치가 자동으로 적용되는 것은 아닙니다.
        </p>
        <p className="mt-2">
          관리자의 조치와 임시 숨김 해제는 조치 종류, 처리한 관리자, 처리 일시가 서비스 내부에
          기록되며, 관리자가 사유를 입력한 경우 그 사유도 함께 기록됩니다.
        </p>
      </>
    ),
  },
  {
    title: "5. 임시 숨김",
    body: (
      <>
        개인정보 노출, 사생활 침해, 명예훼손, 불법 성적 콘텐츠 사유로 신고된 게시물과 댓글은
        관리자 검토를 거쳐 임시 숨김 처리될 수 있습니다.
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>
            임시 숨김은 삭제와 다릅니다. 콘텐츠는 삭제되지 않고 보존되며, 검토가 끝날 때까지 다른
            이용자에게 보이지 않습니다.
          </li>
          <li>
            임시 숨김된 게시물은 목록, 검색, 추천에 표시되지 않으며, 작성자와 관리자만 내용을 볼 수
            있습니다. 임시 숨김된 댓글은 내용과 작성자 대신 숨김 안내만 표시됩니다.
          </li>
          <li>
            임시 숨김이 적용되면 작성자에게 조치 사실과 함께, 이의가 있는 경우 &lsquo;서비스 개선
            제안&rsquo;으로 알려달라는 안내가 알림으로 전달됩니다. 신고자가 누구인지는 공개되지
            않습니다.
          </li>
          <li>
            관리자는 검토 결과에 따라 임시 숨김을 해제할 수 있으며, 해제되면 콘텐츠가 다시 공개되고
            작성자에게 알림이 전달됩니다.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: "6. 계정 정지 및 이의신청",
    body: (
      <>
        위반이 반복되거나 심각하다고 판단되는 경우 계정 이용이 제한될 수 있습니다. 위반 정도와
        반복 여부 등에 따라 일정 기간 동안 또는 별도의 종료 시점을 정하지 않고 이용이 제한될 수
        있습니다. 정지된 이용자는 서비스 내 이의신청 기능을 통해 소명하거나 추가 정보를 제출할 수
        있습니다. 관리자는 제출된 내용을 검토하며, 필요한 경우 별도의 조치를 통해 이용 제한을
        변경하거나 해제할 수 있습니다.
      </>
    ),
  },
  {
    title: "7. 콘텐츠에 대한 책임",
    body: (
      <>
        이용자는 자신이 작성한 게시물, 댓글, 채팅 메시지 등 콘텐츠가 관련 법령과 본 운영정책을
        준수하도록 할 책임이 있습니다. 관리자의 조치는 이 운영정책에 따라 서비스 이용 환경을
        보호하기 위해 취해지는
        서비스 내부 조치이며, 콘텐츠에 대한 법적 책임 유무를 판단하는 절차가 아닙니다.
      </>
    ),
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
