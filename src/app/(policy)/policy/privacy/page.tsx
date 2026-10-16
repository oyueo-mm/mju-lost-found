import Link from "next/link";

import { formatEffectiveDate, PRIVACY_POLICY_EFFECTIVE_DATE } from "@/lib/auth/terms";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/contact";

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
//
// 회원탈퇴·보유정책: §6/§7 now describe both ways to leave exactly as
// auth/user.ts::withdrawUser (deactivation) and auth/withdrawal.ts::
// withdrawAccount (회원탈퇴) behave, and the retention periods applied by
// lib/retention (policy.ts / service.ts, daily Vercel Cron).
//
// 처리위탁·자동수집 정정: §1/§2 list exactly what Google sign-in returns
// for scope "openid email profile" (sub, email, email_verified, and the
// name, used only for 실명·소속 -- see below; the
// internal User.name is the e-mail local part, auth/user.ts), §5 names
// each processor with its task (no transfer country is stated: not yet
// confirmed), §8 describes the IP/User-Agent/cookie handling the code
// actually does (rateLimit/index.ts, posts/views.ts, i18n locale cookie,
// Auth.js session cookie), §10 the privacy contact.
//
// §11 shows the 시행일 from auth/terms.ts's PRIVACY_POLICY_EFFECTIVE_DATE,
// the same value the consent versions follow.
// 이름·소속 필수 수집 (2026-10-16): 이름·소속 are required items of the
// 개인정보 동의; §1, §3, §4, §6, §7, §9 describe it. Consent withdrawal of a
// required item is 회원탈퇴 (§6), as for the rest of this consent.
// 실명·소속 자동 수집 (2026-10-15): §1-§7 describe the optional consent and
// the automatic collection from the school Workspace display name
// (identity/googleHints.ts, identity/service.ts syncIdentityFromHints), the
// read-only values and 정정 요청, and the typed-in exception path.
// Earlier: §1-§7 add the member-entered real name and department
// (UserIdentityInfo) exactly as the code handles them -- collected with a
// separate consent on /me/identity, needed only to post or chat, never
// shown to other members, viewable by an admin only for a report with a
// logged reason (identity/service.ts), deleted at 회원탈퇴. Whether they
// may be required at all is a legal question still open (see the report).
type Section = { title: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    title: "1. 수집하는 개인정보 항목",
    body: (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>Google 계정 식별 정보(Google 로그인 시 발급되는 고유 식별자)</li>
        <li>이메일 주소 및 이메일 인증 여부(인증 여부는 로그인 허용 여부 확인에만 쓰고 저장하지 않습니다)</li>
        <li>
          직접 설정한 닉네임. 다른 이용자에게 표시되는 이름이며, 아래 이름과는 별개입니다. 계정의 내부 이름 값은 이메일
          주소의 @ 앞부분으로 저장되며, Google 계정 이름은 여기에 저장하지 않습니다.
        </li>
        <li>
          이름, 소속(학과·단과대학) (필수): 개인정보 수집·이용 동의의 필수 항목입니다. 명지대 Google Workspace
          계정(로그인 정보의 도메인 값이 mju.ac.kr인 계정)의 표시 이름이 &lsquo;이름/신분/소속&rsquo; 형식이면, 동의한 뒤 이름과
          소속 부분을 자동으로 추출해 저장하고, 이후 로그인할 때마다 Google 계정 정보와 비교해 바뀐 경우 갱신합니다.
          신분(학생·교수 등)은 저장하지 않습니다. 소속은 학과가 아닌 단과대학 등 상위 소속일 수 있으며, 이 정보는 학교 학적
          시스템에서 확인된 정보가 아닙니다. 표시 이름에서 가져올 수 없는 계정(학교 Google 계정이 아니거나 형식이 다른
          경우)은 게시글 등록·채팅 전에 이용자가 직접 입력하며, 형식이 맞지 않으면 어떤 값도 추측해 저장하지 않습니다.
          이름·소속은 본인과, 신고·분쟁을 처리하는 관리자(아래 5조)만 볼 수 있습니다.
        </li>
        <li>
          Google 계정 이름: Google 로그인 시 전달받아 위 이름·소속 자동 추출에만 씁니다. 동의 전에는 로그인 세션 쿠키에
          암호화된 상태로만 보관되고 서버에 저장하지 않으며, 저장한 뒤에는 세션에서 지웁니다.
        </li>
        <li>작성한 게시글(제목, 내용, 장소, 날짜, 첨부 이미지)</li>
        <li>작성한 댓글 및 답글</li>
        <li>주고받은 채팅 메시지 및 채팅으로 전송한 사진</li>
        <li>로그인 일시, 게시글 조회 기록, 신고/알림 등 서비스 이용 기록</li>
        <li>서비스 이용 과정에서 자동으로 생성·수집되는 정보(IP 주소, User-Agent, 쿠키): 아래 8조 참고</li>
      </ul>
    ),
  },
  {
    title: "2. 수집 방법",
    body: (
      <>
        Google 로그인(OAuth)을 통해 Google 계정 고유 식별자, 이메일 주소, 이메일 인증 여부를 전달받습니다. 이때
        요청하는 권한 범위(scope)는
        <span className="font-medium text-foreground"> openid, email, profile</span>입니다. profile로 전달되는
        정보 중 이름만 위 1조의 용도(동의 후 이름·소속 자동 추출)로 쓰며, 프로필 사진 등 나머지 정보는 쓰거나
        저장하지 않습니다. 그 외 항목은 이용자가 서비스를 이용하는 과정에서
        직접 입력하거나(닉네임, 게시글, 댓글, 채팅 등) 서비스 이용에 따라 자동으로 생성됩니다(로그인
        일시 등).
      </>
    ),
  },
  {
    title: "3. 이용 목적",
    body: (
      <>
        회원 식별 및 로그인, 분실물·습득물 게시글/댓글/채팅 등 서비스 핵심 기능 제공, 신고 처리 및 부정 이용 방지를 위해
        이용합니다. 이름·소속은 게시글·채팅으로 실제 물건을 주고받을 때의 본인 확인과 신고·분쟁 처리에만 이용하며, 다른
        이용자에게 공개하지 않습니다(게시글·댓글·채팅에는 닉네임만 표시됩니다).
      </>
    ),
  },
  {
    title: "4. 보유 및 이용 기간",
    body: (
      <>
        계정 정보는 회원 계정이 유지되는 동안 보유합니다. 회원 비활성화 시에도 기존 데이터는 보존되며,
        계정을 재활성화하면 이어서 이용할 수 있습니다(아래 6조 참고). 게시글, 댓글·답글, 채팅 메시지 및
        첨부 정보는 이용자가 직접 삭제하거나 서비스 운영상 삭제 사유가 발생할 때까지 보유될 수 있습니다.
        신고·제재 기록 등 이용자 보호, 서비스 운영 및 분쟁 대응에 필요한 정보는 필요한 범위에서 보관될
        수 있습니다. 관계 법령에 따라 일정 기간 보존이 필요한 정보가 있는 경우에는 해당 법령에서 정한
        기간 동안 보관합니다. 이름·소속은 회원 계정이 유지되는 동안 보유하며(계정 비활성화 중 포함), 회원탈퇴 시 즉시
        삭제합니다. 회원탈퇴 시 삭제되는 정보와 탈퇴 후 보유기간은 아래 6조·7조를 따릅니다.
      </>
    ),
  },
  {
    title: "5. 개인정보의 처리 위탁, 제3자 제공, 내부 접근",
    body: (
      <>
        <p>서비스 운영을 위해 다음 업체에 개인정보 처리 업무를 위탁합니다.</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li>
            <span className="font-medium text-foreground">Vercel</span>: 웹 서비스 호스팅, 서버 함수 실행, 정기
            보유기간 정리 작업 실행
          </li>
          <li>
            <span className="font-medium text-foreground">Supabase</span>: PostgreSQL 데이터베이스 저장,
            Storage 파일(게시글·채팅 이미지) 저장, Realtime 채팅 알림 전달
          </li>
        </ul>
        <p className="mt-2">
          각 업체가 공개한 하위 수탁자 목록은{" "}
          <a href="https://vercel.com/legal/sub-processors" target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:opacity-80">
            Vercel
          </a>
          ,{" "}
          <a
            href="https://supabase.com/legal/customer-resources/subprocessor-list"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:opacity-80"
          >
            Supabase
          </a>
          에서 확인할 수 있습니다.
        </p>
        <p className="mt-2">
          이 서비스가 직접 마케팅이나 광고 등 다른 목적으로 개인정보를 제3자에게 제공하지는 않습니다. 다만 서비스
          운영(신고 처리, 이용자 관리)을 위해 관리자 권한을 가진 운영자는 이용자의 이메일 주소를 조회할 수
          있습니다. 이름·소속은 관리자가 처리 중인 신고의 신고자 또는 피신고자에 한해, 열람 사유를 입력한 경우에만 조회할
          수 있으며, 열람할 때마다 열람한 관리자, 대상, 신고, 사유, 시각이 기록됩니다.
        </p>
      </>
    ),
  },
  {
    title: "6. 이용자의 권리, 계정 비활성화 및 회원탈퇴",
    body: (
      <>
        <p>
          이용자는 내 정보 화면에서 닉네임을 변경하고 이름·소속을 확인할 수 있습니다. Google 계정에서 자동으로 가져온
          이름·소속은 직접 수정할 수 없으며, 학교에서 Google 계정 이름을 고친 뒤 다시 로그인하면 자동으로 반영되고, 그 밖의
          오류는 같은 화면의 정정 요청으로 고칠 수 있습니다. 본인이 작성한 게시글·댓글·채팅 메시지를
          직접 수정하거나 삭제할 수 있습니다. 내 정보의 &lsquo;계정 비활성화 · 회원탈퇴&rsquo; 화면에서 아래 두
          가지 중 하나를 선택할 수 있습니다. 활성 단체의 유일한 대표 관리자는 대표 관리자 권한을 먼저
          위임해야 합니다.
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">계정 비활성화(복구 가능)</span>: 계정 정보와
          게시글·댓글·채팅 등 데이터는 삭제되지 않고 그대로 보존되며, 그 계정으로는 로그인할 수 없게
          됩니다(알림 내역은 함께 삭제됩니다). 같은 Google 계정으로 다시 로그인하면 같은 계정이
          재활성화되어 기존 데이터를 그대로 이어서 사용할 수 있습니다.
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">회원탈퇴(복구 불가)</span>: 이메일, Google 계정
          식별자, 내부 이름 값, 닉네임, 이름·소속과 그 동의 기록, 개인정보·약관 동의 기록, 최근 로그인 기록 등 계정을 직접 식별할 수 있는
          정보가 즉시 삭제됩니다. 다른 이용자의 댓글·채팅·신고 기록과의 연결을 유지하기 위해 계정 자체는
          식별정보가 제거된 가명 상태(&lsquo;탈퇴한 사용자&rsquo;)로만 남습니다. 탈퇴한 계정은 복구할 수
          없으며, 같은 Google 계정으로 다시 가입하면 새 계정이 만들어지고 이전 게시글·댓글·채팅과
          연결되지 않습니다. 다만 이용 정지 중이거나 처리 중인 신고·제재 절차 또는 검토 전 이의신청이
          있는 상태에서 탈퇴한 경우에는, 다시 가입할 때 관리자의 재가입 승인이 필요합니다.
        </p>
        <p className="mt-2">
          개인정보 수집·이용 동의는 서비스 이용에 필수인 동의이므로, 동의를 철회하면 회원탈퇴로
          처리됩니다. 동의 철회도 같은 화면에서 할 수 있습니다.
        </p>
      </>
    ),
  },
  {
    title: "7. 개인정보의 파기 및 탈퇴 후 보유기간",
    body: (
      <>
        <p>
          계정 비활성화 시에는 개인정보를 파기하지 않습니다(위 6조). 이용자가 직접 삭제한 채팅 메시지에
          첨부된 사진은 저장소에서도 함께 삭제됩니다.
        </p>
        <p className="mt-2">회원탈퇴 시 다음 정보는 즉시 삭제됩니다.</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li>계정의 직접 식별정보(위 6조), 알림, 키워드 알림, 게시글 조회 기록, 단체 구성원 정보, 외부 관계자 승인 정보, 서비스 개선 제안</li>
          <li>채팅으로 보낸 사진</li>
          <li>게시글의 내용과 이미지(다른 이용자의 댓글이 달린 게시글은 내용을 지운 비공개 상태로 남습니다)</li>
          <li>댓글(다른 이용자의 답글이 달린 댓글은 내용을 지운 &lsquo;삭제된 댓글&rsquo;로 남습니다)</li>
        </ul>
        <p className="mt-2">다음 정보는 아래 기간 동안 보관한 뒤 삭제됩니다.</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li>
            채팅 메시지 본문: 상대방의 대화 기록이므로 탈퇴 후 90일(그동안 보낸 사람은 &lsquo;탈퇴한
            사용자&rsquo;로 표시됩니다)
          </li>
          <li>처리 중인 신고의 대상이 된 게시글·댓글·채팅 메시지와 사진: 신고 처리가 끝날 때까지</li>
          <li>
            처리가 끝난 신고·제재·이의신청 기록과 관련 증거(신고와 연결된 채팅 사진 포함): 처리 완료 후
            1년. 다만 이용 정지가 계속되거나 아래 재가입 보류 사유가 남아 있는 동안에는 보관합니다.
          </li>
          <li>
            재가입 보류 식별값(Google 계정 식별자를 원래 값으로 되돌릴 수 없게 변환한 값): 이용 정지,
            미처리 신고·제재 절차, 검토 전 이의신청 등 보관 사유가 모두 끝나는 즉시 삭제. 재가입 요청과 그
            처리 기록은 처리 후 1년.
          </li>
          <li>관리자의 채팅 열람 기록, 이름·소속 열람 기록: 최소 1년</li>
        </ul>
        <p className="mt-2">보관 기간이 지난 정보는 매일 자동으로 삭제됩니다.</p>
      </>
    ),
  },
  {
    title: "8. 자동으로 수집되는 정보와 쿠키",
    body: (
      <>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <span className="font-medium text-foreground">IP 주소</span>: 로그인하지 않은 상태의 AI 검색 이용량을
            제한하기 위해, IP 주소를 원래 값으로 되돌릴 수 없는 해시 값으로 바꾼 뒤 이용 횟수와 함께 저장합니다(IP
            주소 자체는 저장하지 않으며, 2일이 지난 기록은 수시로 삭제됩니다). 또한 호스팅 업체(Vercel)의 요청
            기록에 접속 IP 주소와 User-Agent가 포함될 수 있습니다.
          </li>
          <li>
            <span className="font-medium text-foreground">User-Agent(브라우저·기기 정보)</span>: 이 서비스는 직접
            저장하지 않으며, 위 호스팅 업체의 요청 기록에만 포함될 수 있습니다. 아래 방문 통계에서는 접속 기기의
            종류(모바일·PC·태블릿·기타)를 구분하는 데에만 쓰고, 원래 값이나 기기를 식별할 수 있는 정보는 저장하지
            않습니다.
          </li>
          <li>
            <span className="font-medium text-foreground">로그인 세션 쿠키</span>: 로그인 상태를 유지하기 위한
            암호화된 쿠키입니다. 30일 동안 이용하지 않으면 만료되며, 로그아웃하면 삭제됩니다. 로그인 과정에는 보안을
            위한 보조 쿠키(요청 위조 방지 등)도 함께 쓰입니다.
          </li>
          <li>
            <span className="font-medium text-foreground">locale 쿠키</span>: 선택한 화면 언어를 기억합니다(1년).
          </li>
          <li>
            <span className="font-medium text-foreground">anon_uid 쿠키</span>: 로그인하지 않은 상태로 게시글을 볼 때
            같은 브라우저의 조회가 중복 집계되지 않도록 무작위 식별값을 저장합니다(1년).
          </li>
          <li>
            <span className="font-medium text-foreground">방문 통계용 브라우저 저장소</span>: 로그인 여부와 관계없이
            서비스 이용량을 파악하기 위해, 같은 브라우저의 방문을 하나의 방문으로 묶는 데 필요한 마지막 방문 시각과
            날짜, 현재 방문의 요약(시작·마지막 활동 시각, 처음·마지막 화면 종류, 본 화면 수), 아직 보내지 않은 조회
            기록(화면 종류)만 브라우저 저장소(localStorage·sessionStorage)에 저장하며 식별값은 만들지 않습니다. 서버에는
            개인을 알아볼 수 없는 날짜별 합계(화면 종류별 조회 수, 방문 수, 로그인 여부, 접속 기기 종류, 유입 경로 분류,
            홍보 링크의 캠페인 이름, 방문 시작·마지막 활동 시간대, 체류 시간 구간, 처음·마지막 화면 종류)만 저장하고, IP 주소·검색어·방문한 주소·회원 정보는
            저장하지 않습니다. 브라우저 저장소를 삭제하거나 차단해도 서비스 이용에는 영향이 없습니다.
          </li>
        </ul>
        <p className="mt-2">
          쿠키는 이용자의 브라우저에 저장되며, 브라우저 설정에서 저장을 거부하거나 삭제할 수 있습니다. 다만 로그인
          세션 쿠키를 거부하면 로그인이 필요한 기능을 이용할 수 없고, locale 쿠키를 거부하면 언어 선택이 유지되지
          않습니다.
        </p>
      </>
    ),
  },
  {
    title: "9. 동의",
    body: "이 개인정보 수집·이용에 대한 동의(이름·소속 포함)는 로그인 후 표시되는 동의 화면에서 이용자가 직접 체크박스를 선택하고 버튼을 눌렀을 때만 기록되며, 이름·소속은 이 동의가 기록된 뒤에만 저장됩니다. Google 로그인 자체는 이 동의를 의미하지 않습니다. 이 동의는 서비스 이용에 필수이므로, 동의하지 않으면 회원 기능(게시글 등록, 댓글, 채팅 등)을 이용할 수 없습니다. 로그인하지 않은 상태에서 공개 게시글을 둘러보거나 검색하는 것은 동의 없이 가능합니다.",
  },
  {
    title: "10. 개인정보 보호 문의",
    body: (
      <>
        개인정보 처리와 관련한 문의, 열람·정정·삭제·처리정지 요청은 개인정보 문의 담당(
        <a href={SUPPORT_MAILTO} className="font-medium text-primary hover:opacity-80">
          {SUPPORT_EMAIL}
        </a>
        )으로 연락해주세요. 특정 게시물·메시지·사용자와 관련된 문제는 해당 화면의{" "}
        <Link href="/policy/community" className="font-medium text-primary hover:opacity-80">
          신고 기능
        </Link>
        을 이용해주세요.
      </>
    ),
  },
  {
    title: "11. 시행일 및 변경",
    body: (
      <>
        이 개인정보처리방침은 {formatEffectiveDate(PRIVACY_POLICY_EFFECTIVE_DATE)}부터 시행합니다. 이번 변경으로 이름,
        소속(학과·단과대학)이 필수 수집 항목에 추가되었으며(위 1조), 기존 회원은 시행일 이후 처음 로그인할 때 변경된
        내용을 확인하고 다시 동의해야 회원 기능을 이용할 수 있습니다.
        <span className="mt-2 block">
          2026년 10월 15일: 8조에 방문 통계용 브라우저 저장소 안내를 추가했습니다. 수집하는 개인정보 항목과 이용
          목적은 바뀌지 않아 다시 동의할 필요는 없습니다.
        </span>
        <span className="mt-2 block">
          2026년 10월 16일: 8조 방문 통계의 날짜별 합계에 접속 기기 종류(모바일·PC·태블릿·기타)를 추가했습니다. 이미
          안내한 User-Agent에서 기기 종류만 구분해 합계로 저장하며, 수집하는 개인정보 항목과 이용 목적은 바뀌지 않아
          다시 동의할 필요는 없습니다.
        </span>
        <span className="mt-2 block">
          2026년 10월 16일: 방문 통계에 방문 시간·체류 시간·이탈 화면의 시간대·구간별 합계를 추가하고, 이를 위해 브라우저
          저장소에 현재 방문의 요약을 보관한다는 내용을 8조에 추가했습니다. 개인별 이동 기록이나 정확한 접속·종료 시각은
          저장하지 않으며, 수집하는 개인정보 항목과 이용 목적은 바뀌지 않아 다시 동의할 필요는 없습니다.
        </span>
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
