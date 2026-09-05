import Link from "next/link";

// Phase 14: linked from /login ("명지대 계정이 없으신가요?"). A plain
// route, not a modal -- this project has no modal/dialog pattern anywhere
// (checked before writing this), and every other distinct concern here
// (login, onboarding, suspended) is already its own page under the (auth)
// route group, which has no shared layout (no Header) -- same bare,
// centered treatment as those.
//
// The steps below are transcribed from Myongji University's own official
// notice (전산정보원, "명지대학교 이메일(Gmail) 및 MS Office 프로그램
// 사용 안내"), not guessed -- see the "자세히 보기" link at the bottom for
// the source. Only what that notice actually states is included; nothing
// here is invented. If the university changes this procedure, this page
// will drift out of date the same way any static copy of an external
// process would -- the "자세히 보기" link exists specifically so a reader
// can always cross-check the current official version.
const EXTERNAL_LINK_CLASS =
  "text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={EXTERNAL_LINK_CLASS}>
      {children} <span aria-hidden="true">↗</span>
      <span className="sr-only">(새 창에서 열림)</span>
    </a>
  );
}

export default function AccountGuidePage() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            명지대 계정이 없으신가요?
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            명지대학교 학생 계정(@mju.ac.kr)이 있어야 이 서비스를 이용할 수 있습니다.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">계정 생성 방법</h2>
          <ol className="flex flex-col gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-zinc-900 dark:text-zinc-50">①</span>
              <span>
                <ExternalLink href="https://msi.mju.ac.kr">학생정보시스템(msi.mju.ac.kr)</ExternalLink>에
                로그인합니다.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-zinc-900 dark:text-zinc-50">②</span>
              <span>
                상단 메뉴의 &apos;Google Workspace&apos;를 클릭하거나, 좌측 메뉴의 &apos;전산신청 &gt;
                Google Workspace, O365 신청&apos; → &apos;통합 관리 페이지로 이동&apos;을 선택합니다.{" "}
                <ExternalLink href="https://portal.mju.ac.kr">포털시스템(portal.mju.ac.kr)</ExternalLink>
                에서도 동일하게 이동할 수 있습니다.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-zinc-900 dark:text-zinc-50">③</span>
              <span>
                Google 계정이 없는 경우, 화면 중앙의 Google Workspace 아이콘을 클릭하고 약관을 확인 및
                동의한 뒤 사용할 아이디와 비밀번호를 입력하고 &apos;Google Workspace 계정 생성&apos;
                버튼을 클릭합니다.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-zinc-900 dark:text-zinc-50">④</span>
              <span>
                생성한 @mju.ac.kr 계정으로 명지 스마트 분실물 센터에서 &apos;Google로 로그인&apos;을
                클릭합니다.
              </span>
            </li>
          </ol>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            비밀번호를 변경해야 한다면{" "}
            <ExternalLink href="https://mcloud.mju.ac.kr">통합 관리 페이지(mcloud.mju.ac.kr)</ExternalLink>
            의 암호 변경 버튼을 이용하세요.
          </p>
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          위 절차는 명지대학교 전산정보원의 공식 안내를 바탕으로 작성되었습니다. 최신 절차는{" "}
          <ExternalLink href="https://record.mju.ac.kr/bbs/mjukr/522/190907/artclView.do">
            공식 안내 게시글에서 직접 확인
          </ExternalLink>
          하세요.
        </p>

        <div className="flex flex-col items-center gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <ExternalLink href="https://www.mju.ac.kr">명지대학교 공식 홈페이지 열기</ExternalLink>
          <Link
            href="/login"
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600"
          >
            로그인 화면으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
