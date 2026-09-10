import { InfoIcon } from "@/components/icons";

// Phase 12-10 §7: "단체 ⓘ" 도움말. 새 클라이언트 팝오버 컴포넌트 대신
// <details>/<summary>를 쓴다 -- JS 없이 동작하고, 네이티브 키보드/스크린
// 리더 접근성을 공짜로 얻으며, 모바일에서는 탭으로 열고 닫기만 하면 되므로
// 이 프로젝트의 "불필요한 컴포넌트 금지" 원칙에 맞는다. 텍스트는 스펙 §7의
// 문구를 그대로 사용한다 -- 실제 기능과 다르게 각색하지 않는다.
export function OrganizationHelpTooltip() {
  return (
    <details className="group relative">
      <summary
        className="flex size-6 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden"
        aria-label="단체란 무엇인가요?"
      >
        <InfoIcon className="size-5" />
      </summary>
      <div className="absolute left-0 top-full z-10 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-card border border-border bg-card p-4 text-sm text-foreground shadow-lg">
        <p className="font-semibold">단체란?</p>
        <p className="mt-2 whitespace-pre-line text-muted-foreground">
          {`명지대학교 학생들이 활동하는 동아리,
학생회, 학과, 위원회 등의 단체를 의미합니다.

단체에 가입하면 단체의 이름으로
분실물·습득물 게시글과 댓글을 작성할 수 있습니다.

단체로 작성한 게시글과 댓글도 실제 작성자는
본인 계정으로 기록됩니다.`}
        </p>
      </div>
    </details>
  );
}
