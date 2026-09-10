import { ShieldIcon } from "@/components/icons";

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

// Phase 12-10 §8: Footer의 "단체 이용 안내" 링크가 향하는 정적 설명 페이지.
// 여기 적힌 내용은 전부 실제 구현(organization/service.ts,
// OrganizationDeactivateControl, AttributionLink 등)과 반드시 일치해야
// 한다 -- 실제로 없는 기능(단체 물리 삭제, 보관 장소 등)은 설명하지 않는다.
// 인증/데이터 조회가 필요 없는 순수 정적 페이지라 로그인 여부와 무관하게
// 누구나 볼 수 있다(/policy/* 페이지들과 동일한 posture).
export default function OrganizationGuidePage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary">
          <ShieldIcon className="size-5" />
        </span>
        <h1 className="text-lg font-semibold text-foreground">단체 이용 안내</h1>
      </div>

      <GuideSection title="단체란?">
        <p>
          명지대학교 학생들이 활동하는 동아리, 학생회, 학과, 위원회 등의 단체를 의미합니다. 단체에 가입하면
          단체의 이름으로 분실물·습득물 게시글과 댓글을 작성할 수 있습니다.
        </p>
      </GuideSection>

      <GuideSection title="단체 가입">
        <p>
          단체 허브의 &ldquo;단체 찾기&rdquo; 탭에서 활동 중인(ACTIVE) 단체를 찾아 가입을 신청할 수 있습니다.
          가입 신청은 해당 단체의 대표 관리자 또는 관리자가 승인하거나 거절합니다. 신청 결과는 &ldquo;단체
          허브 &rarr; 신청 내역&rdquo; 탭에서 확인할 수 있습니다.
        </p>
      </GuideSection>

      <GuideSection title="단체로 게시글 작성">
        <p>
          단체에 가입한 이후에는 분실물·습득물 게시글이나 댓글을 작성할 때 개인 명의 대신 단체 명의를
          선택할 수 있습니다. 단체 명의로 작성한 게시글·댓글은 목록과 상세 화면에 단체 이름으로 표시되고,
          개인 프로필로는 연결되지 않습니다.
        </p>
        <p>
          다만 단체로 작성한 게시글과 댓글도 실제 작성자는 본인 계정으로 그대로 기록됩니다. 신고·이의제기 등
          운영 절차는 개인 명의 게시글과 동일하게 실제 작성자를 기준으로 처리됩니다.
        </p>
      </GuideSection>

      <GuideSection title="단체 관리자">
        <p>
          단체에는 두 가지 관리 권한이 있습니다. <strong className="text-foreground">대표 관리자</strong>는
          단체당 한 명이며, 구성원 관리·관리자 지정·단체 폐쇄를 포함한 모든 관리 기능을 사용할 수 있고,
          대표 관리자 권한을 다른 구성원에게 위임할 수 있습니다.{" "}
          <strong className="text-foreground">관리자</strong>는 대표 관리자가 지정하며, 가입 신청 처리와
          구성원 관리 등 단체 운영 업무를 수행하지만 대표 관리자 위임이나 단체 폐쇄는 할 수 없습니다.
        </p>
      </GuideSection>

      <GuideSection title="단체 폐쇄">
        <p>
          대표 관리자는 단체 설정에서 단체를 폐쇄할 수 있습니다. 폐쇄된 단체는 비활성(INACTIVE) 상태가 되어
          단체 찾기 목록과 신규 가입 대상에서 제외되지만, 단체와 그 단체 명의로 작성된 기존 게시글·댓글·
          기록은 삭제되지 않고 그대로 유지됩니다. 단체 허브의 &ldquo;내 단체 &rarr; 폐쇄된 단체&rdquo;
          필터에서 계속 확인할 수 있습니다.
        </p>
      </GuideSection>
    </div>
  );
}
