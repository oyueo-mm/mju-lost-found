import Link from "next/link";

// Phase 9: mirrors the exact items/purposes shown at consent time
// (src/app/(auth)/privacy-consent/page.tsx's own COLLECTED_ITEMS) so the
// two never drift apart in what they claim is collected -- both are drawn
// from the same real schema/OAuth scope investigation. This is a full
// standalone version of that same notice, not a different one. See that
// page's own comment for the same ground rules: no fabricated legal
// review, no retention period more specific than the code guarantees, no
// third-party sharing that doesn't actually happen.
//
// Phase 10B: updated against the Phase 10A audit's findings -- §6/§7
// previously said no withdrawal feature existed and no purge logic ran
// anywhere; both are now wrong on their own terms (auth/user.ts's
// withdrawUser, and chat/service.ts's self-delete image cleanup), so this
// revision brings the wording back in line with what the code actually
// does, nothing more. Still no invented retention period, no third-party
// sharing that doesn't happen, no legal-review claim.
type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "1. 수집하는 개인정보 항목",
    body: (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>Google 계정 식별 정보(Google 로그인 시 발급되는 고유 식별자)</li>
        <li>이메일 주소</li>
        <li>이름(또는 이메일 기반 대체명) 및 직접 설정한 닉네임</li>
        <li>작성한 게시글(제목, 내용, 장소, 날짜, 첨부 이미지)</li>
        <li>작성한 댓글 및 답글</li>
        <li>주고받은 채팅 메시지 및 채팅으로 전송한 사진</li>
        <li>로그인 일시, 게시글 조회 기록, 신고/알림 등 서비스 이용 기록</li>
        <li>
          비로그인 상태로 게시글을 조회한 경우, 중복 조회수 집계 방지를 위해 브라우저에 저장되는 식별
          쿠키(1년간 보관)
        </li>
      </ul>
    ),
  },
  {
    title: "2. 수집 방법",
    body: (
      <>
        Google 로그인(OAuth)을 통해 이메일, 계정 식별 정보를 수집합니다. 이때 요청하는 권한 범위(scope)는
        <span className="font-medium text-foreground"> openid, email</span>이며, 프로필 사진·성별·언어 등
        Google의 별도 프로필 정보는 요청하지 않습니다. 그 외 항목은 이용자가 서비스를 이용하는 과정에서
        직접 입력하거나(닉네임, 게시글, 댓글, 채팅 등) 서비스 이용에 따라 자동으로 생성됩니다(로그인
        일시 등).
      </>
    ),
  },
  {
    title: "3. 이용 목적",
    body: "회원 식별 및 로그인, 분실물·습득물 게시글/댓글/채팅 등 서비스 핵심 기능 제공, 신고 처리 및 부정 이용 방지를 위해 이용합니다.",
  },
  {
    title: "4. 보유 및 이용 기간",
    body: (
      <>
        계정 정보는 계속 보유합니다. 회원 비활성화 시 처리 방식은 아래 6조를 따르며, 게시글·댓글·채팅
        메시지는 비활성화 여부와 무관하게 이용자가 직접 삭제하기 전까지 보유될 수 있습니다. 별도의
        법적 보존 의무가 있는 경우는 이 서비스의 코드로 확인되지 않아 안내하지 않습니다.
      </>
    ),
  },
  {
    title: "5. 개인정보의 처리 위탁, 제3자 제공, 내부 접근",
    body: (
      <>
        서비스 운영을 위해 데이터베이스·이미지 저장(Supabase), 호스팅(Vercel) 등 인프라 제공업체를
        이용합니다. 이 서비스가 직접 마케팅이나 광고 등 다른 목적으로 개인정보를 제3자에게 제공하지는
        않습니다. 다만 서비스 운영(신고 처리, 이용자 관리)을 위해 관리자 권한을 가진 운영자는 이용자의
        이메일 주소를 조회할 수 있습니다.
      </>
    ),
  },
  {
    title: "6. 이용자의 권리 및 회원 비활성화",
    body: (
      <>
        <p>
          이용자는 내 정보 화면에서 닉네임을 변경할 수 있고, 본인이 작성한 게시글·댓글·채팅 메시지를
          직접 수정하거나 삭제할 수 있습니다.
        </p>
        <p className="mt-2">
          회원 비활성화는 내 정보 화면에서 신청할 수 있습니다. 비활성화 시 계정 정보는 삭제·익명
          처리되지 않고 그대로 보존되며, 다만 그 계정으로는 로그인할 수 없게 됩니다(알림 내역은 함께
          삭제됩니다). 이후 같은 Google 계정으로 다시 로그인하면 같은 계정이 재활성화되어, 기존
          닉네임·게시글·댓글·채팅을 그대로 이어서 사용할 수 있습니다. 즉 회원 비활성화는 계정을
          삭제하는 것이 아니라 일시적으로 로그인을 중단하는 기능입니다.
        </p>
      </>
    ),
  },
  {
    title: "7. 개인정보의 파기",
    body: (
      <>
        회원 비활성화는 개인정보를 파기하거나 익명 처리하지 않습니다(위 6조 참고) -- 계정으로 로그인이
        제한될 뿐 데이터는 그대로 보존되며, 재활성화 시 그대로 이어서 사용됩니다. 본인이 직접 삭제한
        채팅 메시지에 첨부된 사진은 저장소에서도 함께 삭제됩니다. 그 외의 경우(예: 관리자가 신고
        처리로 숨긴 게시물·메시지, 신고·제재 기록)는 운영 기록 보전을 위해 별도로 파기하지 않습니다.
        이 서비스에는 일정 기간이 지나면 자동으로 데이터를 파기하는 절차는 구현되어 있지 않습니다.
      </>
    ),
  },
  {
    title: "8. 동의",
    body: "이 개인정보 수집·이용에 대한 동의는 로그인 후 표시되는 동의 화면에서 이용자가 직접 체크박스를 선택하고 버튼을 눌렀을 때만 기록됩니다. Google 로그인 자체는 이 동의를 의미하지 않습니다.",
  },
  {
    title: "9. 문의",
    body: (
      <>
        특정 게시물·메시지·사용자와 관련된 문제는 해당 화면의{" "}
        <Link href="/policy/community" className="font-medium text-primary hover:opacity-80">
          신고 기능
        </Link>
        을 이용해주세요.
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">정책</p>
        <h1 className="text-xl font-semibold text-foreground">개인정보처리방침</h1>
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
