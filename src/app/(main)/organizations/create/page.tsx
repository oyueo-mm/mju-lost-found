import { requireActiveUser } from "@/lib/auth/session";
import { getMyPendingOrganizationCreationRequest } from "@/lib/organization/service";
import { OrganizationCreationRequestForm } from "@/components/organization/OrganizationCreationRequestForm";
import { PendingOrganizationRequestCard } from "@/components/organization/PendingOrganizationRequestCard";

// Phase 12-3: requireActiveUser()가 로그인/닉네임 설정/비정지를 모두
// 확인하므로(§5), 자격을 갖추지 못한 사용자는 이 페이지 자체가 렌더링되기
// 전에 redirect된다. 이미 PENDING 신청이 있으면(§6 중복 신청 정책) 폼 대신
// 그 신청의 상태 + 취소 버튼을 보여준다.
export default async function CreateOrganizationPage() {
  const user = await requireActiveUser();
  const pending = await getMyPendingOrganizationCreationRequest(user.id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">단체 생성 신청</h1>
      {pending ? <PendingOrganizationRequestCard request={pending} /> : <OrganizationCreationRequestForm />}
    </div>
  );
}
