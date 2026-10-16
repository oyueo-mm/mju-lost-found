import { formatEffectiveDate } from "@/lib/auth/terms";
import Link from "next/link";
import { PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/policy/privacyPolicy";
import { PRIVACY_CONTACT_TEAM, SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/contact";

type Section = { title: string; body: React.ReactNode };

// 실제 보유정책은 lib/retention/policy.ts·service.ts, 탈퇴 처리는
// auth/withdrawal.ts를 따릅니다. 문서 편집으로 동의 버전을 바꾸지 않습니다.
const RETENTION_ROWS = [
  ["채팅 메시지 본문", "상대방의 대화 기록 유지를 위해 탈퇴 후 90일"],
  ["신고·제재·이의신청 기록과 관련 증거(게시글·댓글·채팅·사진)", "처리 중에는 보관하며, 처리 완료 후 1년. 이용 정지나 재가입 보류 사유가 남으면 계속 보관"],
  ["재가입 보류 식별값", "원래 계정 식별자로 되돌릴 수 없는 값으로 보관하며, 이용 정지·미처리 신고 등 보류 사유가 모두 끝나면 즉시 삭제"],
  ["재가입 요청·처리 기록", "처리 후 1년"],
  ["관리자의 채팅 및 이름·소속 열람 기록", "최소 1년"],
] as const;

const SECTIONS: Section[] = [
  {
    title: "1. 수집 항목과 방법",
    body: (
      <ul className="flex list-disc flex-col gap-2 pl-5">
        <li>
          <strong className="font-medium text-foreground">회원 정보</strong>: Google 계정 식별자, 이메일, 닉네임,
          동의·로그인 기록. Google 로그인으로 계정 정보를 받고, 이메일 인증 여부는 로그인 확인에만 사용합니다.
          내부 계정 이름은 이메일의 @ 앞부분으로 저장합니다.
        </li>
        <li>
          <strong className="font-medium text-foreground">이름·소속(학과·단과대학, 필수)</strong>: 회원 확인과 신고·분쟁
          처리를 위해 수집합니다. 동의 후 명지대 Google 계정 이름에서 가져오거나 직접 입력받으며, 다른 이용자에게 공개하지 않습니다.
        </li>
        <li>
          <strong className="font-medium text-foreground">이용자가 작성·제공한 정보</strong>: 게시글(제목·내용·장소·날짜·사진),
          댓글·답글, 채팅 메시지·사진, 신고·이의신청·재가입 요청, 알림 설정·개선 제안, 단체 신청 정보(단체·연락처·신청 사유 등).
          외부 관계자 이용 승인 시에는 관리자가 이메일·이름·소속·캠퍼스를 입력합니다.
        </li>
        <li>
          <strong className="font-medium text-foreground">운영·보안 과정에서 생성되는 기록</strong>: 조회·알림 등 이용 내역,
          관리자 조치·열람 기록, 회원별 이용 일자, 접속 정보·쿠키. 자동 수집 정보는 5항에서 안내합니다.
        </li>
      </ul>
    ),
  },
  {
    title: "2. 이용 목적과 동의",
    body: (
      <>
        <p>
          회원 가입·관리, 분실물·습득물 게시·검색·추천과 소통, 신고·분쟁 처리 및 부정 이용 방지, 이용 통계 작성과
          서비스 개선·보안을 위해 사용합니다. 마케팅·광고에는 이용하지 않으며, 목적이 바뀌면 미리 알리고 필요한 동의를 받습니다.
        </p>
        <p className="mt-2">
          AI 검색·추천을 위해 게시글의 글과 사진을 서버 안에서 변환해 저장합니다. 검색에 입력한 문장·사진은 결과를 만드는 데만
          사용하고 저장하지 않습니다. 다만 요청 주소에 포함된 검색어는 호스팅 접속 기록에 남을 수 있습니다.
        </p>
        <p className="mt-2">
          Google 로그인과 별도로 동의 화면에서 직접 동의해야 회원 기능을 이용할 수 있습니다. 동의하지 않아도 공개 게시글
          열람·검색은 가능합니다. 필수 동의(이름·소속 포함)를 철회하면 회원탈퇴로 처리됩니다.
        </p>
        <p className="mt-2">
          개인정보의 추가 이용은 원래 수집 목적과의 관련성, 수집 경위·기존 안내에 따른 예측 가능성, 이용자의 이익을 부당하게
          침해하는지, 식별값 변환·접근 제한·합계 표시·보관기간 등 안전조치를 기준으로 판단합니다. 운영팀은 이 기준의 충족 여부를
          점검하며, 요건을 충족하지 않는 추가 이용에는 별도의 동의 등 적법한 근거가 필요합니다.
        </p>
      </>
    ),
  },
  {
    title: "3. 보관기간과 파기",
    body: (
      <>
        <p>
          회원 정보는 계정 유지 중 보관하며, 작성한 콘텐츠는 직접 삭제하거나 운영상 삭제 사유가 생길 때까지 보관합니다.
          계정 비활성화는 데이터를 보존하는 기능으로, 같은 Google 계정으로 로그인하면 복구됩니다(알림 내역은 삭제).
        </p>
        <p className="mt-2">
          회원탈퇴 시 계정 식별정보·이름·소속·동의 기록, 알림·조회·이용 일자 기록, 단체 구성원·외부 승인 정보, 개선 제안,
          작성한 게시글·사진·댓글을 즉시 삭제합니다. 다른 이용자의 댓글·답글과 연결된 글은 내용을 지운 상태로 남고,
          계정은 식별정보를 제거한 &lsquo;탈퇴한 사용자&rsquo;로 남습니다. 채팅 사진도 삭제합니다.
          다만 아래 표의 신고·분쟁 관련 정보는 예외로 보관합니다.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <caption className="border-b border-border bg-muted/40 px-3 py-2 text-left font-medium text-foreground">
              탈퇴 후에도 보관하는 정보
            </caption>
            <thead className="border-b border-border">
              <tr>
                <th scope="col" className="w-2/5 px-3 py-2 font-medium text-foreground">정보</th>
                <th scope="col" className="px-3 py-2 font-medium text-foreground">기간·사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {RETENTION_ROWS.map(([item, period]) => (
                <tr key={item}>
                  <th scope="row" className="px-3 py-2 align-top font-normal">{item}</th>
                  <td className="px-3 py-2 align-top">{period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2">
          보관기간이 지난 정보는 매일 자동 정리하며, 전자 기록은 데이터베이스·파일 저장소에서 삭제합니다.
          탈퇴와 동시에 생성돼 남은 이용 일자 기록도 이때 삭제합니다. 법령상 보존 의무가 있으면 해당 기간을 따릅니다.
          자동 수집 정보의 보관기간은 5항과 같습니다.
        </p>
      </>
    ),
  },
  {
    title: "4. 처리 위탁과 제3자 제공",
    body: (
      <>
        <p>
          하위 수탁자는 각 업체의 공개 목록(
          <a href="https://vercel.com/legal/sub-processors" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:opacity-80">Vercel</a>,{" "}
          <a href="https://supabase.com/legal/customer-resources/subprocessor-list" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:opacity-80">Supabase</a>
          )에서 확인할 수 있습니다. 서비스가 직접 마케팅·광고 등 다른 목적으로 개인정보를 제3자에게 제공하지는 않습니다.
        </p>
        <p className="mt-2">
          서버 함수와 주 데이터베이스·파일 저장소는 서울 지역으로 설정되어 있습니다.
          다만 이 설정이 모든 처리를 국내로 제한하지는 않습니다. Vercel은 미국 등 수탁처리 지역에서 운영·보안 업무를 처리할 수
          있고, Supabase는 EU 데이터센터의 로그 처리, 미국 등에서의 지원·운영, 전 세계 CDN의 파일 전송을 안내하고 있습니다.
        </p>
        <ul className="mt-2 flex list-disc flex-col gap-2 pl-5">
          <li>
            Vercel Inc. (<a href="mailto:privacy@vercel.com" className="text-primary hover:opacity-80">privacy@vercel.com</a>):
            서비스 요청 시 접속 정보와 서버가 처리하는 회원·콘텐츠 정보를 전송해 호스팅·서버 실행·정기 보유기간 정리·보안·오류 분석에 사용합니다.
            현재 Hobby 요금제의 서버 실행 로그 조회 보관기간은 1시간이며, 별도 플랫폼·보안 기록의 보관기간과 같지는 않습니다.
          </li>
          <li>
            Supabase Pte. Ltd. (<a href="mailto:privacy@supabase.io" className="text-primary hover:opacity-80">privacy@supabase.io</a>):
            서비스 이용 중 회원 정보·작성 정보·이용 기록·이미지를 데이터베이스·파일 저장소에 저장하고 실시간 채팅 알림을 전달합니다.
            지원 요청이나 보안 사고 대응 시 필요한 정보에
            국외에서 접근할 수 있습니다. 서비스 데이터의 보관·삭제는 3항에 따르며, 백업·플랫폼 로그에는 업체별 보관정책이 적용됩니다.
          </li>
        </ul>
        <p className="mt-2">
          지역 밖 처리에 관한 업체의 안내는{" "}
          <a href="https://vercel.com/docs/security/compliance" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:opacity-80">Vercel</a>과{" "}
          <a href="https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:opacity-80">Supabase</a>
          에서 확인할 수 있습니다. 관련 문의·처리정지 요청은 7항의 운영팀 이메일로 할 수 있으며, 서비스 제공에 필수인 처리를
          중단하면 해당 기능의 이용이 제한될 수 있습니다.
        </p>
      </>
    ),
  },
  {
    title: "5. 자동 수집 정보와 쿠키",
    body: (
      <>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>
            <strong className="font-medium text-foreground">접속·보안 기록</strong>: 비로그인 AI 검색 이용량 제한을 위해
            IP를 되돌릴 수 없는 값으로 변환해 저장하고, 2일이 지난 기록을 수시로 삭제합니다. Vercel 접속·운영 기록에는
            IP, 브라우저·기기 정보(User-Agent), 요청 주소·오류, 회원 번호와 이름·소속 확인 결과(값 제외)가 포함될 수 있으며,
            업체의 보관기간에 따라 삭제됩니다. API 응답 시간·오류율은 회원 정보 없는 합계로 90일간 보관합니다.
          </li>
          <li>
            <strong className="font-medium text-foreground">쿠키</strong>: 로그인 유지·보안용 쿠키(세션은 30일 미이용 시
            만료, 로그아웃 시 삭제), 언어 설정(locale, 1년), 비로그인 게시글 조회수 중복 방지 식별값(anon_uid, 1년)을 사용합니다.
          </li>
          <li>
            <strong className="font-medium text-foreground">방문 통계·브라우저 저장소</strong>: 방문 시각·화면 종류 등 방문
            요약과 미전송 조회 기록, 변경 안내를 닫은 시행일을 브라우저에 저장합니다. 방문 요약은 다음 방문 때 교체하며,
            7일이 지난 요약은 통계에 반영하지 않습니다. 서버에는 조회·방문 수, 로그인 여부·기기 종류·유입 경로·캠페인,
            방문 시간대·체류 시간·첫 화면·마지막 화면 등의 개인을 식별할 수 없는 날짜별 합계만 저장합니다.
          </li>
          <li>
            <strong className="font-medium text-foreground">회원별 이용 일자</strong>: 로그인 상태로 이용한 날짜를 하루
            한 번 기록해 활성 회원·재방문 통계를 만듭니다. 회원과 대조할 수 있는 개인정보로 취급하며, 이용한 날로부터
            400일간 보관합니다(탈퇴 시 삭제는 3항 참고). 관리자 화면·다운로드 파일에는 합계만 표시하며 회원별 이용 기록은
            표시하지 않습니다. 탈퇴하면 지난 기간의 활성 회원·재방문 통계도 줄어들 수 있습니다.
          </li>
          <li>
            <strong className="font-medium text-foreground">회원과 연결되지 않는 집계</strong>: 날짜·시간대별 로그인 횟수·조회 수와
            위 방문 통계 합계에는 회원 정보가 없으며, 보관 기한 없이 탈퇴 후에도 남습니다.
          </li>
        </ul>
        <p className="mt-2">
          브라우저 설정에서 쿠키·브라우저 저장소를 삭제하거나 차단할 수 있습니다. 로그인 쿠키를 거부하면 회원 기능을 이용할 수 없고,
          언어 쿠키를 거부하면 언어 선택이 유지되지 않습니다. 방문 통계·변경 안내용 저장소를 차단해도 서비스는 이용할 수 있습니다.
        </p>
      </>
    ),
  },
  {
    title: "6. 이용자의 권리와 행사 방법",
    body: (
      <>
        <p>
          내 정보에서 닉네임 변경, 이름·소속 확인과 정정 요청, 계정 비활성화·회원탈퇴·동의 철회를 할 수 있습니다.
          Google에서 가져온 이름·소속은 계정 정보를 고친 뒤 다시 로그인하면 반영됩니다. 작성한 콘텐츠는 해당 화면에서
          수정·삭제할 수 있으며, 개인정보 열람·정정·삭제·처리정지는 아래 문의처로 요청할 수 있습니다.
        </p>
        <p className="mt-2">
          탈퇴한 계정은 복구되지 않습니다. 다시 가입해도 이전 콘텐츠와 연결되지 않으며, 이용 정지·미처리 신고·제재·검토 전
          이의신청이 있으면 재가입 승인이 필요합니다. 활성 단체의 유일한 대표 관리자는 탈퇴·비활성화 전에 권한을 위임해야 합니다.
        </p>
      </>
    ),
  },
  {
    title: "7. 개인정보 보호와 문의",
    body: (
      <>
        <p>
          운영상 개인정보 조회는 관리자 권한으로 제한합니다. 운영자는 이용자 관리·신고 처리를 위해 이메일을 조회할 수 있으며,
          이름·소속은 처리 중인 신고의 당사자에 한해 사유를 입력해야 열람할 수 있습니다. 열람자·대상·신고·사유·시각을 기록합니다.
        </p>
        <p className="mt-2">
          개인정보 보호업무와 열람·정정·삭제·처리정지 등 권리 행사 요청은 {PRIVACY_CONTACT_TEAM}(
          <a href={SUPPORT_MAILTO} className="break-all font-medium text-primary hover:opacity-80">{SUPPORT_EMAIL}</a>
          )으로 연락해주세요.
        </p>
        <p className="mt-2">MJU Find는 학생들이 자체 운영하는 서비스이며, 명지대학교 공식 서비스나 학교 공식 부서가 아닙니다.</p>
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

      <div className="flex flex-col gap-5 rounded-card border border-border bg-card p-5 text-sm leading-relaxed text-foreground">
        {SECTIONS.map((section, i) => (
          <section key={section.title} className={`flex flex-col gap-2 ${i > 0 ? "border-t border-border pt-5" : ""}`}>
            <h2 className="font-semibold">{section.title}</h2>
            <div className="text-muted-foreground">{section.body}</div>
          </section>
        ))}
      </div>

      {/* 변경 안내 바의 /policy/privacy#changes 링크를 유지합니다. */}
      <div id="changes" className="scroll-mt-24 space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>시행일: {formatEffectiveDate(PRIVACY_POLICY_EFFECTIVE_DATE)}</p>
        <Link href="/policy/privacy/history" className="inline-block font-medium text-primary hover:opacity-80">
          이전 개인정보처리방침 및 변경 내역
        </Link>
      </div>
    </div>
  );
}
