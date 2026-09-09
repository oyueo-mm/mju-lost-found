import Link from "next/link";

// Phase 9: written directly from this branch's actual implemented
// features (see comment/service.ts, chat/service.ts, report/service.ts,
// moderation/service.ts, prisma/schema.prisma) -- not a template, and not
// phrased as if reviewed by a lawyer. Nothing here claims an obligation,
// process, or right that the code doesn't actually provide (e.g. there is
// still no account-deletion feature, so this doesn't promise one).
type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "1. 목적",
    body: "이 약관은 명지 스마트 분실물 센터(이하 '서비스')를 이용하는 데 필요한 기본적인 사항을 안내합니다.",
  },
  {
    title: "2. 이용 대상",
    body: (
      <>
        서비스는 명지대학교 Google 계정(@mju.ac.kr)으로 로그인한 이용자를 대상으로 합니다. 관리자가
        테스트 목적으로 일반 Google 계정 로그인을 허용한 기간에는 예외가 있을 수 있습니다. 로그인 후
        처음 이용할 때 닉네임 설정과 개인정보 수집·이용 동의가 필요합니다.
      </>
    ),
  },
  {
    title: "3. 제공하는 서비스",
    body: (
      <>
        분실물/습득물 게시글 등록 및 검색(키워드, AI 기반 의미 검색, 이미지 유사도 검색), 게시글에
        대한 댓글·답글 작성, 게시글 작성자와의 1:1 채팅(사진 전송 포함), 신고, 알림 기능을 제공합니다.
      </>
    ),
  },
  {
    title: "4. 이용자의 의무",
    body: (
      <>
        이용자는 서비스를 이용하면서 다음 행위를 해서는 안 됩니다.
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>사기 또는 허위 정보 게시</li>
          <li>부적절한 내용의 게시물·댓글·메시지 작성</li>
          <li>욕설·비방 등 다른 이용자에 대한 공격적인 표현</li>
          <li>본인 또는 타인의 개인정보를 부적절하게 노출하는 행위</li>
          <li>도배·스팸성 게시물 반복 작성</li>
        </ul>
        <p className="mt-2">
          위 행위가 확인되면{" "}
          <Link href="/policy/community" className="font-medium text-primary hover:opacity-80">
            운영정책
          </Link>
          에 따라 게시물 삭제, 메시지 숨김, 댓글 삭제, 계정 정지 등의 조치가 취해질 수 있습니다.
        </p>
      </>
    ),
  },
  {
    title: "5. 게시물 및 콘텐츠에 대한 책임",
    body: "게시글, 댓글, 채팅 메시지 등 이용자가 작성한 콘텐츠에 대한 책임은 해당 콘텐츠를 작성한 이용자 본인에게 있습니다.",
  },
  {
    title: "6. 계정 정지 및 이의신청",
    body: (
      <>
        4조를 위반한 이용자는 기간을 정하여 또는 별도 기간 없이 계정이 정지될 수 있습니다. 정지된
        이용자는 서비스 내 이의신청 기능을 통해 정지 조치에 대해 이의를 제기할 수 있습니다.
      </>
    ),
  },
  {
    title: "7. 서비스의 변경 및 중단",
    body: "이 서비스는 명지대학교 학생이 개발·운영하는 프로젝트로, 사전 고지 없이 기능이 변경되거나 서비스가 중단될 수 있습니다.",
  },
  {
    title: "8. 약관의 변경",
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
