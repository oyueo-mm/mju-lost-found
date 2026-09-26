import Link from "next/link";

// Phase 9: written directly from this branch's actual implemented
// features (see comment/service.ts, chat/service.ts, report/service.ts,
// moderation/service.ts, prisma/schema.prisma) -- not a template, and not
// phrased as if reviewed by a lawyer. Nothing here claims an obligation,
// process, or right that the code doesn't actually provide (e.g. there is
// still no account-deletion feature, so this doesn't promise one).
//
// 이용약관 보강 Phase: 실제 기능(organization/service.ts의 단체 가입/
// 명의 게시·문의, recommendation/service.ts의 AI 추천, chat/service.ts::
// getOrCreateOrganizationChatRoom의 "단체에 문의하기")과 방금 확정한
// /policy/community 운영정책·개인정보처리방침을 다시 대조해서 손봤다.
// 이 약관 4조(구 버전)에 있던 5개 금지행위는 운영정책의 10개 항목과
// 이중으로 관리되며 어긋날 여지가 있었으므로 제거하고, 세부 금지행위와
// 신고·조치 기준은 운영정책 링크로 일원화했다(이용자의 의무 섹션 참고) --
// 이용약관은 서비스 이용 관계의 큰 틀만, 운영정책은 구체적인 금지행위·
// 신고·제재 기준만, 개인정보처리방침은 개인정보 수집·보관·파기만
// 다루도록 역할을 분리한다. 회원 비활성화/재활성화 설명은 개인정보
// 처리방침 6조·7조가 이미 상세히 다루므로 여기서는 요지만 링크로
// 연결한다(auth/user.ts::resolveOrCreateUser/withdrawUser 실제 동작과
// 일치).
type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "1. 목적",
    body: "이 약관은 MYONGJI L&F(이하 '서비스')를 이용하는 데 필요한 기본적인 사항을 안내합니다.",
  },
  {
    title: "2. 이용 대상 및 계정",
    body: (
      <>
        서비스는 원칙적으로 명지대학교 Google 계정(@mju.ac.kr)으로 로그인한 이용자를 대상으로
        합니다. 로그인 후 처음 이용할 때 닉네임 설정과 개인정보 수집·이용 동의가 필요합니다.
      </>
    ),
  },
  {
    title: "3. 제공하는 서비스",
    body: (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>분실물·습득물 게시글 등록·수정 및 키워드 검색</li>
        <li>AI 기반 의미 검색, 이미지 유사도 검색 및 관련 게시글 추천</li>
        <li>게시글에 대한 댓글·답글 작성</li>
        <li>게시글 작성자 또는 단체와의 1:1 채팅(사진 전송 포함)</li>
        <li>신고 및 알림</li>
        <li>단체 생성·가입·관리, 단체 명의 게시글·댓글 작성 및 단체 문의</li>
      </ul>
    ),
  },
  {
    title: "4. AI 검색 및 추천",
    body: "AI 기반 검색, 이미지 유사도 검색 및 관련 게시글 추천 결과는 이용자의 탐색을 돕기 위한 참고 정보이며, 검색 결과나 유사도가 동일한 물건 또는 실제 소유자를 보장하지 않습니다.",
  },
  {
    title: "5. 이용자의 의무",
    body: (
      <>
        이용자는 서비스를 이용하면서 다음 사항을 지켜야 합니다.
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>관련 법령 및 이 약관을 준수할 것</li>
          <li>운영정책을 준수할 것</li>
          <li>허위 정보 게시, 타인의 권리 침해, 서비스 악용 등의 행위를 하지 않을 것</li>
          <li>타인의 계정을 부정하게 이용하거나 서비스의 정상적인 운영을 방해하지 않을 것</li>
        </ul>
        <p className="mt-2">
          세부적인 금지행위와 신고·조치 기준은{" "}
          <Link href="/policy/community" className="font-medium text-primary hover:opacity-80">
            운영정책
          </Link>
          을 따릅니다.
        </p>
      </>
    ),
  },
  {
    title: "6. 콘텐츠 및 분실물 반환",
    body: (
      <>
        <p>
          이용자는 자신이 작성하거나 등록한 게시글, 댓글, 채팅 메시지 등 콘텐츠가 관련 법령, 이
          약관 및 운영정책을 준수하도록 할 책임이 있습니다. 서비스는 이용자가 작성한 콘텐츠를
          화면에 표시하고, 검색·추천 등 서비스 제공에 필요한 범위에서 이용합니다.
        </p>
        <p className="mt-2">
          서비스는 분실물과 습득물을 연결하는 것을 돕는 플랫폼이며, 게시글·검색·추천 결과만으로
          물건의 실제 소유권이 확정되지는 않습니다. 이용자는 물건을 주고받기 전에 상대방과 물건의
          특징 등을 직접 확인해야 하며, 구체적인 인도 방법은 당사자 간 협의를 통해 정합니다.
        </p>
      </>
    ),
  },
  {
    title: "7. 이용 제한 및 이의신청",
    body: (
      <>
        이 약관 또는 운영정책을 위반한 이용자는 위반 정도와 반복 여부 등에 따라 일정 기간 동안
        또는 별도의 종료 시점을 정하지 않고 서비스 이용이 제한될 수 있습니다. 이용이 제한된
        이용자는 서비스 내 이의신청 기능을 통해 소명하거나 추가 정보를 제출할 수 있으며, 이의신청
        제출 자체가 이용 제한을 자동으로 해제하지는 않습니다. 세부적인 조치 기준은 운영정책을
        따릅니다.
      </>
    ),
  },
  {
    title: "8. 회원 비활성화",
    body: (
      <>
        이용자는 내 정보 화면에서 회원 비활성화를 신청할 수 있습니다. 다만, 활성 단체의 유일한
        리더인 경우에는 단체 운영에 필요한 조치를 먼저 완료해야 회원 비활성화를 진행할 수
        있습니다. 회원 비활성화는 계정을 삭제하는 것이 아니며, 같은 Google 계정으로 다시
        로그인하면 계정이 재활성화됩니다. 개인정보의 보유 및 파기에 관한 자세한 내용은{" "}
        <Link href="/policy/privacy" className="font-medium text-primary hover:opacity-80">
          개인정보처리방침
        </Link>
        을 따릅니다.
      </>
    ),
  },
  {
    title: "9. 서비스의 변경 및 중단",
    body: "이 서비스는 명지대학교 학생이 개발·운영하는 비공식 프로젝트로, 명지대학교가 공식적으로 운영하거나 보증하는 서비스가 아닙니다. 서비스 운영상 또는 기술상 필요한 경우 기능이 변경되거나 서비스 제공이 일시적 또는 지속적으로 중단될 수 있습니다. 이용자에게 중요한 영향을 미치는 변경사항은 서비스 내 공지 등을 통해 안내합니다.",
  },
  {
    title: "10. 약관의 변경",
    body: "이 약관은 서비스 내용 변경에 따라 개정될 수 있으며, 변경 시 서비스 내에서 안내합니다.",
  },
];

export default function TermsPolicyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">정책</p>
        <h1 className="text-xl font-semibold text-foreground">이용약관</h1>
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
