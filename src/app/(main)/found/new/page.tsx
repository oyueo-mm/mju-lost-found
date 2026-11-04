import { requireIdentityReadyUser } from "@/lib/auth/session";
import { getMyOrganizationMemberships } from "@/lib/organization/service";
import { loadNextPostDefaults } from "@/lib/posts/nextPostDefaults";
import { PostForm } from "@/components/post/PostForm";
import { listCustodyInstitutions } from "@/lib/posts/custodyInstitutions";

export default async function NewFoundPostPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  // Redirects to /login, /onboarding or (no 실명·학과 yet) /me/identity as needed.
  const user = await requireIdentityReadyUser("write", "/found/new");

  // See lost/new/page.tsx's own comment -- identical shape/reasoning.
  const myOrganizations = (await getMyOrganizationMemberships(user.id)).filter((m) => m.organizationStatus === "active");
  // 연속 등록: ?after=<id> from the post page's "다음 습득물 등록".
  const [defaults, custodyInstitutions] = await Promise.all([
    loadNextPostDefaults("found", (await searchParams).after, user.id, myOrganizations),
    listCustodyInstitutions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-foreground md:text-2xl">습득물 등록</h1>
      <PostForm type="found" myOrganizations={myOrganizations} defaults={defaults} draftOwnerId={user.id} custodyInstitutions={custodyInstitutions} />
    </div>
  );
}
